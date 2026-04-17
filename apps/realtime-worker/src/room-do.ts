import { DurableObject } from "cloudflare:workers";
import { drizzle } from 'drizzle-orm/durable-sqlite';
import { migrate } from 'drizzle-orm/durable-sqlite/migrator';
import * as schema from './db/schema';
import { eq } from 'drizzle-orm';

import {
  WebIngestAckSchema,
  type WebIngestRequest,
} from "@pulse/realtime-protocol";

import type { Env } from "./env";
import { createStrategy, type RoomContext, type RoomStrategy } from './room-strategies';

const drizzleMigrations = import.meta.glob('./db/migrations/**/*.sql', { query: '?raw', import: 'default', eager: true });
const migrations: Record<string, string> = {};
for (const [path, query] of Object.entries(drizzleMigrations)) {
  // Key needs to be like "20260414112459_name/migration.sql" — Drizzle parses first 14 chars as date
  const parts = path.split('/');
  const key = parts.slice(-2).join('/');
  migrations[key] = query as string;
}

// ==========================================
// RoomDO — thin container shell
// Delegates all business logic to RoomStrategy
// ==========================================

export class RealtimeRoom extends DurableObject<Env> {
  private db: ReturnType<typeof drizzle>;
  private workspaceId: string = "unknown";
  private roomId: string = "unknown";
  private strategy!: RoomStrategy;

  private sessionSubscribers: Set<string> = new Set();

  // Shared in-memory state (owned by RoomDO, accessed by strategies via RoomContext)
  private readersMemory: Map<string, typeof schema.activeReaders.$inferInsert> = new Map();
  private deviceStates: Map<string, unknown> = new Map();
  private chatParticipants: Map<string, {
    readerId: string;
    displayName: string;
    presenceState: "active";
    updatedAt: string;
    userId?: string;
  }> = new Map();
  private chatMessages: Array<{
    msgId: string;
    senderId: string;
    senderDisplayName: string;
    content: string;
    createdAt: string;
  }> = [];
  private typingUsers: Set<string> = new Set();

  // Debounced flush tracking
  private dirtyReaderKeys: Set<string> = new Set();
  private deletedReaderKeys: Set<string> = new Set();
  private lastFlushMs = 0;
  private FLUSH_INTERVAL_MS = 2000;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.db = drizzle(this.ctx.storage, { schema });
    
    this.ctx.blockConcurrencyWhile(async () => {
      await migrate(this.db, { migrations });

      const stored = await this.ctx.storage.get<{ w: string; r: string }>("meta");
      if (stored) {
        this.workspaceId = stored.w;
        this.roomId = stored.r;
      }
      this.strategy = createStrategy(this.roomId);

      const subs = await this.ctx.storage.get<string[]>("sessionSubs");
      if (subs) this.sessionSubscribers = new Set(subs);

      // Rehydrate web readers from SQLite
      const rows = this.db.select().from(schema.activeReaders).all();
      for (const row of rows) {
        this.readersMemory.set(row.readerId, row);
      }

      const storedParticipants = await this.ctx.storage.get<Array<{
        readerId: string;
        displayName: string;
        presenceState: "active";
        updatedAt: string;
        userId?: string;
      }>>("chatParticipants");
      if (storedParticipants) {
        this.chatParticipants = new Map(storedParticipants.map((item) => [item.readerId, item]));
      }

      const storedTypingUsers = await this.ctx.storage.get<string[]>("chatTypingUsers");
      if (storedTypingUsers) {
        this.typingUsers = new Set(storedTypingUsers);
      }

      const chatRows = this.db.select().from(schema.chatMessages).all()
        .sort((left, right) => left.createdAt - right.createdAt)
        .slice(-50);
      this.chatMessages = chatRows.map((row) => ({
        msgId: row.msgId,
        senderId: row.senderId,
        senderDisplayName: row.senderDisplayName,
        content: row.content,
        createdAt: new Date(row.createdAt).toISOString(),
      }));
    });
  }

  // ==========================================
  // Lifecycle
  // ==========================================

  async initMetadata(workspaceId: string, roomId: string) {
    if (this.workspaceId === workspaceId && this.roomId === roomId) return;
    this.workspaceId = workspaceId;
    this.roomId = roomId;
    this.strategy = createStrategy(roomId);
    await this.ctx.storage.put("meta", { w: workspaceId, r: roomId });
  }

  /**
   * Schedule alarm at the exact expiry time of the earliest reader.
   * No readers = no alarm = DO fully hibernates at zero cost.
   */
  private async scheduleAlarmForEarliestExpiry() {
    if (this.readersMemory.size === 0) return; // nothing to clean, let DO sleep

    let earliest = Infinity;
    for (const reader of this.readersMemory.values()) {
      if (reader.expiresAtMs < earliest) earliest = reader.expiresAtMs;
    }

    if (earliest === Infinity) return;

    const current = await this.ctx.storage.getAlarm();
    // Only reschedule if no alarm or existing alarm is later than needed
    if (!current || current > earliest) {
      await this.ctx.storage.setAlarm(earliest);
    }
  }

  async alarm() {
    const nowMs = Date.now();
    let changed = false;

    for (const [key, reader] of this.readersMemory.entries()) {
      if (reader.expiresAtMs <= nowMs) {
        this.readersMemory.delete(key);
        this.deletedReaderKeys.add(key);
        this.dirtyReaderKeys.delete(key);
        changed = true;
      }
    }

    await this.flushToDB();
    if (changed) await this.broadcastSnapshot();

    // Re-arm only if there are still live readers to expire later
    await this.scheduleAlarmForEarliestExpiry();
  }

  // ==========================================
  // RPC: Session subscription
  // ==========================================

  async subscribeSession(workspaceId: string, roomId: string, sessionDoId: string) {
    await this.initMetadata(workspaceId, roomId);
    this.sessionSubscribers.add(sessionDoId);
    await this.ctx.storage.put("sessionSubs", Array.from(this.sessionSubscribers));
    console.log("[room.subscribeSession] added", {
      workspaceId,
      roomId,
      sessionDoId,
      subscriberCount: this.sessionSubscribers.size,
    });
  }

  async unsubscribeSession(sessionDoId: string) {
    this.sessionSubscribers.delete(sessionDoId);
    await this.ctx.storage.put("sessionSubs", Array.from(this.sessionSubscribers));
    console.log("[room.unsubscribeSession] removed", {
      workspaceId: this.workspaceId,
      roomId: this.roomId,
      sessionDoId,
      subscriberCount: this.sessionSubscribers.size,
    });
  }

  async joinChat(workspaceId: string, roomId: string, sessionDoId: string, userId: string, displayName: string) {
    await this.initMetadata(workspaceId, roomId);
    const participant = {
      readerId: sessionDoId,
      displayName,
      presenceState: "active" as const,
      updatedAt: new Date().toISOString(),
      userId,
    };
    this.chatParticipants.set(sessionDoId, participant);
    await this.ctx.storage.put("chatParticipants", Array.from(this.chatParticipants.values()));
    await this.broadcastSnapshot();
  }

  async leaveChat(workspaceId: string, roomId: string, sessionDoId: string) {
    await this.initMetadata(workspaceId, roomId);
    if (!this.chatParticipants.has(sessionDoId)) return;
    this.chatParticipants.delete(sessionDoId);
    this.typingUsers.delete(sessionDoId);
    await this.ctx.storage.put("chatParticipants", Array.from(this.chatParticipants.values()));
    await this.ctx.storage.put("chatTypingUsers", Array.from(this.typingUsers));
    await this.broadcastSnapshot();
  }

  async postChatMessage(workspaceId: string, roomId: string, sessionDoId: string, senderId: string, displayName: string, content: string) {
    await this.initMetadata(workspaceId, roomId);
    const nowMs = Date.now();
    const trimmed = content.trim();
    if (!trimmed) return;

    this.chatParticipants.set(sessionDoId, {
      readerId: sessionDoId,
      displayName,
      presenceState: "active",
      updatedAt: new Date(nowMs).toISOString(),
      userId: senderId,
    });
    await this.ctx.storage.put("chatParticipants", Array.from(this.chatParticipants.values()));

    const msgId = `${nowMs}:${senderId}:${Math.random().toString(36).slice(2, 8)}`;
    this.db.insert(schema.chatMessages).values({
      msgId,
      senderId,
      senderDisplayName: displayName,
      content: trimmed,
      createdAt: nowMs,
    }).run();

    this.chatMessages = [
      ...this.chatMessages,
      {
        msgId,
        senderId,
        senderDisplayName: displayName,
        content: trimmed,
        createdAt: new Date(nowMs).toISOString(),
      },
    ].slice(-50);

    await this.broadcastSnapshot();
  }

  // ==========================================
  // RPC: Device state push (only Global strategy will act on this)
  // ==========================================

  async pushDeviceUpdate(workspaceId: string, roomId: string, deviceId: string, state: unknown | null) {
    await this.initMetadata(workspaceId, roomId);
    const ctx = this.buildContext();
    const changed = this.strategy.handleDeviceUpdate(ctx, deviceId, state);
    console.log("[room.pushDeviceUpdate] handled", {
      workspaceId,
      roomId,
      deviceId,
      changed,
      hasState: state != null,
      subscriberCount: this.sessionSubscribers.size,
    });
    if (changed) {
      // Sync back deviceStates (strategy may have mutated the map)
      this.deviceStates = ctx.deviceStates;
      await this.broadcastSnapshot();
    }
  }

  // ==========================================
  // RPC: Web visitor ingest
  // ==========================================

  async handleWebIngest(request: WebIngestRequest, roomId: string, ttlMs: number) {
    await this.initMetadata(request.workspaceId, roomId);
    const ctx = this.buildContext();
    let changed = false;

    for (const event of request.events) {
      const readerId = `web:${request.sessionId}`;

      if (event.kind === "session_end") {
        if (this.strategy.handleSessionEnd(ctx, readerId)) changed = true;
        this.deletedReaderKeys.add(readerId);
        this.dirtyReaderKeys.delete(readerId);
        continue;
      }

      if (this.strategy.handleWebEvent(ctx, event as any, readerId, ttlMs)) {
        changed = true;
        this.dirtyReaderKeys.add(readerId);
        this.deletedReaderKeys.delete(readerId);
      }
    }

    // Sync back readers (strategy mutated the map in-place via ctx)
    this.readersMemory = ctx.readers;
    this.requestFlush();

    if (changed) {
      await this.scheduleAlarmForEarliestExpiry();
      await this.broadcastSnapshot();
    }

    return WebIngestAckSchema.parse({
      workspaceId: request.workspaceId,
      siteId: request.siteId,
      sessionId: request.sessionId,
      acceptedSeqMax: request.events[request.events.length - 1]?.seq ?? 0,
      dedupedEventIds: [],
      rejected: [],
      workspaceRevision: Date.now(),
    });
  }

  // ==========================================
  // Snapshot — delegates to strategy
  // ==========================================

  async getSnapshot(workspaceId?: string, roomId?: string) {
    if (workspaceId && roomId) await this.initMetadata(workspaceId, roomId);
    return this.strategy.buildSnapshot(this.buildContext());
  }

  // ==========================================
  // Stats stubs (to be implemented with Drizzle queries)
  // ==========================================

  async getGlobalStats(day: string) { return {} as any; }
  async getPageStats(day: string, limit: number) { return []; }
  async getRoomStats(day: string, limit: number) { return []; }
  async getDeviceStats(day: string, deviceId: string) { return {} as any; }

  // ==========================================
  // Private: context, flush, broadcast
  // ==========================================

  private buildContext(): RoomContext {
    return {
      workspaceId: this.workspaceId,
      roomId: this.roomId,
      nowMs: Date.now(),
      readers: this.readersMemory,
      deviceStates: this.deviceStates,
      chatParticipants: this.chatParticipants,
      chatMessages: this.chatMessages,
      typingUsers: this.typingUsers,
    };
  }

  private requestFlush() {
    const now = Date.now();
    if (now - this.lastFlushMs > this.FLUSH_INTERVAL_MS) {
      this.ctx.waitUntil(this.flushToDB());
    } else {
      this.ctx.waitUntil((async () => {
        const wait = this.FLUSH_INTERVAL_MS - (now - this.lastFlushMs);
        await new Promise((r) => setTimeout(r, wait));
        await this.flushToDB();
      })());
    }
  }

  private async flushToDB() {
    if (this.dirtyReaderKeys.size === 0 && this.deletedReaderKeys.size === 0) return;
    this.lastFlushMs = Date.now();

    const toDelete = Array.from(this.deletedReaderKeys);
    const toUpsert = Array.from(this.dirtyReaderKeys)
      .map((k) => this.readersMemory.get(k))
      .filter(Boolean);

    this.dirtyReaderKeys.clear();
    this.deletedReaderKeys.clear();

    this.ctx.storage.transactionSync(() => {
      for (const id of toDelete) {
        this.db.delete(schema.activeReaders).where(eq(schema.activeReaders.readerId, id)).run();
      }
      for (const item of toUpsert as Array<typeof schema.activeReaders.$inferInsert>) {
        this.db
          .insert(schema.activeReaders)
          .values(item)
          .onConflictDoUpdate({ target: schema.activeReaders.readerId, set: item })
          .run();
      }
    });
  }

  private async broadcastSnapshot() {
    const snapshot = await this.getSnapshot();
    console.log("[room.broadcastSnapshot] begin", {
      workspaceId: this.workspaceId,
      roomId: this.roomId,
      subscriberCount: this.sessionSubscribers.size,
      onlineCount: (snapshot as any).onlineCount ?? null,
      readerCount: Array.isArray((snapshot as any).activeReaders)
        ? (snapshot as any).activeReaders.length
        : null,
      revision: (snapshot as any).revision ?? null,
    });

    const dead: string[] = [];
    const promises = Array.from(this.sessionSubscribers).map(async (sessionId) => {
      try {
        const stub = this.env.REALTIME_SESSION.get(
          this.env.REALTIME_SESSION.idFromString(sessionId)
        ) as any;
        console.log("[room.broadcastSnapshot] push", {
          workspaceId: this.workspaceId,
          roomId: this.roomId,
          sessionId,
        });
        await stub.pushRoomSnapshot(this.roomId, snapshot);
        console.log("[room.broadcastSnapshot] pushed", {
          workspaceId: this.workspaceId,
          roomId: this.roomId,
          sessionId,
        });
      } catch {
        dead.push(sessionId);
        console.warn("[room.broadcastSnapshot] failed", {
          workspaceId: this.workspaceId,
          roomId: this.roomId,
          sessionId,
        });
      }
    });

    this.ctx.waitUntil(
      Promise.allSettled(promises).then(async () => {
        if (dead.length > 0) {
          for (const id of dead) this.sessionSubscribers.delete(id);
          await this.ctx.storage.put("sessionSubs", Array.from(this.sessionSubscribers));
        }
        console.log("[room.broadcastSnapshot] done", {
          workspaceId: this.workspaceId,
          roomId: this.roomId,
          attempted: promises.length,
          dead,
          remainingSubscribers: this.sessionSubscribers.size,
        });
      })
    );
  }
}

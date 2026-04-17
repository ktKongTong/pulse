import { DurableObject } from "cloudflare:workers";
import { drizzle } from 'drizzle-orm/durable-sqlite';
import { migrate } from 'drizzle-orm/durable-sqlite/migrator';
import type {
  ContentHistoryPoint,
  ContentLifetime,
  OwnerHistoryPoint,
  OwnerLifetime,
  RoomSnapshot,
  SiteHistoryPoint,
  SiteLifetime,
} from "@pulse/realtime-protocol";
import * as schema from './db/schema';
import { loadDrizzleMigrations } from "./db/migrations";
import { eq } from 'drizzle-orm';

import {
  WebIngestAckSchema,
  type WebEvent,
  type WebIngestRequest,
} from "@pulse/realtime-protocol";

import type { Env } from "./env";
import type { SessionRpc } from "./durable-stubs";
import { aggregateFlushMs } from "./env";
import { createWorkerLogger } from "./logger";
import { createStrategy, type RoomContext, type RoomStrategy } from './room-strategies';
import {
  type ActiveReaderState,
  type ChatMessageState,
  type ChatParticipantState,
  type DevicePresenceState,
  isDeviceActiveNow,
  isReaderActiveNow,
  resolveDeviceAppKey,
} from './runtime-models';
import {
  buildContentHistory,
  buildContentLifetime,
  buildOwnerHistory,
  buildOwnerLifetime,
  buildSiteHistory,
  buildSiteLifetime,
} from './stats-query';
import { coerceNonNegativeInt, dayKeyFromIso, splitDurationAcrossDays } from './stats-utils';

const migrations = loadDrizzleMigrations();

interface PendingSiteMetrics {
  day: string;
  startedAtMs: number;
  lastUpdatedAtMs: number;
  pageViewCount: number;
  uniqueVisitorCount: number;
  readTimeMs: number;
}

interface PendingContentMetrics {
  id: string;
  day: string;
  canonicalUrl: string;
  title: string;
  startedAtMs: number;
  lastUpdatedAtMs: number;
  pageViewCount: number;
  uniqueVisitorCount: number;
  readTimeMs: number;
}

interface PendingOwnerPresence {
  id: string;
  day: string;
  appKey: string;
  label: string;
  totalMs: number;
  sampleCount: number;
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
  private readersMemory: Map<string, ActiveReaderState> = new Map();
  private deviceStates: Map<string, DevicePresenceState> = new Map();
  private chatParticipants: Map<string, ChatParticipantState> = new Map();
  private chatMessages: ChatMessageState[] = [];
  private typingUsers: Set<string> = new Set();
  private pendingSiteMetrics = new Map<string, PendingSiteMetrics>();
  private pendingContentMetrics = new Map<string, PendingContentMetrics>();
  private pendingOwnerPresence = new Map<string, PendingOwnerPresence>();

  private readonly logger;
  private readonly flushIntervalMs;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.db = drizzle(this.ctx.storage, { schema });
    this.logger = createWorkerLogger(env, "room.do");
    this.flushIntervalMs = aggregateFlushMs(env);
    
    this.ctx.blockConcurrencyWhile(async () => {
      await migrate(this.db, { migrations });
      const nowMs = Date.now();

      const stored = await this.ctx.storage.get<{ w: string; r: string }>("meta");
      if (stored) {
        this.workspaceId = stored.w;
        this.roomId = stored.r;
      }
      this.strategy = createStrategy(this.roomId);

      const subs = await this.ctx.storage.get<string[]>("sessionSubs");
      if (subs) this.sessionSubscribers = new Set(subs);

      const storedReaders = await this.ctx.storage.get<ActiveReaderState[]>("volatileReaders");
      if (storedReaders) {
        this.readersMemory = new Map(
          storedReaders
            .filter((reader) => reader.expiresAtMs > nowMs)
            .map((reader) => [reader.readerId, reader]),
        );
      }

      const storedDeviceStates = await this.ctx.storage.get<
        Array<[string, DevicePresenceState]>
      >("volatileDeviceStates");
      if (storedDeviceStates) {
        this.deviceStates = new Map(
          storedDeviceStates.filter(([, state]) => (state.expiresAtMs ?? 0) > nowMs),
        );
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

      await this.persistVolatileState();
      await this.scheduleNextAlarm();
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

  private async scheduleNextAlarm() {
    const nowMs = Date.now();
    let earliest = Infinity;
    for (const reader of this.readersMemory.values()) {
      if (reader.expiresAtMs < earliest) earliest = reader.expiresAtMs;
    }
    for (const state of this.deviceStates.values()) {
      if (state.expiresAtMs != null && state.expiresAtMs < earliest) {
        earliest = state.expiresAtMs;
      }
    }

    let next = earliest;
    if (this.roomId === "global" && this.shouldKeepFlushTickActive()) {
      next = Math.min(next, nowMs + this.flushIntervalMs);
    }

    if (next === Infinity) return;

    const current = await this.ctx.storage.getAlarm();
    // Only reschedule if no alarm or existing alarm is later than needed
    if (!current || current > next) {
      await this.ctx.storage.setAlarm(next);
    }
  }

  async alarm() {
    const nowMs = Date.now();
    if (this.roomId === "global") {
      await this.flushAggregates(nowMs);
    }
    let changed = false;

    for (const [key, reader] of this.readersMemory.entries()) {
      if (reader.expiresAtMs <= nowMs) {
        this.captureReaderDuration(reader, nowMs);
        this.readersMemory.delete(key);
        changed = true;
      }
    }
    for (const [key, state] of this.deviceStates.entries()) {
      if (state.expiresAtMs != null && state.expiresAtMs <= nowMs) {
        this.captureDeviceDuration(state, nowMs);
        this.deviceStates.delete(key);
        changed = true;
      }
    }

    await this.persistVolatileState();
    if (changed) await this.broadcastSnapshot();

    await this.scheduleNextAlarm();
  }

  // ==========================================
  // RPC: Session subscription
  // ==========================================

  async subscribeSession(workspaceId: string, roomId: string, sessionDoId: string) {
    await this.initMetadata(workspaceId, roomId);
    this.sessionSubscribers.add(sessionDoId);
    await this.ctx.storage.put("sessionSubs", Array.from(this.sessionSubscribers));
    this.logger.debug("subscribe session", {
      workspaceId,
      roomId,
      sessionDoId,
      subscriberCount: this.sessionSubscribers.size,
    });
  }

  async unsubscribeSession(sessionDoId: string) {
    this.sessionSubscribers.delete(sessionDoId);
    await this.ctx.storage.put("sessionSubs", Array.from(this.sessionSubscribers));
    this.logger.debug("unsubscribe session", {
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

  async pushDeviceUpdate(workspaceId: string, roomId: string, deviceId: string, state: DevicePresenceState | null) {
    await this.initMetadata(workspaceId, roomId);
    const eventMs = Date.parse(state?.updatedAt ?? "") || Date.now();
    const previousState = this.deviceStates.get(deviceId) ?? null;
    if (previousState) {
      this.captureDeviceDuration(previousState, eventMs);
    }

    const nextState = state
      ? {
          ...state,
          lastCountedAtMs: eventMs,
        }
      : null;
    const ctx = this.buildContext(eventMs);
    const changed = this.strategy.handleDeviceUpdate(ctx, deviceId, nextState);
    this.logger.debug("push device update", {
      workspaceId,
      roomId,
      deviceId,
      changed,
      hasState: state != null,
      subscriberCount: this.sessionSubscribers.size,
    });
    if (changed) {
      this.deviceStates = ctx.deviceStates;
    }
    await this.persistVolatileState();
    await this.scheduleNextAlarm();
    if (changed) await this.broadcastSnapshot();
  }

  // ==========================================
  // RPC: Web visitor ingest
  // ==========================================

  async handleWebIngest(request: WebIngestRequest, roomId: string, ttlMs: number) {
    await this.initMetadata(request.workspaceId, roomId);
    const ctx = this.buildContext();
    let changed = false;

    for (const event of request.events) {
      const eventMs = Date.parse(event.observedAt) || Date.now();
      ctx.nowMs = eventMs;
      const readerId = `web:${request.sessionId}:${request.tabId}`;
      const previousReader = this.readersMemory.get(readerId) ?? null;
      if (previousReader) {
        this.captureReaderDuration(previousReader, eventMs);
      }
      await this.recordWebEventMetrics(request.sessionId, event, eventMs);
      const ingestEvent = {
        ...event,
        sessionId: request.sessionId,
        tabId: request.tabId,
        userId: request.userId,
      };

      if (event.kind === "session_end") {
        if (this.strategy.handleSessionEnd(ctx, readerId)) changed = true;
        continue;
      }

      if (this.strategy.handleWebEvent(ctx, ingestEvent, readerId, ttlMs)) {
        changed = true;
      }
      const nextReader = ctx.readers.get(readerId);
      if (nextReader) {
        nextReader.lastCountedAtMs = eventMs;
      }
    }

    this.readersMemory = ctx.readers;
    await this.persistVolatileState();
    await this.scheduleNextAlarm();

    if (changed) {
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

  async removeWebReader(
    workspaceId: string,
    roomId: string,
    sessionId: string,
    tabId: string,
  ) {
    await this.initMetadata(workspaceId, roomId);
    const readerId = `web:${sessionId}:${tabId}`;
    const existing = this.readersMemory.get(readerId);
    if (!existing) return;

    this.captureReaderDuration(existing, Date.now());
    this.readersMemory.delete(readerId);
    await this.persistVolatileState();
    await this.scheduleNextAlarm();
    await this.broadcastSnapshot();
  }

  // ==========================================
  // Snapshot — delegates to strategy
  // ==========================================

  async getSnapshot(workspaceId?: string, roomId?: string): Promise<RoomSnapshot> {
    if (workspaceId && roomId) await this.initMetadata(workspaceId, roomId);
    return this.strategy.buildSnapshot(this.buildContext());
  }

  // ==========================================
  // Stats stubs (to be implemented with Drizzle queries)
  // ==========================================

  async getSiteHistory(
    period: import("@pulse/realtime-protocol").StatsPeriod,
    limit: number,
    anchorDay: string,
  ): Promise<SiteHistoryPoint[]> {
    await this.flushAggregates();
    const rows = this.db.select().from(schema.globalDailyStats).all();
    return buildSiteHistory(rows, period, limit, anchorDay);
  }

  async getSiteLifetime(): Promise<SiteLifetime> {
    await this.flushAggregates();
    const rows = this.db.select().from(schema.globalDailyStats).all();
    return buildSiteLifetime(rows);
  }

  async getContentHistory(
    canonicalUrl: string,
    period: import("@pulse/realtime-protocol").StatsPeriod,
    limit: number,
    anchorDay: string,
  ): Promise<ContentHistoryPoint[]> {
    await this.flushAggregates();
    const rows = this.db.select().from(schema.pageDailyStats).all();
    return buildContentHistory(canonicalUrl, rows, period, limit, anchorDay);
  }

  async getContentLifetime(canonicalUrl: string): Promise<ContentLifetime | null> {
    await this.flushAggregates();
    const rows = this.db.select().from(schema.pageDailyStats).all();
    return buildContentLifetime(canonicalUrl, rows);
  }

  async getOwnerHistory(
    period: import("@pulse/realtime-protocol").StatsPeriod,
    limit: number,
    anchorDay: string,
  ): Promise<OwnerHistoryPoint[]> {
    await this.flushAggregates();
    const rows = this.db.select().from(schema.globalAppDailyStats).all();
    return buildOwnerHistory(rows, period, limit, anchorDay);
  }

  async getOwnerLifetime(): Promise<OwnerLifetime> {
    await this.flushAggregates();
    const rows = this.db.select().from(schema.globalAppDailyStats).all();
    return buildOwnerLifetime(rows);
  }

  // ==========================================
  // Private: context, flush, broadcast
  // ==========================================

  private async recordWebEventMetrics(
    sessionId: string,
    event: WebEvent,
    nowMs: number,
  ) {
    if (this.roomId !== "global" || event.kind !== "page_view") return;
    const day = dayKeyFromIso(event.observedAt);
    const canonicalUrl = event.page.canonicalUrl ?? event.page.url;
    const contentUniqueVisitorDelta = await this.markSeen(
      `content-uv:${day}:${canonicalUrl}`,
      sessionId,
    );
    const siteUniqueVisitorDelta = await this.markSeen(`site-uv:${day}`, sessionId);

    this.bumpContentMetrics(day, canonicalUrl, event.page.title ?? canonicalUrl, nowMs, {
      pageViewCount: 1,
      uniqueVisitorCount: contentUniqueVisitorDelta,
      readTimeMs: 0,
    });
    this.bumpSiteMetrics(day, nowMs, {
      pageViewCount: 1,
      uniqueVisitorCount: siteUniqueVisitorDelta,
      readTimeMs: 0,
    });
  }

  private captureReaderDuration(reader: ActiveReaderState, nowMs: number) {
    if (this.roomId !== "global") return;
    const effectiveEndMs = Math.min(nowMs, reader.expiresAtMs);
    const startMs = Math.max(
      0,
      reader.lastCountedAtMs || Date.parse(reader.updatedAt) || effectiveEndMs,
    );
    if (effectiveEndMs <= startMs) return;
    if (!isReaderActiveNow(reader, effectiveEndMs - 1)) {
      reader.lastCountedAtMs = effectiveEndMs;
      return;
    }

    const canonicalUrl = reader.pageCanonicalUrl ?? reader.pageUrl;
    const title = reader.pageTitle ?? canonicalUrl;
    if (!canonicalUrl || !title) {
      reader.lastCountedAtMs = effectiveEndMs;
      return;
    }

    splitDurationAcrossDays(startMs, effectiveEndMs, (day, durationMs) => {
      this.bumpContentMetrics(day, canonicalUrl, title, effectiveEndMs, {
        pageViewCount: 0,
        uniqueVisitorCount: 0,
        readTimeMs: durationMs,
      });
      this.bumpSiteMetrics(day, effectiveEndMs, {
        pageViewCount: 0,
        uniqueVisitorCount: 0,
        readTimeMs: durationMs,
      });
    });
    reader.lastCountedAtMs = effectiveEndMs;
  }

  private captureDeviceDuration(state: DevicePresenceState, nowMs: number) {
    if (this.roomId !== "global") return;
    const effectiveEndMs = Math.min(nowMs, state.expiresAtMs ?? nowMs);
    const startMs = Math.max(
      0,
      state.lastCountedAtMs || Date.parse(state.updatedAt ?? "") || effectiveEndMs,
    );
    if (effectiveEndMs <= startMs) return;
    if (!isDeviceActiveNow(state, effectiveEndMs - 1)) {
      state.lastCountedAtMs = effectiveEndMs;
      return;
    }
    const app = resolveDeviceAppKey(state);
    if (!app) {
      state.lastCountedAtMs = effectiveEndMs;
      return;
    }

    splitDurationAcrossDays(startMs, effectiveEndMs, (day, durationMs) => {
      this.bumpOwnerPresence(day, app.key, app.label, durationMs);
    });
    state.lastCountedAtMs = effectiveEndMs;
  }

  private async markSeen(storageKey: string, sessionId: string) {
    if (!sessionId) return 0;
    const seen = (await this.ctx.storage.get<string[]>(storageKey)) ?? [];
    if (seen.includes(sessionId)) return 0;
    seen.push(sessionId);
    await this.ctx.storage.put(storageKey, seen);
    return 1;
  }

  private shouldKeepFlushTickActive() {
    const nowMs = Date.now();
    if (
      Array.from(this.readersMemory.values()).some((reader) =>
        isReaderActiveNow(reader, nowMs),
      )
    ) {
      return true;
    }
    if (
      Array.from(this.deviceStates.values()).some((state) =>
        isDeviceActiveNow(state, nowMs),
      )
    ) {
      return true;
    }
    return (
      this.pendingSiteMetrics.size > 0 ||
      this.pendingContentMetrics.size > 0 ||
      this.pendingOwnerPresence.size > 0
    );
  }

  private bumpSiteMetrics(
    day: string,
    nowMs: number,
    delta: { pageViewCount: number; uniqueVisitorCount: number; readTimeMs: number },
  ) {
    const existing = this.pendingSiteMetrics.get(day) ?? {
      day,
      startedAtMs: nowMs,
      lastUpdatedAtMs: nowMs,
      pageViewCount: 0,
      uniqueVisitorCount: 0,
      readTimeMs: 0,
    };
    existing.lastUpdatedAtMs = Math.max(existing.lastUpdatedAtMs, nowMs);
    existing.pageViewCount += delta.pageViewCount;
    existing.uniqueVisitorCount += delta.uniqueVisitorCount;
    existing.readTimeMs += delta.readTimeMs;
    this.pendingSiteMetrics.set(day, existing);
  }

  private bumpContentMetrics(
    day: string,
    canonicalUrl: string,
    title: string,
    nowMs: number,
    delta: { pageViewCount: number; uniqueVisitorCount: number; readTimeMs: number },
  ) {
    const id = `${day}|${canonicalUrl}`;
    const existing = this.pendingContentMetrics.get(id) ?? {
      id,
      day,
      canonicalUrl,
      title,
      startedAtMs: nowMs,
      lastUpdatedAtMs: nowMs,
      pageViewCount: 0,
      uniqueVisitorCount: 0,
      readTimeMs: 0,
    };
    existing.title = title;
    existing.lastUpdatedAtMs = Math.max(existing.lastUpdatedAtMs, nowMs);
    existing.pageViewCount += delta.pageViewCount;
    existing.uniqueVisitorCount += delta.uniqueVisitorCount;
    existing.readTimeMs += delta.readTimeMs;
    this.pendingContentMetrics.set(id, existing);
  }

  private bumpOwnerPresence(
    day: string,
    appKey: string,
    label: string,
    durationMs: number,
  ) {
    const id = `${day}|${appKey}`;
    const existing = this.pendingOwnerPresence.get(id) ?? {
      id,
      day,
      appKey,
      label,
      totalMs: 0,
      sampleCount: 0,
    };
    existing.label = label;
    existing.totalMs += durationMs;
    existing.sampleCount += 1;
    this.pendingOwnerPresence.set(id, existing);
  }

  private async persistVolatileState() {
    if (this.readersMemory.size > 0) {
      await this.ctx.storage.put("volatileReaders", Array.from(this.readersMemory.values()));
    } else {
      await this.ctx.storage.delete("volatileReaders");
    }

    if (this.deviceStates.size > 0) {
      await this.ctx.storage.put(
        "volatileDeviceStates",
        Array.from(this.deviceStates.entries()),
      );
    } else {
      await this.ctx.storage.delete("volatileDeviceStates");
    }
  }

  private async flushAggregates(nowMs = Date.now()) {
    if (this.roomId !== "global") return;

    for (const reader of this.readersMemory.values()) {
      this.captureReaderDuration(reader, nowMs);
    }
    for (const state of this.deviceStates.values()) {
      this.captureDeviceDuration(state, nowMs);
    }

    if (
      this.pendingSiteMetrics.size === 0 &&
      this.pendingContentMetrics.size === 0 &&
      this.pendingOwnerPresence.size === 0
    ) {
      await this.persistVolatileState();
      return;
    }

    for (const delta of this.pendingSiteMetrics.values()) {
      const existing =
        this.db
          .select()
          .from(schema.globalDailyStats)
          .where(eq(schema.globalDailyStats.day, delta.day))
          .all()[0] ?? null;
      this.db
        .insert(schema.globalDailyStats)
        .values({
          day: delta.day,
          startedAtMs: existing?.startedAtMs ?? delta.startedAtMs,
          lastUpdatedAtMs: Math.max(existing?.lastUpdatedAtMs ?? 0, delta.lastUpdatedAtMs),
          pageViewCount: coerceNonNegativeInt(existing?.pageViewCount) + delta.pageViewCount,
          uniqueVisitorCount:
            coerceNonNegativeInt(existing?.uniqueVisitorCount) + delta.uniqueVisitorCount,
          onlineIntegralMs: coerceNonNegativeInt(existing?.onlineIntegralMs) + delta.readTimeMs,
          onlineCountPeak: coerceNonNegativeInt(existing?.onlineCountPeak),
          activeDeviceCountPeak: coerceNonNegativeInt(existing?.activeDeviceCountPeak),
          activeWebReaderCountPeak: coerceNonNegativeInt(existing?.activeWebReaderCountPeak),
          dedupedEventCount: coerceNonNegativeInt(existing?.dedupedEventCount),
          rejectedEventCount: coerceNonNegativeInt(existing?.rejectedEventCount),
          broadcastCount: coerceNonNegativeInt(existing?.broadcastCount),
        })
        .onConflictDoUpdate({
          target: schema.globalDailyStats.day,
          set: {
            lastUpdatedAtMs: Math.max(
              existing?.lastUpdatedAtMs ?? 0,
              delta.lastUpdatedAtMs,
            ),
            pageViewCount:
              coerceNonNegativeInt(existing?.pageViewCount) + delta.pageViewCount,
            uniqueVisitorCount:
              coerceNonNegativeInt(existing?.uniqueVisitorCount) + delta.uniqueVisitorCount,
            onlineIntegralMs:
              coerceNonNegativeInt(existing?.onlineIntegralMs) + delta.readTimeMs,
          },
        })
        .run();
    }

    for (const delta of this.pendingContentMetrics.values()) {
      const existing =
        this.db
          .select()
          .from(schema.pageDailyStats)
          .where(eq(schema.pageDailyStats.id, delta.id))
          .all()[0] ?? null;
      this.db
        .insert(schema.pageDailyStats)
        .values({
          id: delta.id,
          day: delta.day,
          canonicalUrl: delta.canonicalUrl,
          title: delta.title,
          startedAtMs: existing?.startedAtMs ?? delta.startedAtMs,
          lastUpdatedAtMs: Math.max(existing?.lastUpdatedAtMs ?? 0, delta.lastUpdatedAtMs),
          pageViewCount: coerceNonNegativeInt(existing?.pageViewCount) + delta.pageViewCount,
          uniqueVisitorCount:
            coerceNonNegativeInt(existing?.uniqueVisitorCount) + delta.uniqueVisitorCount,
          readTimeMs: coerceNonNegativeInt(existing?.readTimeMs) + delta.readTimeMs,
          readerSessionCount: coerceNonNegativeInt(existing?.readerSessionCount),
          progressSum: existing?.progressSum ?? 0,
          progressSamples: coerceNonNegativeInt(existing?.progressSamples),
          maxProgressPercent: existing?.maxProgressPercent ?? 0,
          bounceCount: coerceNonNegativeInt(existing?.bounceCount),
          engagedReaderCount: coerceNonNegativeInt(existing?.engagedReaderCount),
        })
        .onConflictDoUpdate({
          target: schema.pageDailyStats.id,
          set: {
            title: delta.title,
            lastUpdatedAtMs: Math.max(
              existing?.lastUpdatedAtMs ?? 0,
              delta.lastUpdatedAtMs,
            ),
            pageViewCount:
              coerceNonNegativeInt(existing?.pageViewCount) + delta.pageViewCount,
            uniqueVisitorCount:
              coerceNonNegativeInt(existing?.uniqueVisitorCount) + delta.uniqueVisitorCount,
            readTimeMs: coerceNonNegativeInt(existing?.readTimeMs) + delta.readTimeMs,
          },
        })
        .run();
    }

    for (const delta of this.pendingOwnerPresence.values()) {
      const existing =
        this.db
          .select()
          .from(schema.globalAppDailyStats)
          .where(eq(schema.globalAppDailyStats.id, delta.id))
          .all()[0] ?? null;
      this.db
        .insert(schema.globalAppDailyStats)
        .values({
          id: delta.id,
          day: delta.day,
          appKey: delta.appKey,
          label: delta.label,
          totalMs: coerceNonNegativeInt(existing?.totalMs) + delta.totalMs,
          sampleCount: coerceNonNegativeInt(existing?.sampleCount) + delta.sampleCount,
        })
        .onConflictDoUpdate({
          target: schema.globalAppDailyStats.id,
          set: {
            label: delta.label,
            totalMs: coerceNonNegativeInt(existing?.totalMs) + delta.totalMs,
            sampleCount:
              coerceNonNegativeInt(existing?.sampleCount) + delta.sampleCount,
          },
        })
        .run();
    }

    this.pendingSiteMetrics.clear();
    this.pendingContentMetrics.clear();
    this.pendingOwnerPresence.clear();
    await this.persistVolatileState();
  }

  private buildContext(nowMs = Date.now()): RoomContext {
    return {
      workspaceId: this.workspaceId,
      roomId: this.roomId,
      nowMs,
      readers: this.readersMemory,
      deviceStates: this.deviceStates,
      chatParticipants: this.chatParticipants,
      chatMessages: this.chatMessages,
      typingUsers: this.typingUsers,
    };
  }

  private async broadcastSnapshot() {
    const snapshot = await this.getSnapshot();
    this.logger.debug("broadcast snapshot begin", {
      workspaceId: this.workspaceId,
      roomId: this.roomId,
      subscriberCount: this.sessionSubscribers.size,
      onlineCount: snapshot.roomKind === "chat" ? snapshot.participantCount : snapshot.onlineCount,
      readerCount: snapshot.roomKind === "chat" ? snapshot.participants.length : snapshot.activeReaders.length,
      revision: snapshot.revision,
    });

    const dead: string[] = [];
    const promises = Array.from(this.sessionSubscribers).map(async (sessionId) => {
      try {
        const stub = this.env.REALTIME_SESSION.get(
          this.env.REALTIME_SESSION.idFromString(sessionId)
        ) as unknown as SessionRpc;
        this.logger.debug("broadcast snapshot push", {
          workspaceId: this.workspaceId,
          roomId: this.roomId,
          sessionId,
        });
        await stub.pushRoomSnapshot(this.roomId, snapshot);
        this.logger.debug("broadcast snapshot pushed", {
          workspaceId: this.workspaceId,
          roomId: this.roomId,
          sessionId,
        });
      } catch {
        dead.push(sessionId);
        this.logger.warn("broadcast snapshot failed", {
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
        this.logger.debug("broadcast snapshot done", {
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

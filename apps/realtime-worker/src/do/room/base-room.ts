import { drizzle } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import type {
  RoomSnapshot,
} from "@pulse/realtime-protocol";
import * as schema from "../../db/schema";
import { loadDrizzleMigrations } from "../../db/migrations";
import type { Env } from "../../config/env";
import { aggregateFlushMs } from "../../config/env";
import { createWorkerLogger } from "../../observability/logger";
import {
  SessionDO,
  type RoomSessionConnectionRecord,
  type RoomSessionConnectionState,
} from "../session";

const migrations = loadDrizzleMigrations();

export interface WebIngestEvent {
  kind: string;
  observedAt: string;
  sessionId: string;
  tabId: string;
  userId?: string;
  presence: { state: string };
  page: { title: string; url: string; canonicalUrl?: string };
  reading?: { progressPercent?: number; scrollY?: number };
}

export abstract class BaseRoom<
  TState extends RoomSessionConnectionState,
> extends SessionDO<TState> {
  protected db: ReturnType<typeof drizzle>;
  protected workspaceId: string = "unknown";
  protected roomId: string = "unknown";
  protected readonly logger;
  protected readonly flushIntervalMs;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.db = drizzle(this.ctx.storage, { schema });
    this.logger = createWorkerLogger(env, "room.do");
    this.flushIntervalMs = aggregateFlushMs(env);

    this.ctx.blockConcurrencyWhile(async () => {
      migrate(this.db, { migrations });
      const stored = await this.ctx.storage.get<{ w: string; r: string }>("meta");
      if (stored) {
        this.workspaceId = stored.w;
        this.roomId = stored.r;
      }
      await this.restoreRoomState(Date.now());
      await this.scheduleNextAlarm();
    });
  }

  async initMetadata(workspaceId: string, roomId: string) {
    if (this.workspaceId === workspaceId && this.roomId === roomId) return;
    this.workspaceId = workspaceId;
    this.roomId = roomId;
    await this.ctx.storage.put("meta", { w: workspaceId, r: roomId });
  }

  protected abstract supportsRoomId(roomId: string): boolean;
  protected abstract restoreRoomState(nowMs: number): Promise<void>;
  protected abstract persistRoomState(): Promise<void>;
  protected abstract handleRoomAlarm(nowMs: number): Promise<boolean>;
  protected abstract buildRoomSnapshot(): RoomSnapshot;

  protected nextScheduledTick(_nowMs: number) {
    return Infinity;
  }

  protected async createBaseConnectionState(
    request: Request,
    connectionId: string,
  ): Promise<RoomSessionConnectionState> {
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get("workspaceId") ?? this.env.WORKSPACE_ID;
    const roomId = url.searchParams.get("roomId") ?? this.roomId;
    if (!this.supportsRoomId(roomId)) {
      throw new Error(`room_binding_mismatch:${roomId}`);
    }
    await this.initMetadata(workspaceId, roomId);
    return {
      workspaceId,
      roomId,
      connectionId,
      selectedProtocol: null,
    };
  }

  protected serializeBaseConnectionState(
    state: RoomSessionConnectionState,
  ): RoomSessionConnectionState {
    return {
      workspaceId: state.workspaceId,
      roomId: state.roomId,
      connectionId: state.connectionId,
      selectedProtocol: state.selectedProtocol ?? null,
    };
  }

  protected async buildInitialSnapshot(
    _record: RoomSessionConnectionRecord<TState>,
  ): Promise<RoomSnapshot> {
    return this.getSnapshot();
  }

  protected async cleanupConnection(
    record: RoomSessionConnectionRecord<TState>,
  ): Promise<void> {
    await this.cleanupRoomConnection(record);
  }

  protected async cleanupRoomConnection(
    _record: RoomSessionConnectionRecord<TState>,
  ) {}

  protected async scheduleNextAlarm() {
    const next = this.nextScheduledTick(Date.now());
    if (next === Infinity) return;

    const current = await this.ctx.storage.getAlarm();
    if (!current || current > next) {
      await this.ctx.storage.setAlarm(next);
    }
  }

  async alarm() {
    const changed = await this.handleRoomAlarm(Date.now());
    await this.persistRoomState();
    if (changed) {
      await this.broadcastCurrentSnapshot();
    }
    await this.scheduleNextAlarm();
  }

  async getSnapshot(workspaceId?: string, roomId?: string): Promise<RoomSnapshot> {
    if (workspaceId && roomId) await this.initMetadata(workspaceId, roomId);
    return this.buildRoomSnapshot();
  }

  protected async broadcastCurrentSnapshot() {
    const snapshot = this.buildRoomSnapshot();
    this.logger.debug("broadcast snapshot begin", {
      workspaceId: this.workspaceId,
      roomId: this.roomId,
      target: "room-local-ws-clients",
      onlineCount:
        snapshot.roomKind === "chat"
          ? snapshot.participantCount
          : snapshot.sessionCount,
      readerCount:
        snapshot.roomKind === "chat"
          ? snapshot.participants.length
          : snapshot.sessions.length,
      revision: snapshot.revision,
      connectionCount: this.getConnectionCount(),
    });
    super.broadcastSnapshot(snapshot);
    this.logger.debug("broadcast snapshot done", {
      workspaceId: this.workspaceId,
      roomId: this.roomId,
      connectionCount: this.getConnectionCount(),
    });
  }
}

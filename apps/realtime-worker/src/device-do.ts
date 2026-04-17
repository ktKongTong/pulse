import { DurableObject } from "cloudflare:workers";
import { drizzle } from 'drizzle-orm/durable-sqlite';
import { migrate } from 'drizzle-orm/durable-sqlite/migrator';
import { eq } from 'drizzle-orm';
import * as schema from './db/schema';
import { loadDrizzleMigrations } from "./db/migrations";

import {
  PresenceIngestAckSchema,
  type PresenceIngestRequest,
} from "@pulse/realtime-protocol";

import type { RoomRpc } from "./durable-stubs";
import type { Env } from "./env";
import { createWorkerLogger } from "./logger";
import type { DevicePresenceState } from "./runtime-models";
import { coerceNonNegativeInt, dayKeyFromIso } from "./stats-utils";

const migrations = loadDrizzleMigrations();
export class DeviceDO extends DurableObject<Env> {
  private db: ReturnType<typeof drizzle>;
  private workspaceId: string = "unknown";
  private deviceId: string = "unknown";
  
  private currentState: DevicePresenceState | null = null;
  private readonly logger;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.db = drizzle(this.ctx.storage, { schema });
    this.logger = createWorkerLogger(env, "device.do");
    this.ctx.blockConcurrencyWhile(async () => {
      await migrate(this.db, { migrations });

      const stored = await this.ctx.storage.get<{ w: string; d: string }>("meta");
      if (stored) {
        this.workspaceId = stored.w;
        this.deviceId = stored.d;
      }
      const state = await this.ctx.storage.get<DevicePresenceState>("currentState");
      if (state && (state.expiresAtMs == null || state.expiresAtMs > Date.now())) {
        this.currentState = state;
      } else if (state) {
        await this.ctx.storage.delete("currentState");
      }
    });
  }

  async initMetadata(workspaceId: string, deviceId: string) {
    if (this.workspaceId === workspaceId && this.deviceId === deviceId) return;
    this.workspaceId = workspaceId;
    this.deviceId = deviceId;
    await this.ctx.storage.put("meta", { w: workspaceId, d: deviceId });
  }

  // --- RPC Methods ---

  // High-performance hot state update
  async handlePresenceIngest(request: PresenceIngestRequest, ttlMs: number) {
    await this.initMetadata(request.workspaceId, request.deviceId);
    
    const latestEvent = request.events[request.events.length - 1];
    if (latestEvent) {
      const previousState = this.currentState;
      if (latestEvent.kind === "session_end" || !latestEvent.state) {
        this.currentState = null;
      } else {
        this.currentState = {
          ...latestEvent.state,
          sessionId: request.sessionId,
          deviceId: request.deviceId,
          updatedAt: latestEvent.observedAt,
          expiresAtMs: Date.now() + ttlMs,
          lastCountedAtMs: Date.parse(latestEvent.observedAt) || Date.now(),
        };
      }
      
      if (this.currentState) {
        await this.ctx.storage.put("currentState", this.currentState);
      } else {
        await this.ctx.storage.delete("currentState");
      }
      if (latestEvent.state) {
        const day = dayKeyFromIso(latestEvent.observedAt);
        const rowId = `${day}|${request.deviceId}`;
        const previousAppId = previousState?.focus?.app?.id ?? previousState?.focus?.app?.name ?? null;
        const nextAppId = latestEvent.state.focus?.app?.id ?? latestEvent.state.focus?.app?.name ?? null;
        const previousMediaId =
          previousState?.mediaSessions?.[0]?.item?.id ??
          previousState?.mediaSessions?.[0]?.item?.title ??
          null;
        const nextMediaId =
          latestEvent.state.mediaSessions?.[0]?.item?.id ??
          latestEvent.state.mediaSessions?.[0]?.item?.title ??
          null;
        const focusSwitchDelta =
          previousAppId && nextAppId && previousAppId !== nextAppId ? 1 : 0;
        const mediaSwitchDelta =
          previousMediaId && nextMediaId && previousMediaId !== nextMediaId ? 1 : 0;
        const sessionDelta = previousState == null ? 1 : 0;
        const existingStatsRow =
          this.db
            .select()
            .from(schema.deviceDailyStats)
            .where(eq(schema.deviceDailyStats.id, rowId))
            .all()[0] ?? null;
        const existingStats = existingStatsRow
          ? {
              focusSwitchCount: coerceNonNegativeInt(existingStatsRow.focusSwitchCount),
              mediaSwitchCount: coerceNonNegativeInt(existingStatsRow.mediaSwitchCount),
              sessionCount: coerceNonNegativeInt(existingStatsRow.sessionCount),
            }
          : null;

        this.db
          .insert(schema.deviceDailyStats)
          .values({
            id: rowId,
            day,
            deviceId: request.deviceId,
            focusSwitchCount: (existingStats?.focusSwitchCount ?? 0) + focusSwitchDelta,
            mediaSwitchCount: (existingStats?.mediaSwitchCount ?? 0) + mediaSwitchDelta,
            sessionCount: (existingStats?.sessionCount ?? 0) + sessionDelta,
          })
          .onConflictDoUpdate({
            target: schema.deviceDailyStats.id,
            set: {
              focusSwitchCount: (existingStats?.focusSwitchCount ?? 0) + focusSwitchDelta,
              mediaSwitchCount: (existingStats?.mediaSwitchCount ?? 0) + mediaSwitchDelta,
              sessionCount: (existingStats?.sessionCount ?? 0) + sessionDelta,
            },
          })
          .run();
      }
      this.logger.debug("presence stored", {
        workspaceId: request.workspaceId,
        deviceId: request.deviceId,
        ttlMs,
        latestEventId: latestEvent.eventId,
        latestSeq: latestEvent.seq,
        kind: latestEvent.kind,
        availability: latestEvent.state?.availability?.state ?? null,
        focus: latestEvent.state?.focus?.state ?? null,
      });
      
      // Push state up to RoomDO ('global') instead of SessionDO directly
      this.ctx.waitUntil(this.notifyRoomDO());
    }

    return PresenceIngestAckSchema.parse({
      workspaceId: request.workspaceId,
      deviceId: request.deviceId,
      acceptedSeqMax: latestEvent?.seq ?? 0,
      dedupedEventIds: [],
      rejected: [],
      workspaceRevision: Date.now(),
    });
  }

  // Deep historical archiving (batch SQL writes)
  async handleHistoryIngest(payload: any) {
    // Expected rough payload shape based on PRD:
    // { type: "HISTORY_INGEST", workspaceId: "...", deviceId: "...", events: [{ id, eventType, appName, durationMs, createdAt }] }
    await this.initMetadata(payload.workspaceId, payload.deviceId);

    if (Array.isArray(payload.events) && payload.events.length > 0) {
      this.ctx.storage.transactionSync(() => {
        for (const ev of payload.events) {
          this.db.insert(schema.presenceEvents).values({
            id: ev.id,
            eventType: ev.eventType || 'FOCUS',
            appName: ev.appName || 'Unknown',
            metadata: ev.metadata ? JSON.stringify(ev.metadata) : null,
            durationMs: ev.durationMs || 0,
            createdAt: ev.createdAt || Date.now(),
          }).onConflictDoNothing({ target: schema.presenceEvents.id }).run();
        }
      });
    }

    return { success: true, count: payload.events?.length || 0 };
  }

  async getDeviceSnapshot() {
    return {
      deviceId: this.deviceId,
      state: this.currentState
    };
  }

  private async notifyRoomDO() {
    try {
      this.logger.debug("notify room start", {
        workspaceId: this.workspaceId,
        deviceId: this.deviceId,
        hasState: this.currentState != null,
        updatedAt: this.currentState?.updatedAt ?? null,
      });
      const roomStub = this.env.REALTIME_ROOM.get(
        this.env.REALTIME_ROOM.idFromName(`${this.workspaceId}:global`)
      ) as unknown as RoomRpc;
      
      await roomStub.pushDeviceUpdate(this.workspaceId, "global", this.deviceId, this.currentState);
      this.logger.debug("notify room success", {
        workspaceId: this.workspaceId,
        deviceId: this.deviceId,
      });
    } catch (err) {
      this.logger.warn(`failed to push to RoomDO(global) from ${this.deviceId}`, err as Error);
    }
  }
}

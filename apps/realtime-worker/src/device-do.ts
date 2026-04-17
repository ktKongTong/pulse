import { DurableObject } from "cloudflare:workers";
import { drizzle } from 'drizzle-orm/durable-sqlite';
import { migrate } from 'drizzle-orm/durable-sqlite/migrator';
import * as schema from './db/schema';

import {
  PresenceIngestAckSchema,
  type PresenceIngestRequest,
} from "@pulse/realtime-protocol";

import type { Env } from "./env";

const drizzleMigrations = import.meta.glob('./db/migrations/**/*.sql', { query: '?raw', import: 'default', eager: true });
const migrations: Record<string, string> = {};
for (const [path, query] of Object.entries(drizzleMigrations)) {
  // Key needs to be like "20260414112459_name/migration.sql" — Drizzle parses first 14 chars as date
  const parts = path.split('/');
  const key = parts.slice(-2).join('/');
  migrations[key] = query as string;
}
export class DeviceDO extends DurableObject<Env> {
  private db: ReturnType<typeof drizzle>;
  private workspaceId: string = "unknown";
  private deviceId: string = "unknown";
  
  private currentState: any = null;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.db = drizzle(this.ctx.storage, { schema });
    this.ctx.blockConcurrencyWhile(async () => {
      await migrate(this.db, { migrations });

      const stored = await this.ctx.storage.get<{ w: string; d: string }>("meta");
      if (stored) {
        this.workspaceId = stored.w;
        this.deviceId = stored.d;
      }
      const state = await this.ctx.storage.get<any>("currentState");
      if (state) {
        this.currentState = state;
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
      if (latestEvent.kind === "session_end" || !latestEvent.state) {
        this.currentState = null;
      } else {
        this.currentState = {
          ...latestEvent.state,
          sessionId: request.sessionId,
          deviceId: request.deviceId,
          updatedAt: latestEvent.observedAt
        };
      }
      
      // Persist latest state so we don't lose it on worker restart
      await this.ctx.storage.put("currentState", this.currentState);
      console.log("[device.presence] stored", {
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
      console.log("[device.notifyRoom] start", {
        workspaceId: this.workspaceId,
        deviceId: this.deviceId,
        hasState: this.currentState != null,
        updatedAt: this.currentState?.updatedAt ?? null,
      });
      const roomStub = this.env.REALTIME_ROOM.get(
        this.env.REALTIME_ROOM.idFromName(`${this.workspaceId}:global`)
      ) as any;
      
      await roomStub.pushDeviceUpdate(this.workspaceId, "global", this.deviceId, this.currentState);
      console.log("[device.notifyRoom] success", {
        workspaceId: this.workspaceId,
        deviceId: this.deviceId,
      });
    } catch (err) {
      console.warn(`Failed to push to RoomDO (global) from DeviceDO ${this.deviceId}`, err);
    }
  }
}

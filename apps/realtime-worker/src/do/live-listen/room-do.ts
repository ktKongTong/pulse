import { DurableObject } from "cloudflare:workers";
import {
  LIVE_LISTEN_STREAM_PROTOCOL_V1,
  LiveListenHostHeartbeatRequestSchema,
  LiveListenHostStartRequestSchema,
  LiveListenHostStopRequestSchema,
  LiveListenListenerJoinRequestSchema,
  LiveListenListenerLeaveRequestSchema,
  LiveListenSnapshotSchema,
  type LiveListenAudioSession,
  type LiveListenHostHeartbeatRequest,
  type LiveListenHostStartRequest,
  type LiveListenHostStopRequest,
  type LiveListenListenerJoinRequest,
  type LiveListenListenerLeaveRequest,
  type LiveListenSnapshot,
  type LiveListenStreamEnvelope,
  type LiveListenToken,
  type LiveListenTokenResponse,
} from "@pulse/realtime-protocol";

import type { Env } from "../../config/env";

const LIVE_LISTEN_STATE_KEY = "live-listen-state";
const HOST_HEARTBEAT_TIMEOUT_MS = 10_000;
const LISTENER_TTL_MS = 30_000;
const CLEANUP_AFTER_ENDED_MS = 30_000;

interface ListenerRecord {
  participantId: string;
  updatedAtMs: number;
}

interface StoredLiveListenState {
  workspaceId: string;
  roomId: string;
  state: LiveListenSnapshot["state"];
  hostDeviceId?: string;
  startedAt?: string;
  updatedAt: string;
  audio?: LiveListenAudioSession;
  media?: LiveListenSnapshot["media"];
  clock?: LiveListenSnapshot["clock"];
  error?: LiveListenSnapshot["error"];
  listeners: Record<string, ListenerRecord>;
  revision: number;
  lastHostHeartbeatMs?: number;
  endedAtMs?: number;
}

export class LiveListenRoom extends DurableObject<Env> {
  private roomState?: StoredLiveListenState;
  private sseClients = new Set<ReadableStreamDefaultController<Uint8Array>>();

  async getSnapshot(
    workspaceId = this.env.WORKSPACE_ID,
    roomId = "live-listen:owner",
  ): Promise<LiveListenSnapshot> {
    const state = await this.loadState(workspaceId, roomId);
    await this.refreshExpirations(state);
    return this.snapshot(state);
  }

  async openEventStream(
    workspaceId = this.env.WORKSPACE_ID,
    roomId = "live-listen:owner",
  ): Promise<Response> {
    const state = await this.loadState(workspaceId, roomId);
    await this.refreshExpirations(state);
    return this.handleEvents(state);
  }

  async startHost(
    request: LiveListenHostStartRequest,
  ): Promise<LiveListenTokenResponse> {
    const payload = LiveListenHostStartRequestSchema.parse(request);
    const state = await this.loadState(payload.workspaceId, payload.roomId);
    this.assertWorkspaceAndRoom(payload.workspaceId, payload.roomId, state);

    const now = Date.now();
    const updatedAt = new Date(now).toISOString();
    state.state = "starting";
    state.hostDeviceId = payload.hostDeviceId;
    state.startedAt = updatedAt;
    state.updatedAt = updatedAt;
    state.audio = payload.audio ?? this.defaultAudioSession(state);
    state.error = undefined;
    state.lastHostHeartbeatMs = now;
    state.endedAtMs = undefined;
    state.revision += 1;

    await this.persist(state);
    await this.scheduleAlarm(state);
    await this.broadcastSnapshot(state);
    return this.tokenResponse(state, "host", payload.hostDeviceId);
  }

  async heartbeatHost(
    request: LiveListenHostHeartbeatRequest,
  ): Promise<LiveListenSnapshot> {
    const payload = LiveListenHostHeartbeatRequestSchema.parse(request);
    const state = await this.loadState(payload.workspaceId, payload.roomId);
    this.assertWorkspaceAndRoom(payload.workspaceId, payload.roomId, state);
    if (state.hostDeviceId && state.hostDeviceId !== payload.hostDeviceId) {
      throw new Error("host_device_mismatch");
    }

    state.hostDeviceId = payload.hostDeviceId;
    state.state = "live";
    state.updatedAt = payload.sentAt;
    state.media = payload.media ?? state.media;
    state.clock = payload.clock ?? state.clock;
    state.lastHostHeartbeatMs = Date.now();
    state.endedAtMs = undefined;
    state.error = undefined;
    state.audio ??= this.defaultAudioSession(state);
    state.revision += 1;

    await this.persist(state);
    await this.scheduleAlarm(state);
    await this.broadcastSnapshot(state);
    return this.snapshot(state);
  }

  async stopHost(
    request: LiveListenHostStopRequest,
  ): Promise<LiveListenSnapshot> {
    const payload = LiveListenHostStopRequestSchema.parse(request);
    const state = await this.loadState(payload.workspaceId, payload.roomId);
    this.assertWorkspaceAndRoom(payload.workspaceId, payload.roomId, state);
    if (state.hostDeviceId && state.hostDeviceId !== payload.hostDeviceId) {
      throw new Error("host_device_mismatch");
    }

    state.state = "ended";
    state.updatedAt = payload.stoppedAt;
    state.lastHostHeartbeatMs = undefined;
    state.endedAtMs = Date.now();
    state.error = payload.reason
      ? { code: "host_stopped", message: payload.reason }
      : undefined;
    state.revision += 1;

    await this.persist(state);
    await this.scheduleAlarm(state);
    await this.broadcastSnapshot(state);
    return this.snapshot(state);
  }

  async joinListener(
    request: LiveListenListenerJoinRequest,
  ): Promise<LiveListenTokenResponse> {
    const payload = LiveListenListenerJoinRequestSchema.parse(request);
    const state = await this.loadState(payload.workspaceId, payload.roomId);
    this.assertWorkspaceAndRoom(payload.workspaceId, payload.roomId, state);

    state.listeners[payload.participantId] = {
      participantId: payload.participantId,
      updatedAtMs: Date.parse(payload.joinedAt) || Date.now(),
    };
    state.updatedAt = new Date().toISOString();
    state.audio ??= this.defaultAudioSession(state);
    state.revision += 1;

    await this.persist(state);
    await this.scheduleAlarm(state);
    await this.broadcast({
      protocol: LIVE_LISTEN_STREAM_PROTOCOL_V1,
      kind: "participant.joined",
      workspaceId: state.workspaceId,
      roomId: state.roomId,
      revision: state.revision,
      participantId: payload.participantId,
      snapshot: this.snapshot(state),
    });
    return this.tokenResponse(state, "listener", payload.participantId);
  }

  async leaveListener(
    request: LiveListenListenerLeaveRequest,
  ): Promise<LiveListenSnapshot> {
    const payload = LiveListenListenerLeaveRequestSchema.parse(request);
    const state = await this.loadState(payload.workspaceId, payload.roomId);
    this.assertWorkspaceAndRoom(payload.workspaceId, payload.roomId, state);

    delete state.listeners[payload.participantId];
    state.updatedAt = payload.leftAt;
    state.revision += 1;

    await this.persist(state);
    await this.scheduleAlarm(state);
    await this.broadcast({
      protocol: LIVE_LISTEN_STREAM_PROTOCOL_V1,
      kind: "participant.left",
      workspaceId: state.workspaceId,
      roomId: state.roomId,
      revision: state.revision,
      participantId: payload.participantId,
      snapshot: this.snapshot(state),
    });
    return this.snapshot(state);
  }

  async alarm() {
    const state = await this.loadState();
    await this.refreshExpirations(state);
    await this.scheduleAlarm(state);
  }

  private async refreshExpirations(state: StoredLiveListenState) {
    const changed = await this.expireStaleState(state, Date.now());
    if (!changed) return;
    await this.persist(state);
    await this.broadcastSnapshot(state);
  }

  private handleEvents(state: StoredLiveListenState): Response {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.sseClients.add(controller);
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(this.snapshotEnvelope(state))}\n\n`),
        );
      },
      cancel: () => {},
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  }

  private snapshot(state: StoredLiveListenState): LiveListenSnapshot {
    return LiveListenSnapshotSchema.parse({
      roomId: state.roomId,
      workspaceId: state.workspaceId,
      state: state.state,
      listenerCount: Object.keys(state.listeners).length,
      hostDeviceId: state.hostDeviceId,
      startedAt: state.startedAt,
      updatedAt: state.updatedAt,
      audio: state.audio,
      media: state.media,
      clock: state.clock,
      error: state.error,
    });
  }

  private snapshotEnvelope(state: StoredLiveListenState): LiveListenStreamEnvelope {
    return {
      protocol: LIVE_LISTEN_STREAM_PROTOCOL_V1,
      kind: "snapshot.updated",
      workspaceId: state.workspaceId,
      roomId: state.roomId,
      revision: state.revision,
      snapshot: this.snapshot(state),
    };
  }

  private tokenResponse(
    state: StoredLiveListenState,
    role: LiveListenToken["role"],
    participantId: string,
  ): LiveListenTokenResponse {
    const token: LiveListenToken = {
      transport: "cloudflare-realtime",
      sessionId: state.audio?.sessionId ?? this.defaultAudioSession(state).sessionId,
      participantId,
      role,
      token: this.mockToken(state, role, participantId),
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    };

    return {
      protocol: "live-listen.v1",
      roomId: state.roomId,
      workspaceId: state.workspaceId,
      snapshot: this.snapshot(state),
      token,
    };
  }

  private defaultAudioSession(state: StoredLiveListenState): LiveListenAudioSession {
    return {
      transport: "cloudflare-realtime",
      sessionId: `pulse:${state.workspaceId}:${state.roomId}`,
      roomName: state.roomId,
      publishTrackName: "host-audio",
      mockToken: true,
    };
  }

  private mockToken(
    state: StoredLiveListenState,
    role: LiveListenToken["role"],
    participantId: string,
  ) {
    const raw = `${state.workspaceId}:${state.roomId}:${role}:${participantId}:${state.revision}`;
    return `mock.${btoa(raw).replace(/=+$/g, "")}`;
  }

  private async expireStaleState(
    state: StoredLiveListenState,
    nowMs: number,
  ): Promise<boolean> {
    let changed = false;
    for (const [participantId, listener] of Object.entries(state.listeners)) {
      if (nowMs - listener.updatedAtMs > LISTENER_TTL_MS) {
        delete state.listeners[participantId];
        changed = true;
      }
    }

    if (
      (state.state === "starting" || state.state === "live") &&
      state.lastHostHeartbeatMs &&
      nowMs - state.lastHostHeartbeatMs > HOST_HEARTBEAT_TIMEOUT_MS
    ) {
      state.state = "offline";
      state.updatedAt = new Date(nowMs).toISOString();
      state.lastHostHeartbeatMs = undefined;
      state.error = { code: "host_timeout", message: "Host heartbeat timed out." };
      changed = true;
    }

    if (
      state.state === "ended" &&
      state.endedAtMs &&
      nowMs - state.endedAtMs > CLEANUP_AFTER_ENDED_MS
    ) {
      state.state = "offline";
      state.updatedAt = new Date(nowMs).toISOString();
      state.hostDeviceId = undefined;
      state.startedAt = undefined;
      state.audio = undefined;
      state.error = undefined;
      changed = true;
    }

    if (changed) state.revision += 1;
    return changed;
  }

  private async scheduleAlarm(state: StoredLiveListenState) {
    const now = Date.now();
    const candidates: number[] = [];
    if (state.lastHostHeartbeatMs) {
      candidates.push(state.lastHostHeartbeatMs + HOST_HEARTBEAT_TIMEOUT_MS + 1);
    }
    for (const listener of Object.values(state.listeners)) {
      candidates.push(listener.updatedAtMs + LISTENER_TTL_MS + 1);
    }
    if (state.endedAtMs) {
      candidates.push(state.endedAtMs + CLEANUP_AFTER_ENDED_MS + 1);
    }

    const next = candidates.filter((value) => value > now).sort((a, b) => a - b)[0];
    if (next) await this.ctx.storage.setAlarm(next);
  }

  private async broadcastSnapshot(state: StoredLiveListenState) {
    await this.broadcast(this.snapshotEnvelope(state));
  }

  private async broadcast(envelope: LiveListenStreamEnvelope) {
    const payload = new TextEncoder().encode(`data: ${JSON.stringify(envelope)}\n\n`);
    for (const controller of this.sseClients) {
      try {
        controller.enqueue(payload);
      } catch {
        this.sseClients.delete(controller);
      }
    }
  }

  private assertWorkspaceAndRoom(
    workspaceId: string,
    roomId: string,
    state: StoredLiveListenState,
  ) {
    if (workspaceId !== state.workspaceId) {
      throw new Error("workspace_mismatch");
    }
    if (roomId !== state.roomId) {
      throw new Error("room_mismatch");
    }
  }

  private async loadState(
    workspaceId = this.env.WORKSPACE_ID,
    roomId = "live-listen:owner",
  ): Promise<StoredLiveListenState> {
    if (this.roomState) return this.roomState;
    const loaded = await this.ctx.storage.get<StoredLiveListenState>(LIVE_LISTEN_STATE_KEY);
    this.roomState = loaded ?? {
      workspaceId,
      roomId,
      state: "offline",
      updatedAt: new Date(0).toISOString(),
      listeners: {},
      revision: 0,
    };
    return this.roomState;
  }

  private async persist(state: StoredLiveListenState) {
    this.roomState = state;
    await this.ctx.storage.put(LIVE_LISTEN_STATE_KEY, state);
  }
}

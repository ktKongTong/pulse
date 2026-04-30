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

interface LiveListenSocketAttachment {
  workspaceId: string;
  roomId: string;
  connectionId: string;
}

export class LiveListenRoom extends DurableObject<Env> {
  private roomState?: StoredLiveListenState;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("ping", "pong"),
    );
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket", { status: 426 });
    }

    const url = new URL(request.url);
    const workspaceId = url.searchParams.get("workspaceId") ?? this.env.WORKSPACE_ID;
    const roomId = url.searchParams.get("roomId") ?? "live-listen:owner";
    const state = await this.loadState(workspaceId, roomId);
    this.assertWorkspaceAndRoom(workspaceId, roomId, state);
    await this.refreshExpirations(state);

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.serializeAttachment({
      workspaceId,
      roomId,
      connectionId: crypto.randomUUID(),
    } satisfies LiveListenSocketAttachment);
    this.ctx.acceptWebSocket(server);
    this.sendSocketEnvelope(server, this.snapshotEnvelope(state));

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    const raw = typeof message === "string" ? message : new TextDecoder().decode(message);
    if (raw === "ping") return;
    if (raw === "snapshot") {
      const attachment = this.socketAttachment(socket);
      if (!attachment) return;
      const state = await this.loadState(attachment.workspaceId, attachment.roomId);
      await this.refreshExpirations(state);
      this.sendSocketEnvelope(socket, this.snapshotEnvelope(state));
    }
  }

  async webSocketClose(_socket: WebSocket) {}

  async webSocketError(_socket: WebSocket, _error: unknown) {}

  async getSnapshot(
    workspaceId = this.env.WORKSPACE_ID,
    roomId = "live-listen:owner",
  ): Promise<LiveListenSnapshot> {
    const state = await this.loadState(workspaceId, roomId);
    this.assertWorkspaceAndRoom(workspaceId, roomId, state);
    await this.refreshExpirations(state);
    return this.snapshot(state);
  }


  async startHost(
    request: LiveListenHostStartRequest,
  ): Promise<LiveListenTokenResponse> {
    const payload = LiveListenHostStartRequestSchema.parse(request);
    const state = await this.loadState(payload.workspaceId, payload.roomId);
    this.assertWorkspaceAndRoom(payload.workspaceId, payload.roomId, state);

    const now = Date.now();
    const updatedAt = payload.requestedAt;
    state.state = "starting";
    state.hostDeviceId = payload.hostDeviceId;
    state.startedAt = updatedAt;
    state.updatedAt = updatedAt;
    state.audio = payload.audio ?? this.defaultAudioSession(state);
    state.media = undefined;
    state.clock = undefined;
    state.error = undefined;
    state.listeners = {};
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
    state.startedAt ??= payload.sentAt;
    state.audio = payload.audio ?? state.audio ?? this.defaultAudioSession(state);
    state.media = payload.media ?? state.media;
    state.clock = payload.clock ?? state.clock;
    state.lastHostHeartbeatMs = Date.now();
    state.endedAtMs = undefined;
    state.error = undefined;
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
    await this.refreshExpirations(state);
    if (state.state !== "starting" && state.state !== "live") {
      throw new Error("live_listen_not_active");
    }

    const existing = state.listeners[payload.participantId];
    state.listeners[payload.participantId] = {
      participantId: payload.participantId,
      updatedAtMs: Date.parse(payload.joinedAt) || Date.now(),
    };
    state.updatedAt = new Date().toISOString();
    state.audio ??= this.defaultAudioSession(state);
    state.revision += 1;

    await this.persist(state);
    await this.scheduleAlarm(state);
    if (existing) {
      await this.broadcastSnapshot(state);
    } else {
      await this.broadcast({
        protocol: LIVE_LISTEN_STREAM_PROTOCOL_V1,
        kind: "participant.joined",
        workspaceId: state.workspaceId,
        roomId: state.roomId,
        revision: state.revision,
        participantId: payload.participantId,
        snapshot: this.snapshot(state),
      });
    }
    return this.tokenResponse(state, "listener", payload.participantId);
  }

  async leaveListener(
    request: LiveListenListenerLeaveRequest,
  ): Promise<LiveListenSnapshot> {
    const payload = LiveListenListenerLeaveRequestSchema.parse(request);
    const state = await this.loadState(payload.workspaceId, payload.roomId);
    this.assertWorkspaceAndRoom(payload.workspaceId, payload.roomId, state);
    if (!state.listeners[payload.participantId]) return this.snapshot(state);

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
      partyTracksPrefix: "/api/v1/live-listen/partytracks",
      sessionId: `pulse:${state.workspaceId}:${state.roomId}`,
      roomName: state.roomId,
      publishTrackName: "host-audio",
      track: {
        location: "remote",
        trackName: "host-audio",
        sessionId: `pulse:${state.workspaceId}:${state.roomId}`,
      },
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
      state.hostDeviceId = undefined;
      state.audio = undefined;
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
      state.media = undefined;
      state.clock = undefined;
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
    if (next) {
      await this.ctx.storage.setAlarm(next);
    } else {
      await this.ctx.storage.deleteAlarm();
    }
  }

  private async broadcastSnapshot(state: StoredLiveListenState) {
    await this.broadcast(this.snapshotEnvelope(state));
  }

  private async broadcast(envelope: LiveListenStreamEnvelope) {
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = this.socketAttachment(socket);
      if (
        attachment?.workspaceId !== envelope.workspaceId ||
        attachment?.roomId !== envelope.roomId
      ) {
        continue;
      }
      this.sendSocketEnvelope(socket, envelope);
    }
  }

  private sendSocketEnvelope(socket: WebSocket, envelope: LiveListenStreamEnvelope) {
    try {
      socket.send(JSON.stringify(envelope));
    } catch {
      socket.close(1011, "live listen send failed");
    }
  }

  private socketAttachment(socket: WebSocket): LiveListenSocketAttachment | null {
    const attachment = socket.deserializeAttachment() as LiveListenSocketAttachment | null;
    if (!attachment?.workspaceId || !attachment.roomId || !attachment.connectionId) {
      return null;
    }
    return attachment;
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

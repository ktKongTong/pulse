import { DurableObject } from "cloudflare:workers";
import {
  LIVE_LISTEN_DEVICE_PROTOCOL_V1,
  LIVE_LISTEN_MEDIA_SESSION_PROTOCOL_V1,
  LIVE_LISTEN_OBSERVE_PROTOCOL_V1,
  LIVE_LISTEN_PROTOCOL_V1,
  LiveListenDeviceFrameSchema,
  LiveListenHostHeartbeatRequestSchema,
  LiveListenHostStartRequestSchema,
  LiveListenHostStopRequestSchema,
  LiveListenListenerJoinRequestSchema,
  LiveListenListenerLeaveRequestSchema,
  LiveListenMediaSessionClientMessageSchema,
  LiveListenRoomMediaStateSchema,
  LiveListenSnapshotSchema,
  type LiveListenAdmission,
  type LiveListenAdmissionBlockedReason,
  type LiveListenAudioFlow,
  type LiveListenClock,
  type LiveListenDeviceCommandEnvelope,
  type LiveListenDeviceFrame,
  type LiveListenHostHeartbeatRequest,
  type LiveListenHostStartRequest,
  type LiveListenHostStopRequest,
  type LiveListenListenerJoinRequest,
  type LiveListenListenerLeaveRequest,
  type LiveListenMedia,
  type LiveListenNativeLink,
  type LiveListenNativeMediaState,
  type LiveListenRecentMedia,
  type LiveListenRoomMediaState,
  type LiveListenSnapshot,
  type LiveListenStreamDemand,
  type LiveListenToken,
  type LiveListenTokenResponse,
} from "@pulse/realtime-protocol";

import { liveListenStreamConfig, type Env } from "../../config/env";

const LIVE_LISTEN_STATE_KEY = "live-listen-state";
const LISTENER_RECONNECT_GRACE_MS = 20_000;
const ROOM_EMPTY_GRACE_MS = 15_000;
const NATIVE_RECONNECT_GRACE_MS = 45_000;
const AUDIO_CHUNK_PERSIST_INTERVAL_MS = 2_000;
const AUDIO_CHUNK_OBSERVER_INTERVAL_MS = 1_000;
const RECENT_MEDIA_LIMIT = 5;

type SocketRole = "device" | "observer" | "media-session";

interface AudioChunkRecord {
  streamId: string;
  generation: number;
  seq: number;
  sentAt: string;
  durationMs: number;
  codec: "pcm16-wav";
  byteLength: number;
  data: ArrayBuffer;
}

interface ListenerRecord {
  participantId: string;
  resumeToken: string;
  state: "active" | "grace";
  socketId?: string;
  joinedAt: string;
  lastSeenAt: string;
  disconnectedAt?: string;
  graceDeadlineAt?: string;
  lastAckSeq?: number;
}

interface StoredLiveListenState {
  workspaceId: string;
  roomId: string;
  updatedAt: string;
  hostDeviceId?: string;
  nativeLink: LiveListenNativeLink;
  nativeMediaState: LiveListenNativeMediaState;
  admission: LiveListenAdmission;
  media: LiveListenRoomMediaState;
  streamDemand: LiveListenStreamDemand;
  audioFlow: LiveListenAudioFlow;
  listeners: Record<string, ListenerRecord>;
  audioRing: AudioChunkRecord[];
  revision: number;
  roomEmptyDeadlineAt?: string;
}

type PersistedLiveListenState = Omit<StoredLiveListenState, "audioRing">;

interface LiveListenRoomTelemetrySnapshot {
  bytesIn: number;
  bytesOut: number;
  chunksIn: number;
  chunksOut: number;
  replayChunks: number;
  replayMisses: number;
  lastChunkBytes: number;
}

class LiveListenRoomTelemetry {
  private snapshotState: LiveListenRoomTelemetrySnapshot = {
    bytesIn: 0,
    bytesOut: 0,
    chunksIn: 0,
    chunksOut: 0,
    replayChunks: 0,
    replayMisses: 0,
    lastChunkBytes: 0,
  };

  recordChunkIn(byteLength: number) {
    this.snapshotState.bytesIn += byteLength;
    this.snapshotState.chunksIn += 1;
    this.snapshotState.lastChunkBytes = byteLength;
  }

  recordChunkOut(byteLength: number, count = 1) {
    this.snapshotState.bytesOut += byteLength * count;
    this.snapshotState.chunksOut += count;
  }

  recordReplayChunk(byteLength: number) {
    this.snapshotState.replayChunks += 1;
    this.recordChunkOut(byteLength);
  }

  recordReplayMiss() {
    this.snapshotState.replayMisses += 1;
  }

  snapshot(): LiveListenRoomTelemetrySnapshot {
    return { ...this.snapshotState };
  }
}

interface LiveListenSocketAttachment {
  workspaceId: string;
  roomId: string;
  socketId: string;
  role: SocketRole;
  participantId?: string;
  deviceId?: string;
}

interface ListenerRequestParams {
  participantId?: string;
  resumeToken?: string;
  streamId?: string;
  generation?: number;
  fromSeq?: number;
}

export class LiveListenRoom extends DurableObject<Env> {
  private roomState?: StoredLiveListenState;
  private readonly telemetry = new LiveListenRoomTelemetry();
  private lastAudioChunkPersistAt = 0;
  private lastAudioChunkObserverBroadcastAt = 0;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("ping", "pong"),
    );
  }

  async fetch(request: Request): Promise<Response> {
    console.log("connection")
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket", { status: 426 });
    }

    const url = new URL(request.url);
    const role = this.socketRole(url.pathname);
      console.log("unknown");
    if (!role) return new Response("Unknown live listen websocket", { status: 404 });
    const workspaceId = url.searchParams.get("workspaceId") ?? this.env.WORKSPACE_ID;
    const roomId = url.searchParams.get("roomId") ?? "live-listen:owner";
    const state = await this.loadState(workspaceId, roomId);
    this.assertWorkspaceAndRoom(workspaceId, roomId, state);
    await this.refreshExpirations(state);

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const socketId = crypto.randomUUID();
    const attachment: LiveListenSocketAttachment = { workspaceId, roomId, socketId, role };
    server.serializeAttachment(attachment);
    this.ctx.acceptWebSocket(server);
      console.log("accept");
    if (role === "observer") {
      this.sendObserverTelemetry(server, state);
    } else if (role === "media-session") {
      this.sendMediaSessionSnapshot(server, state);
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    const attachment = this.socketAttachment(socket);
    if (!attachment) return;
    const state = await this.loadState(attachment.workspaceId, attachment.roomId);
    await this.refreshExpirations(state);
    if (attachment.role === "media-session") {
      if (typeof message === "string") await this.handleMediaSessionMessage(socket, state, attachment, message);
      return;
    }

    if (attachment.role !== "device") return;
    if (typeof message === "string") {
      await this.handleDeviceTextFrame(socket, state, attachment, message);
      return;
    }

    await this.handleDeviceAudioFrame(state, message);
  }

  async webSocketClose(socket: WebSocket) {
    await this.handleSocketGone(socket);
  }

  async webSocketError(socket: WebSocket) {
    await this.handleSocketGone(socket);
  }

  async getSnapshot(
    workspaceId = this.env.WORKSPACE_ID,
    roomId = "live-listen:owner",
  ): Promise<LiveListenSnapshot> {
    const state = await this.loadState(workspaceId, roomId);
    this.assertWorkspaceAndRoom(workspaceId, roomId, state);
    await this.refreshExpirations(state);
    return this.snapshot(state);
  }

  async startHost(request: LiveListenHostStartRequest): Promise<LiveListenTokenResponse> {
    const payload = LiveListenHostStartRequestSchema.parse(request);
    const state = await this.loadState(payload.workspaceId, payload.roomId);
    this.assertWorkspaceAndRoom(payload.workspaceId, payload.roomId, state);
    const mediaState: LiveListenNativeMediaState = {
      permission: "allow",
      playback: "playing",
      capture: "no-capture",
      media: {
        provider: "local",
        title: payload.audio?.roomName ?? "Live Listen host audio",
        playbackState: "playing",
      },
    };
    this.applyDeviceOnline(state, payload.hostDeviceId, payload.requestedAt, mediaState);
    await this.persistAndBroadcast(state);
    return this.tokenResponse(state, "host", payload.hostDeviceId);
  }

  async heartbeatHost(request: LiveListenHostHeartbeatRequest): Promise<LiveListenSnapshot> {
    const payload = LiveListenHostHeartbeatRequestSchema.parse(request);
    const state = await this.loadState(payload.workspaceId, payload.roomId);
    this.assertWorkspaceAndRoom(payload.workspaceId, payload.roomId, state);
    const media = payload.media ?? {
      provider: "local" as const,
      title: payload.audio?.roomName ?? "Live Listen host audio",
      playbackState: "playing" as const,
    };
    this.applyDeviceOnline(state, payload.hostDeviceId, payload.sentAt, {
      permission: "allow",
      playback: media.playbackState === "playing" ? "playing" : "paused",
      capture: "no-capture",
      reason: media.playbackState === "playing" ? undefined : "no_playable_media",
      media: media.playbackState === "playing" ? { ...media, playbackState: "playing" } : media,
    });
    if (payload.media) this.updateMedia(state, payload.media, payload.hostDeviceId, payload.sentAt, payload.clock);
    await this.persistAndBroadcast(state);
    return this.snapshot(state);
  }

  async stopHost(request: LiveListenHostStopRequest): Promise<LiveListenSnapshot> {
    const payload = LiveListenHostStopRequestSchema.parse(request);
    const state = await this.loadState(payload.workspaceId, payload.roomId);
    this.assertWorkspaceAndRoom(payload.workspaceId, payload.roomId, state);
    this.stopStream(state, payload.reason ?? "manual_stop", payload.stoppedAt);
    await this.persistAndBroadcast(state);
    return this.snapshot(state);
  }

  async joinListener(request: LiveListenListenerJoinRequest): Promise<LiveListenTokenResponse> {
    const payload = LiveListenListenerJoinRequestSchema.parse(request);
    const state = await this.loadState(payload.workspaceId, payload.roomId);
    this.assertWorkspaceAndRoom(payload.workspaceId, payload.roomId, state);
    const resumeToken = state.listeners[payload.participantId]?.resumeToken ?? this.resumeToken();
    state.listeners[payload.participantId] = {
      participantId: payload.participantId,
      resumeToken,
      state: "active",
      joinedAt: payload.joinedAt,
      lastSeenAt: payload.joinedAt,
    };
    this.ensureStreamDemand(state, payload.joinedAt);
    await this.persistAndBroadcast(state);
    return this.tokenResponse(state, "listener", payload.participantId);
  }

  async leaveListener(request: LiveListenListenerLeaveRequest): Promise<LiveListenSnapshot> {
    const payload = LiveListenListenerLeaveRequestSchema.parse(request);
    const state = await this.loadState(payload.workspaceId, payload.roomId);
    this.assertWorkspaceAndRoom(payload.workspaceId, payload.roomId, state);
    if (state.listeners[payload.participantId]) {
      delete state.listeners[payload.participantId];
      this.armRoomEmptyGraceIfNeeded(state, payload.leftAt);
      await this.persistAndBroadcast(state);
    }
    return this.snapshot(state);
  }

  async alarm() {
    const state = await this.loadState();
    await this.refreshExpirations(state);
    await this.scheduleAlarm(state);
  }

  private async acceptListenerRequest(
    socket: WebSocket,
    state: StoredLiveListenState,
    attachment: LiveListenSocketAttachment,
    params: ListenerRequestParams,
  ) {
    const now = new Date().toISOString();
    if (!this.canAcceptListener(state)) {
      const reason = state.admission.state === "blocked" ? state.admission.reason : "session_rejected";
      this.sendSession(socket, {
        type: "session.rejected",
        participantId: params.participantId,
        reason,
        snapshot: this.snapshot(state),
      });
      return;
    }

    const participantId = params.participantId ?? `listener_${crypto.randomUUID()}`;
    const resumeToken = params.resumeToken;
    const streamId = params.streamId;
    const generation = params.generation;
    const fromSeq = params.fromSeq;
    const existing = state.listeners[participantId];
    const resumed = Boolean(existing && resumeToken && existing.resumeToken === resumeToken);
    const listener: ListenerRecord = {
      participantId,
      resumeToken: existing?.resumeToken ?? this.resumeToken(),
      state: "active",
      socketId: attachment.socketId,
      joinedAt: existing?.joinedAt ?? now,
      lastSeenAt: now,
      lastAckSeq: fromSeq == null ? existing?.lastAckSeq : Math.max(0, fromSeq - 1),
    };
    state.listeners[participantId] = listener;
    attachment.participantId = participantId;
    socket.serializeAttachment(attachment);
    this.ensureStreamDemand(state, now);
    await this.sendNativeStartOrResume(state, resumed ? "resume" : "start");

    if (resumed) {
      this.sendSession(socket, {
        type: "session.resumed",
        participantId,
        streamId: state.audioFlow.streamId,
        generation: state.audioFlow.generation,
        requestedFromSeq: fromSeq,
        latestSeq: state.audioFlow.latestSeq,
        availableFromSeq: state.audioFlow.availableFromSeq,
        snapshot: this.snapshot(state),
      });
      if (streamId === state.audioFlow.streamId && generation === state.audioFlow.generation && fromSeq != null) {
        this.replayAudio(socket, state, fromSeq);
      }
    } else {
      this.sendSession(socket, {
        type: "session.accepted",
        participantId,
        resumeToken: listener.resumeToken,
        serverTime: now,
        snapshot: this.snapshot(state),
      });
    }
    await this.persistAndBroadcast(state);
  }

  private async handleMediaSessionMessage(
    socket: WebSocket,
    state: StoredLiveListenState,
    attachment: LiveListenSocketAttachment,
    message: string,
  ) {
    if (message.startsWith("ack:")) {
      this.handleListenerMessage(state, attachment, message);
      return;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(message);
    } catch {
      socket.close(1003, "invalid media session json");
      return;
    }
    const parsed = LiveListenMediaSessionClientMessageSchema.safeParse(payload);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const path = issue?.path.join(".") || "message";
      socket.close(1003, `invalid media session frame:${path}`);
      return;
    }
    const frame = parsed.data;
    if (frame.type === "listen.request") {
      await this.acceptListenerRequest(socket, state, attachment, {
        participantId: frame.participantId,
        resumeToken: frame.resumeToken,
        streamId: frame.streamId,
        generation: frame.sourceGeneration,
        fromSeq: frame.fromSeq,
      });
      return;
    }
    if (frame.type === "listen.stop") {
      await this.stopMediaSessionListener(socket, state, attachment, frame.participantId);
      return;
    }
    this.handleListenerAck(state, attachment, frame.seq);
  }

  private handleListenerMessage(
    state: StoredLiveListenState,
    attachment: LiveListenSocketAttachment,
    message: string,
  ) {
    if (message.startsWith("ack:")) {
      const seq = Number(message.slice(4));
      if (Number.isFinite(seq)) this.handleListenerAck(state, attachment, seq);
    }
  }

  private handleListenerAck(
    state: StoredLiveListenState,
    attachment: LiveListenSocketAttachment,
    seq: number,
  ) {
    if (!attachment.participantId) return;
    const listener = state.listeners[attachment.participantId];
    if (!listener) return;
    listener.lastSeenAt = new Date().toISOString();
    listener.lastAckSeq = Math.max(listener.lastAckSeq ?? 0, seq);
  }

  private async stopMediaSessionListener(
    socket: WebSocket,
    state: StoredLiveListenState,
    attachment: LiveListenSocketAttachment,
    participantId?: string,
  ) {
    if (participantId && participantId !== attachment.participantId) return;
    const currentParticipantId = attachment.participantId;
    if (!currentParticipantId) return;
    delete state.listeners[currentParticipantId];
    if (attachment.participantId === currentParticipantId) {
      attachment.participantId = undefined;
      socket.serializeAttachment(attachment);
    }
    this.armRoomEmptyGraceIfNeeded(state, new Date().toISOString());
    await this.persistAndBroadcast(state);
  }

  private async handleDeviceTextFrame(
    socket: WebSocket,
    state: StoredLiveListenState,
    attachment: LiveListenSocketAttachment,
    message: string,
  ) {
    const parsed = LiveListenDeviceFrameSchema.safeParse(JSON.parse(message) as unknown);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const path = issue?.path.join(".") || "frame";
      socket.close(1003, `invalid device frame:${path}`);
      return;
    }
    const frame = parsed.data;
    if (!attachment.deviceId && frame.type !== "device.hello") {
      socket.close(1008, "device hello required");
      return;
    }
    if ("deviceId" in frame && frame.deviceId) {
      attachment.deviceId = frame.deviceId;
      socket.serializeAttachment(attachment);
    }

    if (frame.type === "device.hello") {
      this.applyDeviceHello(state, frame);
      if (state.streamDemand.state === "wanted" && this.listenerDemandCount(state) > 0 && this.canAcceptListener(state)) {
        await this.sendNativeStartOrResume(
          state,
          frame.lastStreamId && frame.lastStreamId === state.audioFlow.streamId ? "resume" : "start",
        );
      } else if (frame.lastStreamId) {
        this.sendNativeStop(state, "last_listener_disconnected");
      }
    } else if (frame.type === "media.state.updated") {
      this.applyNativeMediaState(state, frame.deviceId, frame.sentAt, frame.mediaState);
    } else if (frame.type === "media.updated") {
      this.updateMedia(state, frame.media, frame.deviceId, frame.sentAt, frame.clock);
    } else if (frame.type === "stream.heartbeat") {
      this.applyStreamHeartbeat(state, frame);
    } else if (frame.type === "ack") {
      this.applyDeviceAck(state, frame);
    } else if (frame.type === "stream.stopped") {
      this.stopStream(state, frame.reason, frame.sentAt);
      this.broadcastSession({ type: "stream.ended", reason: frame.reason, snapshot: this.snapshot(state) });
    } else if (frame.type === "error") {
      state.nativeLink.state = "error";
      state.nativeLink.lastError = frame.error;
      state.audioFlow.state = "failed";
      state.audioFlow.failure = frame.error;
      state.admission = { state: "blocked", reason: "native_error", message: frame.error.message };
      this.broadcastSession({ type: "stream.error", reason: frame.error.code, message: frame.error.message });
    }

    await this.persistAndBroadcast(state);
  }

  private async handleDeviceAudioFrame(state: StoredLiveListenState, message: ArrayBuffer) {
    if (state.streamDemand.state !== "wanted" || !state.audioFlow.streamId || !state.audioFlow.generation) {
      return;
    }
    const streamConfig = liveListenStreamConfig(this.env);
    const now = new Date().toISOString();
    const seq = state.audioFlow.latestSeq + 1;
    const chunk: AudioChunkRecord = {
      streamId: state.audioFlow.streamId,
      generation: state.audioFlow.generation,
      seq,
      sentAt: now,
      durationMs: streamConfig.chunkDurationMs,
      codec: "pcm16-wav",
      byteLength: message.byteLength,
      data: message.slice(0),
    };
    state.audioRing.push(chunk);
    while (state.audioRing.length > streamConfig.maxBufferedChunks) state.audioRing.shift();
    this.updateStreamBufferStats(state, chunk);
    state.audioFlow.state = "flowing";
    state.nativeMediaState.capture = "capturing";
    this.telemetry.recordChunkIn(chunk.byteLength);
    this.broadcastAudioChunk(state, chunk, false);
    this.telemetry.recordChunkOut(chunk.byteLength, this.connectedListenerSockets().length);
    const nowMs = Date.now();
    if (nowMs - this.lastAudioChunkPersistAt >= AUDIO_CHUNK_PERSIST_INTERVAL_MS) {
      this.lastAudioChunkPersistAt = nowMs;
      await this.persist(state);
    }
    if (nowMs - this.lastAudioChunkObserverBroadcastAt >= AUDIO_CHUNK_OBSERVER_INTERVAL_MS) {
      this.lastAudioChunkObserverBroadcastAt = nowMs;
      await this.broadcastObservers(state);
    }
  }

  private async handleSocketGone(socket: WebSocket) {
    const attachment = this.socketAttachment(socket);
    if (!attachment) return;
    const state = await this.loadState(attachment.workspaceId, attachment.roomId);
    const now = new Date().toISOString();

    if (this.isListenerSocket(attachment) && attachment.participantId) {
      const listener = state.listeners[attachment.participantId];
      if (listener?.socketId === attachment.socketId) {
        listener.state = "grace";
        listener.socketId = undefined;
        listener.disconnectedAt = now;
        listener.graceDeadlineAt = new Date(Date.now() + LISTENER_RECONNECT_GRACE_MS).toISOString();
        listener.lastSeenAt = now;
        this.refreshDerivedFacts(state, now);
      }
    }

    if (attachment.role === "device" && state.nativeLink.deviceId === attachment.deviceId) {
      if (state.media.current) {
        this.upsertRecentMedia(state, state.media.current, attachment.deviceId, now, state.media.clock);
      }
      state.nativeLink.state = "disconnected";
      state.nativeLink.disconnectedAt = now;
      state.nativeLink.graceDeadlineAt = new Date(Date.now() + NATIVE_RECONNECT_GRACE_MS).toISOString();
      state.admission = { state: "blocked", reason: "device_offline" };
      state.media.current = null;
      state.media.clock = undefined;
      state.media.sourceDeviceId = attachment.deviceId;
      state.media.updatedAt = now;
      if (state.streamDemand.state === "wanted" && state.audioFlow.state !== "none") {
        state.audioFlow.state = "stalled";
      }
    }

    await this.persistAndBroadcast(state);
  }

  private applyDeviceHello(state: StoredLiveListenState, frame: Extract<LiveListenDeviceFrame, { type: "device.hello" }>) {
    this.applyDeviceOnline(state, frame.deviceId, frame.sentAt, frame.mediaState);
    if (frame.lastStreamId === state.audioFlow.streamId && frame.lastGeneration === state.audioFlow.generation) {
      state.audioFlow.latestSeq = Math.max(state.audioFlow.latestSeq, frame.lastSeq ?? state.audioFlow.latestSeq);
    }
  }

  private applyDeviceOnline(
    state: StoredLiveListenState,
    deviceId: string,
    at: string,
    mediaState?: LiveListenNativeMediaState,
  ) {
    state.hostDeviceId = deviceId;
    state.nativeLink = {
      state: "connected",
      deviceId,
      connectedAt: state.nativeLink.connectedAt ?? at,
    };
    this.applyNativeMediaState(state, deviceId, at, mediaState ?? {
      permission: "allow",
      playback: "paused",
      capture: "no-capture",
      reason: "no_playable_media",
    });
  }

  private applyNativeMediaState(
    state: StoredLiveListenState,
    deviceId: string,
    at: string,
    mediaState: LiveListenNativeMediaState,
  ) {
    state.hostDeviceId = deviceId;
    state.nativeMediaState = mediaState;
    if (mediaState.media) {
      this.updateMedia(state, mediaState.media, deviceId, at);
    } else if (state.media.current) {
      this.upsertRecentMedia(state, state.media.current, deviceId, at, state.media.clock);
      state.media.current = null;
      state.media.clock = undefined;
      state.media.sourceDeviceId = deviceId;
      state.media.updatedAt = at;
    }
    state.admission = this.deriveAdmission(state);
    state.media.playback = mediaState.playback;
    if (state.admission.state === "blocked") {
      if (state.streamDemand.state === "wanted") {
        this.stopStream(state, state.admission.reason, at);
        this.broadcastSession({
          type: state.admission.reason === "device_offline" || state.admission.reason === "no_playable_media" ? "stream.ended" : "stream.error",
          reason: state.admission.reason,
          message: mediaState.message,
          snapshot: this.snapshot(state),
        });
      }
    }
    state.updatedAt = at;
    state.revision += 1;
  }

  private updateMedia(
    state: StoredLiveListenState,
    media: LiveListenMedia,
    deviceId: string,
    at: string,
    clock?: LiveListenClock,
  ) {
    const previous = state.media.current ?? undefined;
    const same = previous ? mediaIdentity(previous) === mediaIdentity(media) : false;
    if (previous && !same) {
      this.upsertRecentMedia(state, previous, deviceId, at, state.media.clock);
    }
    this.upsertRecentMedia(state, media, deviceId, at, clock);
    state.media.current = media;
    state.media.playback = media.playbackState ?? state.media.playback ?? "paused";
    state.nativeMediaState.playback = state.media.playback;
    state.media.clock = clock ?? state.media.clock;
    state.media.sourceDeviceId = deviceId;
    state.media.updatedAt = at;
    state.updatedAt = at;
    state.revision += 1;
  }

  private upsertRecentMedia(
    state: StoredLiveListenState,
    media: LiveListenMedia,
    deviceId: string,
    at: string,
    clock?: LiveListenClock,
  ) {
    const identity = mediaIdentity(media);
    if (!identity) return;
    const existing = state.media.recent.find((item) => mediaIdentity(item) === identity);
    const next: LiveListenRecentMedia = {
      ...media,
      firstSeenAt: existing?.firstSeenAt ?? at,
      lastSeenAt: at,
      lastProgressSeconds: clock?.mediaProgressSeconds ?? existing?.lastProgressSeconds,
      sourceDeviceId: deviceId,
    };
    state.media.recent = [
      next,
      ...state.media.recent.filter((item) => mediaIdentity(item) !== identity),
    ].slice(0, RECENT_MEDIA_LIMIT);
  }

  private applyStreamHeartbeat(state: StoredLiveListenState, frame: Extract<LiveListenDeviceFrame, { type: "stream.heartbeat" }>) {
    state.nativeMediaState.capture = "capturing";
    state.audioFlow.streamId = frame.streamId;
    state.audioFlow.generation = frame.generation;
    state.audioFlow.latestSeq = Math.max(state.audioFlow.latestSeq, frame.lastSeq);
    state.audioFlow.state = "flowing";
    if (frame.clock) state.media.clock = frame.clock;
    state.updatedAt = frame.sentAt;
    state.revision += 1;
  }

  private applyDeviceAck(state: StoredLiveListenState, frame: Extract<LiveListenDeviceFrame, { type: "ack" }>) {
    if (frame.status === "resumed_with_gap" && frame.streamId && frame.generation) {
      const fromGeneration = state.audioFlow.generation;
      state.audioFlow.streamId = frame.streamId;
      state.audioFlow.generation = frame.generation;
      state.audioFlow.latestSeq = Math.max(0, (frame.firstSeq ?? 1) - 1);
      state.audioFlow.availableFromSeq = frame.firstSeq ?? 0;
      this.broadcastSession({
        type: "stream.gap",
        reason: "native_reconnect_buffer_miss",
        streamId: frame.streamId,
        generation: frame.generation,
        missingUntilSeq: frame.missingBeforeSeq,
        nextGeneration: frame.generation,
      });
      if (fromGeneration && fromGeneration !== frame.generation) {
        this.broadcastSession({
          type: "stream.transition",
          reason: "generation_changed",
          streamId: frame.streamId,
          fromGeneration,
          toGeneration: frame.generation,
        });
      }
    }
    if (frame.status === "started" || frame.status === "resumed" || frame.status === "restarted") {
      state.audioFlow.state = "flowing";
      state.nativeMediaState.capture = "capturing";
      if (frame.streamId) state.audioFlow.streamId = frame.streamId;
      if (frame.generation) state.audioFlow.generation = frame.generation;
    }
    if (frame.status === "rejected") {
      state.audioFlow.state = "failed";
      state.nativeLink.state = "error";
      state.admission = { state: "blocked", reason: "native_error" };
    }
    state.updatedAt = frame.sentAt;
    state.revision += 1;
  }

  private ensureStreamDemand(state: StoredLiveListenState, at: string) {
    state.roomEmptyDeadlineAt = undefined;
    state.streamDemand = {
      state: "wanted",
      reason: "listener-demand",
      updatedAt: at,
    };
    if (!state.audioFlow.streamId) {
      state.audioFlow.streamId = `stream_${crypto.randomUUID()}`;
      state.audioFlow.generation = 1;
      state.audioFlow.latestSeq = 0;
      state.audioFlow.availableFromSeq = 0;
      state.audioRing = [];
    }
    state.audioFlow.state = state.admission.state === "open" ? "starting" : "none";
    state.updatedAt = at;
    state.revision += 1;
  }

  private stopStream(state: StoredLiveListenState, reason: string, at: string) {
    state.streamDemand = {
      state: "not-wanted",
      reason: reason === "last_listener_disconnected" ? "no-listeners" : "manual-stop",
      updatedAt: at,
    };
    state.audioFlow.state = reason === "manual_stop" || reason === "last_listener_disconnected" || reason === "no_playable_media" ? "none" : "failed";
    state.nativeMediaState.capture = "no-capture";
    state.roomEmptyDeadlineAt = undefined;
    state.updatedAt = at;
    state.revision += 1;
    this.sendNativeStop(state, reason);
  }

  private async sendNativeStartOrResume(state: StoredLiveListenState, mode: "start" | "resume") {
    if (state.streamDemand.state !== "wanted") return;
    if (this.listenerDemandCount(state) === 0) return;
    if (!this.canAcceptListener(state)) return;
    if (state.nativeLink.state !== "connected") return;
    if (!state.audioFlow.streamId) {
      state.audioFlow.streamId = `stream_${crypto.randomUUID()}`;
      state.audioFlow.generation = 1;
      state.audioFlow.latestSeq = 0;
      state.audioFlow.availableFromSeq = 0;
      state.audioRing = [];
    }
    console.log("sending, start command")
    state.audioFlow.state = "starting";
    const command = this.streamCommand(state, mode);
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = this.socketAttachment(socket);
      if (attachment?.role === "device" && attachment.workspaceId === state.workspaceId && attachment.roomId === state.roomId) {
        this.sendJson(socket, command);
      }
    }
  }

  private sendNativeStop(state: StoredLiveListenState, reason: string) {
    const sentAt = new Date().toISOString();
    const command: LiveListenDeviceCommandEnvelope = {
      protocol: LIVE_LISTEN_DEVICE_PROTOCOL_V1,
      type: "command",
      commandId: crypto.randomUUID(),
      sentAt,
      expiresAt: new Date(Date.now() + 10_000).toISOString(),
      command: {
        type: "stream.stop",
        streamId: state.audioFlow.streamId,
        reason,
      },
    };
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = this.socketAttachment(socket);
      if (attachment?.role === "device" && attachment.workspaceId === state.workspaceId && attachment.roomId === state.roomId) {
        this.sendJson(socket, command);
      }
    }
  }

  private streamCommand(state: StoredLiveListenState, mode: "start" | "resume"): LiveListenDeviceCommandEnvelope {
    const sentAt = new Date().toISOString();
    const streamId = state.audioFlow.streamId ?? `stream_${crypto.randomUUID()}`;
    const generation = state.audioFlow.generation ?? 1;
    const streamConfig = liveListenStreamConfig(this.env);
    const audio = {
      codec: "pcm16-wav" as const,
      chunkDurationMs: streamConfig.chunkDurationMs,
      targetLatencyMs: streamConfig.targetLatencyMs,
    };
    return {
      protocol: LIVE_LISTEN_DEVICE_PROTOCOL_V1,
      type: "command",
      commandId: crypto.randomUUID(),
      sentAt,
      expiresAt: new Date(Date.now() + 10_000).toISOString(),
      command: mode === "resume"
        ? {
            type: "stream.resume",
            streamId,
            generation,
            fromSeq: state.audioFlow.latestSeq + 1,
            audio,
          }
        : {
            type: "stream.start",
            streamId,
            generation,
            capture: { mode: "current-media-app", preferredProvider: "spotify", fallback: "selected" },
            audio,
          },
    };
  }

  private canAcceptListener(state: StoredLiveListenState) {
    return state.admission.state === "open";
  }

  private replayAudio(socket: WebSocket, state: StoredLiveListenState, fromSeq: number) {
    const availableFromSeq = state.audioFlow.availableFromSeq;
    if (fromSeq < availableFromSeq) {
      this.telemetry.recordReplayMiss();
      this.sendSession(socket, {
        type: "replay.miss",
        streamId: state.audioFlow.streamId,
        generation: state.audioFlow.generation,
        requestedFromSeq: fromSeq,
        availableFromSeq,
        latestSeq: state.audioFlow.latestSeq,
      });
      return;
    }
    for (const chunk of state.audioRing.filter((item) => item.seq >= fromSeq)) {
      this.sendAudioChunk(socket, state, chunk, true);
      this.telemetry.recordReplayChunk(chunk.byteLength);
    }
  }

  private armRoomEmptyGraceIfNeeded(state: StoredLiveListenState, at: string) {
    if (this.listenerDemandCount(state) > 0) return;
    state.roomEmptyDeadlineAt = new Date((Date.parse(at) || Date.now()) + ROOM_EMPTY_GRACE_MS).toISOString();
    state.updatedAt = at;
    state.revision += 1;
  }

  private async refreshExpirations(state: StoredLiveListenState) {
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    let changed = false;
    for (const [participantId, listener] of Object.entries(state.listeners)) {
      if (listener.state !== "grace" || !listener.graceDeadlineAt) continue;
      if (Date.parse(listener.graceDeadlineAt) <= nowMs) {
        delete state.listeners[participantId];
        changed = true;
      }
    }
    if (this.listenerDemandCount(state) === 0 && state.streamDemand.state === "wanted") {
      this.stopStream(state, "last_listener_disconnected", now);
      changed = true;
    }
    if (state.roomEmptyDeadlineAt && Date.parse(state.roomEmptyDeadlineAt) <= nowMs && this.listenerDemandCount(state) === 0) {
      this.stopStream(state, "last_listener_disconnected", now);
      changed = true;
    }
    if (state.nativeLink.graceDeadlineAt && Date.parse(state.nativeLink.graceDeadlineAt) <= nowMs) {
      state.nativeLink.state = "disconnected";
      state.nativeLink.graceDeadlineAt = undefined;
      state.admission = { state: "blocked", reason: "device_offline" };
      if (state.streamDemand.state === "wanted") state.audioFlow.state = "failed";
      changed = true;
    }
    if (changed) await this.persistAndBroadcast(state);
  }

  private snapshot(state: StoredLiveListenState): LiveListenSnapshot {
    const activeCount = this.activeListenerCount(state);
    const graceCount = this.graceListenerCount(state);
    return LiveListenSnapshotSchema.parse({
      protocol: LIVE_LISTEN_PROTOCOL_V1,
      workspaceId: state.workspaceId,
      roomId: state.roomId,
      listeners: {
        activeCount,
        graceCount,
        demand: activeCount + graceCount > 0 ? "wanted" : "not-wanted",
      },
      nativeLink: state.nativeLink,
      admission: state.admission,
      streamDemand: state.streamDemand,
      audioFlow: state.audioFlow,
      media: this.snapshotMedia(state),
      updatedAt: state.updatedAt,
    });
  }

  private snapshotMedia(state: StoredLiveListenState): LiveListenRoomMediaState {
    const currentIsLive =
      state.nativeLink.state === "connected" &&
      Boolean(state.media.current) &&
      (!state.media.sourceDeviceId || state.media.sourceDeviceId === state.nativeLink.deviceId);
    return LiveListenRoomMediaStateSchema.parse({
      ...state.media,
      current: currentIsLive ? state.media.current : null,
      clock: currentIsLive ? state.media.clock : undefined,
    });
  }

  private deriveAdmission(state: StoredLiveListenState): LiveListenAdmission {
    if (state.nativeLink.state === "error") return { state: "blocked", reason: "native_error" };
    if (state.nativeLink.state !== "connected") return { state: "blocked", reason: "device_offline" };
    if (state.nativeMediaState.permission === "disallow") {
      return {
        state: "blocked",
        reason: state.nativeMediaState.reason ?? "live_listen_disabled",
        message: state.nativeMediaState.message,
      };
    }
    if (state.nativeMediaState.playback !== "playing") {
      return { state: "blocked", reason: "no_playable_media", message: state.nativeMediaState.message };
    }
    return { state: "open" };
  }

  private refreshDerivedFacts(state: StoredLiveListenState, at: string) {
    state.admission = this.deriveAdmission(state);
    state.streamDemand = {
      state: this.listenerDemandCount(state) > 0 ? "wanted" : "not-wanted",
      reason: this.listenerDemandCount(state) > 0 ? "listener-demand" : "no-listeners",
      updatedAt: at,
    };
  }

  private activeListenerCount(state: StoredLiveListenState) {
    return Object.values(state.listeners).filter((listener) => listener.state === "active").length;
  }

  private graceListenerCount(state: StoredLiveListenState) {
    return Object.values(state.listeners).filter((listener) => listener.state === "grace").length;
  }

  private listenerDemandCount(state: StoredLiveListenState) {
    return this.activeListenerCount(state) + this.graceListenerCount(state);
  }

  private updateStreamBufferStats(state: StoredLiveListenState, chunk: AudioChunkRecord) {
    state.audioFlow.latestSeq = chunk.seq;
    state.audioFlow.availableFromSeq = state.audioRing[0]?.seq ?? chunk.seq;
    state.audioFlow.lastChunkAt = chunk.sentAt;
    state.updatedAt = chunk.sentAt;
    state.revision += 1;
  }

  private async persistAndBroadcast(state: StoredLiveListenState) {
    await this.persist(state);
    await this.scheduleAlarm(state);
    this.broadcastSession({ type: "snapshot.updated", snapshot: this.snapshot(state) });
    await this.broadcastObservers(state);
    await this.broadcastMediaSessions(state);
  }

  private broadcastSession(init: { type: string; [key: string]: unknown }) {
    for (const socket of this.connectedListenerSockets()) {
      this.sendSession(socket, init);
    }
  }

  private broadcastAudioChunk(state: StoredLiveListenState, chunk: AudioChunkRecord, replayed: boolean) {
    for (const socket of this.connectedListenerSockets()) {
      this.sendAudioChunk(socket, state, chunk, replayed);
    }
  }

  private sendAudioChunk(socket: WebSocket, state: StoredLiveListenState, chunk: AudioChunkRecord, replayed: boolean) {
    const { data: _data, ...metadata } = chunk;
    this.sendSession(socket, {
      type: "audio.chunk",
      workspaceId: state.workspaceId,
      roomId: state.roomId,
      ...metadata,
      replayed,
    });
    this.sendBinary(socket, chunk.data);
  }

  private connectedListenerSockets() {
    return this.ctx.getWebSockets().filter((socket) => {
      const attachment = this.socketAttachment(socket);
      return attachment ? this.isListenerSocket(attachment) : false;
    });
  }

  private sendSession(socket: WebSocket, init: {
    type: string;
    [key: string]: unknown;
  }) {
    const attachment = this.socketAttachment(socket);
    this.sendJson(socket, {
      protocol: LIVE_LISTEN_MEDIA_SESSION_PROTOCOL_V1,
      ...init,
    });
  }

  private async broadcastObservers(state: StoredLiveListenState) {
    for (const socket of this.ctx.getWebSockets()) {
      if (this.socketAttachment(socket)?.role === "observer") this.sendObserverTelemetry(socket, state);
    }
  }

  private async broadcastMediaSessions(state: StoredLiveListenState) {
    for (const socket of this.ctx.getWebSockets()) {
      if (this.socketAttachment(socket)?.role === "media-session") this.sendMediaSessionSnapshot(socket, state);
    }
  }

  private sendMediaSessionSnapshot(socket: WebSocket, state: StoredLiveListenState) {
    this.sendJson(socket, {
      protocol: LIVE_LISTEN_MEDIA_SESSION_PROTOCOL_V1,
      type: "media.snapshot.updated",
      snapshot: {
        protocol: LIVE_LISTEN_MEDIA_SESSION_PROTOCOL_V1,
        workspaceId: state.workspaceId,
        roomId: state.roomId,
        listeners: {
          activeCount: this.activeListenerCount(state),
          graceCount: this.graceListenerCount(state),
          demand: this.listenerDemandCount(state) > 0 ? "wanted" : "not-wanted",
        },
        nativeLink: state.nativeLink,
        nativeMediaState: state.nativeMediaState,
        admission: state.admission,
        streamDemand: state.streamDemand,
        audioFlow: state.audioFlow,
        media: state.media,
        updatedAt: state.updatedAt,
      },
    });
  }

  private sendObserverTelemetry(socket: WebSocket, state: StoredLiveListenState) {
    const telemetry = this.telemetry.snapshot();
    this.sendJson(socket, {
      protocol: LIVE_LISTEN_OBSERVE_PROTOCOL_V1,
      type: "telemetry",
      snapshot: {
        protocol: LIVE_LISTEN_PROTOCOL_V1,
        workspaceId: state.workspaceId,
        roomId: state.roomId,
        listeners: {
          activeCount: this.activeListenerCount(state),
          graceCount: this.graceListenerCount(state),
          demand: this.listenerDemandCount(state) > 0 ? "wanted" : "not-wanted",
        },
        nativeLink: state.nativeLink,
        admission: state.admission,
        streamDemand: state.streamDemand,
        audioFlow: state.audioFlow,
        media: state.media,
        bytesIn: telemetry.bytesIn,
        bytesOut: telemetry.bytesOut,
        chunksIn: telemetry.chunksIn,
        chunksOut: telemetry.chunksOut,
        replayChunks: telemetry.replayChunks,
        replayMisses: telemetry.replayMisses,
        lastChunkBytes: telemetry.lastChunkBytes,
        lastChunkAt: state.audioFlow.lastChunkAt,
      },
    });
  }

  private tokenResponse(
    state: StoredLiveListenState,
    role: LiveListenToken["role"],
    participantId: string,
  ): LiveListenTokenResponse {
    return {
      protocol: LIVE_LISTEN_PROTOCOL_V1,
      roomId: state.roomId,
      workspaceId: state.workspaceId,
      snapshot: this.snapshot(state),
      token: {
        transport: "cloudflare-realtime",
        sessionId: `pulse:${state.workspaceId}:${state.roomId}`,
        participantId,
        role,
        token: this.resumeToken(),
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      },
    };
  }

  private socketRole(pathname: string): SocketRole | null {
    if (pathname.endsWith("/device-session")) return "device";
    if (pathname.endsWith("/media-session")) return "media-session";
    if (pathname.endsWith("/observe")) return "observer";
    return null;
  }

  private socketAttachment(socket: WebSocket): LiveListenSocketAttachment | null {
    const attachment = socket.deserializeAttachment() as LiveListenSocketAttachment | null;
    if (!attachment?.workspaceId || !attachment.roomId || !attachment.socketId || !attachment.role) {
      return null;
    }
    return attachment;
  }

  private isListenerSocket(attachment: LiveListenSocketAttachment) {
    return attachment.role === "media-session" && Boolean(attachment.participantId);
  }

  private async scheduleAlarm(state: StoredLiveListenState) {
    const candidates = [
      state.roomEmptyDeadlineAt,
      state.nativeLink.graceDeadlineAt,
      ...Object.values(state.listeners).map((listener) => listener.graceDeadlineAt),
    ]
      .map((value) => value ? Date.parse(value) : Number.NaN)
      .filter((value) => Number.isFinite(value) && value > Date.now())
      .sort((a, b) => a - b);
    if (candidates[0]) await this.ctx.storage.setAlarm(candidates[0]);
    else await this.ctx.storage.deleteAlarm();
  }

  private assertWorkspaceAndRoom(workspaceId: string, roomId: string, state: StoredLiveListenState) {
    if (workspaceId !== state.workspaceId) throw new Error("workspace_mismatch");
    if (roomId !== state.roomId) throw new Error("room_mismatch");
  }

  private async loadState(
    workspaceId = this.env.WORKSPACE_ID,
    roomId = "live-listen:owner",
  ): Promise<StoredLiveListenState> {
    if (this.roomState) return this.roomState;
    const loaded = await this.ctx.storage.get<PersistedLiveListenState>(LIVE_LISTEN_STATE_KEY);
    this.roomState = normalizeStoredState(loaded, workspaceId, roomId);
    return this.roomState;
  }

  private async persist(state: StoredLiveListenState) {
    this.roomState = state;
    await this.ctx.storage.put(LIVE_LISTEN_STATE_KEY, persistedState(state));
  }

  private resumeToken() {
    return `resume_${crypto.randomUUID()}`;
  }

  private sendJson(socket: WebSocket, payload: unknown) {
    try {
      socket.send(JSON.stringify(payload));
    } catch {
      socket.close(1011, "live listen send failed");
    }
  }

  private sendBinary(socket: WebSocket, payload: ArrayBuffer) {
    try {
      socket.send(payload);
    } catch {
      socket.close(1011, "live listen send failed");
    }
  }
}

function initialState(workspaceId: string, roomId: string): StoredLiveListenState {
  const updatedAt = new Date(0).toISOString();
  return {
    workspaceId,
    roomId,
    updatedAt,
    nativeLink: { state: "disconnected" },
    nativeMediaState: { permission: "allow", playback: "paused", capture: "no-capture", reason: "no_playable_media" },
    admission: { state: "blocked", reason: "device_offline" },
    media: { current: null, recent: [], playback: "paused" },
    streamDemand: { state: "not-wanted", reason: "no-listeners", updatedAt },
    audioFlow: {
      state: "none",
      latestSeq: 0,
      availableFromSeq: 0,
    },
    listeners: {},
    audioRing: [],
    revision: 0,
  };
}

function normalizeStoredState(
  loaded: PersistedLiveListenState | undefined,
  workspaceId: string,
  roomId: string,
): StoredLiveListenState {
  const base = initialState(loaded?.workspaceId ?? workspaceId, loaded?.roomId ?? roomId);
  if (!loaded?.nativeLink || !loaded.nativeMediaState || !loaded.admission || !loaded.media || !loaded.streamDemand || !loaded.audioFlow) {
    return {
      ...base,
      updatedAt: loaded?.updatedAt ?? base.updatedAt,
      revision: (loaded?.revision ?? 0) + 1,
    };
  }
  const mediaCandidate = {
    ...base.media,
    ...loaded.media,
    recent: loaded.media.recent ?? [],
  };
  const media = LiveListenRoomMediaStateSchema.safeParse(mediaCandidate).success
    ? mediaCandidate
    : base.media;
  const listeners = Object.fromEntries(Object.entries(loaded.listeners ?? {}).map(([id, listener]) => [
    id,
    normalizeListener(listener),
  ]));

  return {
    ...base,
    ...loaded,
    media,
    listeners,
    audioRing: [],
  };
}

function normalizeListener(listener: ListenerRecord): ListenerRecord {
  return {
    ...listener,
    state: listener.state === "active" ? "active" : "grace",
    graceDeadlineAt: listener.graceDeadlineAt,
  };
}

function persistedState(state: StoredLiveListenState): PersistedLiveListenState {
  const { audioRing: _audioRing, ...persisted } = state;
  return persisted;
}

function mediaIdentity(media: LiveListenMedia | LiveListenRecentMedia): string {
  if (media.provider && media.trackId) return `${media.provider}:track:${media.trackId}`;
  if (media.provider && media.uri) return `${media.provider}:uri:${media.uri}`;
  return [media.provider, media.title, media.artist, media.album].filter(Boolean).join(":");
}

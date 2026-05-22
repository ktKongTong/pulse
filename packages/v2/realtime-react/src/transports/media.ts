import {
  CLIENT_MEDIA_WS_PROTOCOL,
  ClientMediaServerFrameSchema,
} from "@pulse/v2-realtime-protocol";
import { nextConnection } from "../connection";
import { resolveSdkVersion } from "../session";
import type { RealtimeV2StateStore } from "../state";
import type { ClientIdentity, PulseRealtimeV2Config } from "../types";
import { parseTextFrame } from "../utils/frame";
import { createClientId } from "../utils/id";
import { closeSocket, isSocketOpenOrConnecting } from "../utils/socket";
import { resolveWsUrl } from "../utils/url";
import { buildAudioChunk, validChunkForStream } from "./media-audio";

export class MediaWsTransport {
  private socket: WebSocket | null = null;
  private lastRevision = -1;
  private pendingAudio: Extract<MediaServerFrame, { type: "audio.chunk" }> | null = null;

  constructor(
    private readonly config: PulseRealtimeV2Config,
    private readonly store: RealtimeV2StateStore,
  ) { }

  connect(identity: ClientIdentity) {
    if (isSocketOpenOrConnecting(this.socket)) return;
    closeSocket(this.socket);
    this.socket = null;
    this.store.patch((draft) => {
      draft.media.connection = nextConnection("connecting");
    });
    const socket = new WebSocket(resolveWsUrl(this.config.baseUrl, "/api/v1/client/media/ws"));
    this.socket = socket;
    socket.addEventListener("open", () => this.sendHello(socket, identity));
    socket.binaryType = "arraybuffer";
    socket.addEventListener("message", (event) => this.handleMessage(event.data));
    socket.addEventListener("close", () => this.handleClose(socket));
    socket.addEventListener("error", () => this.handleError());
  }

  requestStream() {
    const requestId = createClientId("stream-request");
    if (!this.send({ protocol: CLIENT_MEDIA_WS_PROTOCOL, type: "stream.request", requestId })) {
      return null;
    }
    this.store.patch((draft) => {
      draft.media.stream = { state: "requesting", requestId };
    });
    return requestId;
  }

  stopStream() {
    return this.send({ protocol: CLIENT_MEDIA_WS_PROTOCOL, type: "stream.stop" });
  }

  ackStream(streamId: string, generation: number, seq: number) {
    return this.send({
      protocol: CLIENT_MEDIA_WS_PROTOCOL,
      type: "ack",
      streamId,
      generation,
      seq,
    });
  }

  close() {
    closeSocket(this.socket);
    this.socket = null;
  }

  private sendHello(socket: WebSocket, identity: ClientIdentity) {
    socket.send(JSON.stringify({
      protocol: CLIENT_MEDIA_WS_PROTOCOL,
      type: "hello",
      supportedProtocols: [CLIENT_MEDIA_WS_PROTOCOL],
      sdkVersion: resolveSdkVersion(this.config),
      sessionId: identity.sessionId,
      tabId: identity.tabId,
    }));
  }

  private send(message: unknown) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  private handleMessage(raw: unknown) {
    if (raw instanceof ArrayBuffer) return this.handleAudioBytes(raw);
    const parsedJson = parseTextFrame(raw);
    if (!parsedJson) return;
    const parsed = ClientMediaServerFrameSchema.safeParse(parsedJson);
    if (!parsed.success) return;
    const frame = parsed.data;
    if (frame.type === "hello_ack") this.markConnected();
    else if (frame.type === "state") this.applyState(frame);
    else if (frame.type === "stream.accepted") this.applyAccepted(frame.stream);
    else if (frame.type === "stream.transition") this.applyTransition(frame);
    else if (frame.type === "stream.rejected") this.applyRejected(frame.source);
    else if (frame.type === "audio.chunk") this.pendingAudio = frame;
    else if (["stream.stopped", "stream.ended", "stream.error"].includes(frame.type)) {
      this.clearStream();
    }
  }

  private handleAudioBytes(bytes: ArrayBuffer) {
    const frame = this.pendingAudio;
    this.pendingAudio = null;
    if (!frame) return;
    const stream = this.store.getSnapshot().media.stream;
    if (!validChunkForStream(frame, stream)) return;
    const chunk = buildAudioChunk(frame, bytes);
    if (!chunk) return;
    this.config.onAudioChunk?.(chunk);
    this.ackStream(frame.streamId, frame.generation, frame.seq);
  }

  private markConnected() {
    this.store.patch((draft) => {
      draft.media.connection = nextConnection("connected");
    });
  }

  private applyState(frame: Extract<MediaServerFrame, { type: "state" }>) {
    if (frame.revision <= this.lastRevision) return;
    this.lastRevision = frame.revision;
    this.store.patch((draft) => {
      draft.media.media = frame.media;
      draft.media.source = frame.stream.source;
    });
  }

  private applyAccepted(stream: { streamId: string; generation: number }) {
    this.store.patch((draft) => {
      draft.media.stream = { state: "active", ...stream };
    });
  }

  private applyTransition(frame: Extract<MediaServerFrame, { type: "stream.transition" }>) {
    this.store.patch((draft) => {
      if (draft.media.stream.state !== "active") return;
      draft.media.stream = {
        state: "active",
        streamId: frame.streamId,
        generation: frame.toGeneration,
      };
    });
  }

  private applyRejected(source: Extract<MediaServerFrame, { type: "stream.rejected" }>["source"]) {
    this.store.patch((draft) => {
      draft.media.stream = { state: "observer" };
      draft.media.source = source;
    });
  }

  private clearStream() {
    this.store.patch((draft) => {
      draft.media.stream = { state: "observer" };
    });
  }

  private handleClose(socket: WebSocket) {
    if (this.socket === socket) this.socket = null;
    this.store.patch((draft) => {
      draft.media.connection = nextConnection("closed");
      draft.media.stream = { state: "observer" };
    });
  }

  private handleError() {
    this.store.patch((draft) => {
      draft.media.connection = nextConnection("error", "media_ws_error");
    });
  }
}

type MediaServerFrame = ReturnType<typeof ClientMediaServerFrameSchema.parse>;

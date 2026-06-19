'use client'
import {
  CLIENT_WS_PROTOCOL,
  ClientWsServerFrameSchema,
} from "@ktfun/pulse-protocol";
import { nextConnection } from "../connection";
import { resolveSdkVersion } from "../session";
import type { RealtimeV2StateStore } from "../state";
import type { ClientIdentity, PulseRealtimeV2Config } from "../types";
import { parseTextFrame } from "../utils/frame";
import { createClientId } from "../utils/id";
import { closeSocket, isSocketOpenOrConnecting } from "../utils/socket";
import { resolveWsUrl } from "../utils/url";
import { buildAudioChunk, validChunkForStream } from "./media-audio";

type ClientWsServerFrame = ReturnType<typeof ClientWsServerFrameSchema.parse>;

export class ClientWsTransport {
  private socket: WebSocket | null = null;
  private lastSnapshotRevision = -1;
  private lastStateRevision = -1;
  private pendingAudio: Extract<ClientWsServerFrame, { type: "audio.chunk" }> | null = null;
  private connectPromise: Promise<ClientIdentity> | null = null;
  private resolveConnect: ((identity: ClientIdentity) => void) | null = null;
  private rejectConnect: ((error: Error) => void) | null = null;
  private closing = false;
  private onUnexpectedClose: (() => void) | null = null;

  constructor(
    private readonly config: PulseRealtimeV2Config,
    private readonly store: RealtimeV2StateStore,
  ) { }

  connect(
    identity: ClientIdentity,
    options: { onUnexpectedClose?: () => void } = {},
  ): Promise<ClientIdentity> {
    const current = this.store.getSnapshot();
    if (current.common.connection.connected && current.identity) {
      return Promise.resolve(current.identity);
    }
    if (isSocketOpenOrConnecting(this.socket) && this.connectPromise) {
      return this.connectPromise;
    }
    this.onUnexpectedClose = options.onUnexpectedClose ?? null;
    closeSocket(this.socket);
    this.socket = null;
    this.closing = false;
    this.store.patch((draft) => {
      draft.common.connection = nextConnection("connecting");
      draft.media.connection = nextConnection("connecting");
    });

    const socket = new WebSocket(resolveWsUrl(this.config.baseUrl, "/api/v1/client/ws"));
    this.socket = socket;
    this.connectPromise = new Promise<ClientIdentity>((resolve, reject) => {
      this.resolveConnect = resolve;
      this.rejectConnect = reject;
    });
    socket.addEventListener("open", () => this.sendHello(socket, identity));
    socket.binaryType = "arraybuffer";
    socket.addEventListener("message", (event) => this.handleMessage(event.data));
    socket.addEventListener("close", () => this.handleClose(socket));
    socket.addEventListener("error", () => this.handleError());
    return this.connectPromise;
  }

  requestStream() {
    const requestId = createClientId("stream-request");
    if (!this.send({ protocol: CLIENT_WS_PROTOCOL, type: "stream.request", requestId })) {
      return null;
    }
    this.store.patch((draft) => {
      draft.media.stream = { state: "requesting", requestId };
    });
    return requestId;
  }

  stopStream() {
    return this.send({ protocol: CLIENT_WS_PROTOCOL, type: "stream.stop" });
  }

  ackStream(streamId: string, generation: number, seq: number) {
    return this.send({
      protocol: CLIENT_WS_PROTOCOL,
      type: "ack",
      streamId,
      generation,
      seq,
    });
  }

  close() {
    this.closing = true;
    closeSocket(this.socket);
    this.socket = null;
    this.rejectPendingConnect("client_ws_closed");
  }

  private sendHello(socket: WebSocket, identity: ClientIdentity) {
    socket.send(JSON.stringify({
      protocol: CLIENT_WS_PROTOCOL,
      type: "hello",
      supportedProtocols: [CLIENT_WS_PROTOCOL],
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
    const parsed = ClientWsServerFrameSchema.safeParse(parsedJson);
    if (!parsed.success) return;
    const frame = parsed.data;
    if (frame.type === "hello_ack") this.applyHelloAck(frame);
    else if (frame.type === "snapshot") this.applySnapshot(frame);
    else if (frame.type === "state") this.applyState(frame);
    else if (frame.type === "stream.accepted") this.applyAccepted(frame.stream);
    else if (frame.type === "stream.transition") this.applyTransition(frame);
    else if (frame.type === "stream.rejected") this.applyRejected(frame.source);
    else if (frame.type === "audio.chunk") this.pendingAudio = frame;
    else if (["stream.stopped", "stream.ended", "stream.error"].includes(frame.type)) {
      this.clearStream();
    } else if (frame.type === "error") {
      this.applyErrorFrame(frame.code);
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

  private applyHelloAck(frame: Extract<ClientWsServerFrame, { type: "hello_ack" }>) {
    const identity = {
      sessionId: frame.session.sessionId,
      tabId: frame.session.tabId,
      user: frame.session.user,
    };
    this.store.patch((draft) => {
      draft.identity = identity;
      draft.common.connection = nextConnection("connected");
      draft.media.connection = nextConnection("connected");
    });
    this.resolveConnect?.(identity);
    this.clearPendingConnect();
  }

  private applySnapshot(frame: Extract<ClientWsServerFrame, { type: "snapshot" }>) {
    if (frame.snapshot.revision <= this.lastSnapshotRevision) return;
    this.lastSnapshotRevision = frame.snapshot.revision;
    this.store.patch((draft) => {
      draft.common.snapshot = frame.snapshot;
    });
  }

  private applyState(frame: Extract<ClientWsServerFrame, { type: "state" }>) {
    if (frame.revision <= this.lastStateRevision) return;
    this.lastStateRevision = frame.revision;
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

  private applyTransition(frame: Extract<ClientWsServerFrame, { type: "stream.transition" }>) {
    this.store.patch((draft) => {
      if (draft.media.stream.state !== "active") return;
      draft.media.stream = {
        state: "active",
        streamId: frame.streamId,
        generation: frame.toGeneration,
      };
    });
  }

  private applyRejected(source: Extract<ClientWsServerFrame, { type: "stream.rejected" }>["source"]) {
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

  private applyErrorFrame(code: string) {
    this.store.patch((draft) => {
      draft.common.connection = nextConnection("error", code);
      draft.media.connection = nextConnection("error", code);
    });
    this.rejectPendingConnect(code);
  }

  private handleClose(socket: WebSocket) {
    if (this.socket === socket) this.socket = null;
    this.store.patch((draft) => {
      draft.common.connection = nextConnection("closed");
      draft.media.connection = nextConnection("closed");
      draft.media.stream = { state: "observer" };
    });
    if (!this.closing) this.rejectPendingConnect("client_ws_closed");
    if (!this.closing) this.onUnexpectedClose?.();
  }

  private handleError() {
    this.store.patch((draft) => {
      draft.common.connection = nextConnection("error", "client_ws_error");
      draft.media.connection = nextConnection("error", "client_ws_error");
    });
    this.rejectPendingConnect("client_ws_error");
  }

  private rejectPendingConnect(code: string) {
    this.rejectConnect?.(new Error(code));
    this.clearPendingConnect();
  }

  private clearPendingConnect() {
    this.connectPromise = null;
    this.resolveConnect = null;
    this.rejectConnect = null;
  }
}

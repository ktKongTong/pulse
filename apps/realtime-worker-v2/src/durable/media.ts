import {
  CLIENT_WS_PROTOCOL,
  DEVICE_MEDIA_CONNECTION_PROTOCOL,
  DeviceMediaClientFrameSchema,
  type DeviceMediaConnectionHelloFrame,
} from "@ktfun/pulse-protocol";
import { deviceStub, globalStub } from "../env";
import {
  MediaBase,
  type MediaAttachment as Attachment,
} from "./media-base";
import {
  type DeviceAttachment,
  type PendingDeviceAttachment,
  sourceFromState,
  type StreamClientMeta,
} from "../state/media";
import { tabKey } from "../state/keys";
import { parseFrame } from "../utils/frame";
import { createAcceptedPair, upgradeResponse } from "../utils/pair";
import { nowIso } from "../utils/time";
import { closeWith, safeSend, socketAttachment } from "../utils/ws";

export class MediaDO extends MediaBase {
  private pendingDeviceAccepts = new WeakMap<WebSocket, Promise<boolean>>();

  async revokeDeviceSession(deviceSessionId: string) {
    await this.revokeDevice(deviceSessionId);
  }

  async removeClientStream(sessionId: string, tabId: string) {
    this.streamClients.delete(tabKey(sessionId, tabId));
    await this.stopIfNoStreamClients();
  }

  async sendCurrentState(sessionId: string, tabId: string) {
    await globalStub(this.env).sendClientFrame(sessionId, tabId, {
      protocol: CLIENT_WS_PROTOCOL,
      type: "state",
      revision: this.state.revision,
      updatedAt: this.state.updatedAt,
      media: this.state.currentMedia,
      stream: { source: sourceFromState(this.state) },
    });
  }

  async handleStreamRequest(sessionId: string, tabId: string, requestId: string) {
    const source = sourceFromState(this.state);
    if (source.state !== "ready") {
      await globalStub(this.env).sendClientFrame(sessionId, tabId, {
        protocol: CLIENT_WS_PROTOCOL,
        type: "stream.rejected",
        requestId,
        source,
      });
      return;
    }
    const context = this.context();
    const meta: StreamClientMeta = { sessionId, tabId };
    this.streamClients.set(tabKey(sessionId, tabId), meta);
    await globalStub(this.env).sendClientFrame(sessionId, tabId, {
      protocol: CLIENT_WS_PROTOCOL,
      type: "stream.accepted",
      requestId,
      stream: { streamId: context.streamId, generation: context.generation },
    });
    const sent = await this.sendDeviceCommand("stream.requested", context.streamId, context.generation);
    if (!sent) {
      this.streamClients.delete(tabKey(sessionId, tabId));
      await this.closeDeviceFatal("command_conflict");
      await globalStub(this.env).sendClientFrame(sessionId, tabId, {
        protocol: CLIENT_WS_PROTOCOL,
        type: "stream.rejected",
        requestId,
        source: sourceFromState(this.state),
      });
    }
  }

  async handleStreamStop(sessionId: string, tabId: string) {
    await this.stopClientStream({ sessionId, tabId });
  }

  async handleClientAck(sessionId: string, tabId: string, _streamId: string, _generation: number, seq: number) {
    const meta = this.streamClients.get(tabKey(sessionId, tabId));
    if (meta) meta.lastAckSeq = seq;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected websocket", { status: 426 });
    const { client, server } = createAcceptedPair();
    const url = new URL(request.url);
    const deviceId = url.searchParams.get("deviceId") ?? "owner";
    const deviceSessionId = url.searchParams.get("deviceSessionId");
    if (deviceSessionId) {
      server.serializeAttachment({ kind: "pending-device", deviceId, deviceSessionId } satisfies PendingDeviceAttachment);
    }
    this.ctx.acceptWebSocket(server);
    return upgradeResponse(client);
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    const attachment = socketAttachment<Attachment>(socket);
    if (!attachment) return this.routeHello(socket, message);
    if (attachment.kind === "pending-device") return this.handlePendingDevice(socket, message);
    return this.handleDevice(socket, message);
  }

  async webSocketClose(socket: WebSocket) {
    console.log("[media-do] socket_close", socketAttachment<Attachment>(socket));
    await this.cleanup(socket);
  }
  async webSocketError(socket: WebSocket) {
    console.log("[media-do] socket_error", socketAttachment<Attachment>(socket));
    await this.cleanup(socket);
  }

  private async routeHello(socket: WebSocket, message: string | ArrayBuffer) {
    console.log("[media-do] route_hello", typeof message === "string" ? message.slice(0, 300) : "binary");
    const deviceHello = parseFrame(DeviceMediaClientFrameSchema, message);
    if (deviceHello?.type === "hello") return this.acceptDevice(socket, deviceHello);
    console.log("[media-do] invalid_hello");
    return closeWith(socket, 4000, "invalid_frame");
  }

  private async handlePendingDevice(socket: WebSocket, message: string | ArrayBuffer) {
    const accepting = this.pendingDeviceAccepts.get(socket);
    if (accepting) {
      if (await accepting) return this.handleDevice(socket, message);
      return;
    }
    const deviceHello = parseFrame(DeviceMediaClientFrameSchema, message);
    if (deviceHello?.type !== "hello") return closeWith(socket, 4000, "invalid_frame");
    const accept = this.acceptDevice(socket, deviceHello)
      .then(() => socketAttachment<Attachment>(socket)?.kind === "device")
      .finally(() => this.pendingDeviceAccepts.delete(socket));
    this.pendingDeviceAccepts.set(socket, accept);
    await accept;
  }

  private async acceptDevice(socket: WebSocket, frame: DeviceMediaConnectionHelloFrame) {
    const pending = socketAttachment<PendingDeviceAttachment>(socket);
    const deviceSessionId = pending?.kind === "pending-device" ? pending.deviceSessionId : "";
    const deviceId = pending?.kind === "pending-device" ? pending.deviceId : "owner";
    console.log("[media-do] accept_device start", { deviceId, deviceSessionId, frame });
    if (!(await deviceStub(this.env, deviceId).isDeviceSessionActive(deviceSessionId))) {
      console.log("[media-do] accept_device invalid_session", { deviceId, deviceSessionId });
      return closeWith(socket, 4001, "invalid_session");
    }
    const attachment: DeviceAttachment = {
      kind: "device", connectionId: crypto.randomUUID(), deviceId, deviceSessionId,
    };
    closeWith(this.deviceSocket, 4000, "connection_superseded");
    socket.serializeAttachment(attachment);
    this.deviceSocket = socket;
    this.state.device = {
      ...attachment, connectedAt: nowIso(),
      capabilities: { streaming: Boolean(frame.payload.capabilities.media) },
    };
    await this.stateChanged(false);
    safeSend(socket, {
      protocol: DEVICE_MEDIA_CONNECTION_PROTOCOL,
      type: "hello_ack",
      payload: {
        accepted: true, serverTime: nowIso(), connectionId: attachment.connectionId,
        selectedProtocols: frame.payload.supportedProtocols,
        capabilities: { streaming: this.state.device.capabilities.streaming },
      },
    });
    console.log("[media-do] accept_device ok", { deviceId, deviceSessionId });
  }

  private async handleDevice(socket: WebSocket, message: string | ArrayBuffer) {
    const attachment = socketAttachment<Attachment>(socket);
    if (!this.isActiveDeviceSocket(socket)) {
      console.log("[media-do] stale_device_message", {
        attachment,
        message: typeof message === "string" ? message.slice(0, 300) : "binary",
      });
      return closeWith(socket, 4000, "connection_superseded");
    }
    if (message instanceof ArrayBuffer) return this.acceptBinaryChunk(message);
    console.log("[media-do] device_message", { attachment, message: message.slice(0, 300) });
    const frame = parseFrame(DeviceMediaClientFrameSchema, message);
    if (!frame) {
      console.log("[media-do] device_invalid_frame");
      return closeWith(socket, 4000, "invalid_frame");
    }
    if (frame.type === "stream.state.updated") {
      this.state.deviceStreamState = frame.payload.state;
      if (this.state.currentMedia) {
        const playback = frame.payload.state.playback;
        this.state.currentMedia = {
          ...this.state.currentMedia,
          current: { ...this.state.currentMedia.current, playbackState: playback },
          playback,
          updatedAt: frame.payload.sentAt,
        };
      }
      this.state.streamRequestRejectedAt = undefined;
      return this.stateChanged();
    }
    if (frame.type === "media.updated") {
      this.state.currentMedia = {
        current: frame.payload.media, clock: frame.payload.clock,
        playback: frame.payload.media.playbackState ?? "playing", updatedAt: frame.payload.sentAt,
      };
      return this.stateChanged();
    }
    if (frame.type === "ack") return this.applyDeviceAck(frame);
    if (frame.type === "audio.chunk") this.pendingChunk = { ...frame.payload, codec: this.state.streamContext?.codec ?? "pcm16-wav" };
    if (frame.type === "stream.stopped" || frame.type === "error") this.endStreamForClients();
  }
}

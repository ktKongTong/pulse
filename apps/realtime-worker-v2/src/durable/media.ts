import {
  CLIENT_MEDIA_WS_PROTOCOL,
  ClientMediaClientFrameSchema,
  DEVICE_MEDIA_CONNECTION_PROTOCOL,
  DeviceMediaClientFrameSchema,
  type ClientMediaHelloFrame,
  type DeviceMediaConnectionHelloFrame,
} from "@ktfun/pulse-protocol";
import { deviceStub, globalStub } from "../env";
import {
  MediaBase,
  type MediaAttachment as Attachment,
} from "./media-base";
import {
  type ClientAttachment,
  type DeviceAttachment,
  mediaStateFrame,
  type PendingDeviceAttachment,
  sourceFromState,
} from "../state/media";
import { tabKey } from "../state/keys";
import { parseFrame } from "../utils/frame";
import { createAcceptedPair, upgradeResponse } from "../utils/pair";
import { nowIso } from "../utils/time";
import { closeWith, safeSend, socketAttachment } from "../utils/ws";

export class MediaDO extends MediaBase {
  private pendingDeviceAccepts = new WeakMap<WebSocket, Promise<boolean>>();

  async revokeClient(sessionId: string, tabId: string) {
    const key = tabKey(sessionId, tabId);
    closeWith(this.clients.get(key), 401, "invalid_session");
    this.clients.delete(key);
    this.streamClients.delete(key);
    await this.stopIfNoStreamClients();
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
    if (attachment.kind === "client") return this.handleClient(socket, attachment, message);
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
    const clientHello = parseFrame(ClientMediaClientFrameSchema, message);
    if (clientHello?.type === "hello") return this.acceptClient(socket, clientHello);
    const deviceHello = parseFrame(DeviceMediaClientFrameSchema, message);
    if (deviceHello?.type === "hello") return this.acceptDevice(socket, deviceHello);
    console.log("[media-do] invalid_hello");
    return this.closeClientFatal(socket, "invalid_frame");
  }

  private async handlePendingDevice(socket: WebSocket, message: string | ArrayBuffer) {
    const accepting = this.pendingDeviceAccepts.get(socket);
    if (accepting) {
      if (await accepting) return this.handleDevice(socket, message);
      return;
    }
    const deviceHello = parseFrame(DeviceMediaClientFrameSchema, message);
    if (deviceHello?.type !== "hello") return this.closeClientFatal(socket, "invalid_frame");
    const accept = this.acceptDevice(socket, deviceHello)
      .then(() => socketAttachment<Attachment>(socket)?.kind === "device")
      .finally(() => this.pendingDeviceAccepts.delete(socket));
    this.pendingDeviceAccepts.set(socket, accept);
    await accept;
  }

  private async acceptClient(socket: WebSocket, frame: ClientMediaHelloFrame) {
    const active = await globalStub(this.env).isTabActive(frame.sessionId, frame.tabId);
    if (!active) return this.closeClientFatal(socket, "invalid_session");
    const key = tabKey(frame.sessionId, frame.tabId);
    closeWith(this.clients.get(key), 4000, "connection_superseded");
    const attachment: ClientAttachment = {
      kind: "client", connectionId: crypto.randomUUID(), sessionId: frame.sessionId, tabId: frame.tabId,
    };
    socket.serializeAttachment(attachment);
    this.clients.set(key, socket);
    safeSend(socket, {
      protocol: CLIENT_MEDIA_WS_PROTOCOL, type: "hello_ack",
      selectedProtocol: CLIENT_MEDIA_WS_PROTOCOL, connectionId: attachment.connectionId,
    });
    safeSend(socket, mediaStateFrame(this.state));
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
    this.broadcastState();
  }

  private async handleClient(socket: WebSocket, attachment: ClientAttachment, message: string | ArrayBuffer) {
    const frame = parseFrame(ClientMediaClientFrameSchema, message);
    if (!frame) return this.closeClientFatal(socket, "invalid_frame");
    if (frame.type === "stream.request") return this.requestStream(attachment, frame.requestId);
    if (frame.type === "stream.stop") return this.stopClientStream(attachment);
  }

  private async requestStream(attachment: ClientAttachment, requestId: string) {
    const source = sourceFromState(this.state);
    const socket = this.clients.get(tabKey(attachment.sessionId, attachment.tabId));
    if (!socket) return;
    if (source.state !== "ready") {
      safeSend(socket, { protocol: CLIENT_MEDIA_WS_PROTOCOL, type: "stream.rejected", requestId, source });
      return;
    }
    const context = this.context();
    this.streamClients.set(tabKey(attachment.sessionId, attachment.tabId), socket);
    safeSend(socket, {
      protocol: CLIENT_MEDIA_WS_PROTOCOL, type: "stream.accepted", requestId,
      stream: { streamId: context.streamId, generation: context.generation },
    });
    const sent = await this.sendDeviceCommand("stream.requested", context.streamId, context.generation);
    if (!sent) {
      this.streamClients.delete(tabKey(attachment.sessionId, attachment.tabId));
      this.closeDeviceFatal("command_conflict");
      safeSend(socket, {
        protocol: CLIENT_MEDIA_WS_PROTOCOL,
        type: "stream.rejected",
        requestId,
        source: sourceFromState(this.state),
      });
    }
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

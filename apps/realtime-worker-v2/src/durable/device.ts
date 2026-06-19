import { DurableObject } from "cloudflare:workers";
import {
  DEVICE_WS_PROTOCOL,
  DEVICE_MEDIA_PROTOCOL,
  PRESENCE_PROTOCOL,
  DevicePresenceFrameSchema,
  DeviceWsHelloFrameSchema,
  type DeviceWsHelloFrame,
} from "@ktfun/pulse-protocol";
import type { Env } from "../env";
import { globalStub, mediaStub } from "../env";
import { parseFrame, parseJson } from "../utils/frame";
import { createAcceptedPair, upgradeResponse } from "../utils/pair";
import { nowIso } from "../utils/time";
import { closeWith, safeSend, socketAttachment } from "../utils/ws";

interface DeviceAttachment {
  protocol: typeof DEVICE_WS_PROTOCOL;
  connectionId: string;
  deviceId: string;
  deviceSessionId: string;
  connectedAt: string;
}

const SESSION_KEY = "device-session";
const HEARTBEAT_REQUEST = JSON.stringify({
  protocol: PRESENCE_PROTOCOL,
  type: "heartbeat",
  payload: {
    eventId: "heartbeat",
    seq: 0,
    observedAt: "1970-01-01T00:00:00.000Z",
    sentAt: "1970-01-01T00:00:00.000Z",
  },
});
const HEARTBEAT_RESPONSE = JSON.stringify({
  protocol: DEVICE_WS_PROTOCOL,
  type: "heartbeat_ack",
  payload: {},
});
const DEVICE_HEARTBEAT_LEASE_MS = 150_000;

export class DeviceDO extends DurableObject<Env> {
  private deviceId = "owner";
  private deviceSessionId: string | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(HEARTBEAT_REQUEST, HEARTBEAT_RESPONSE),
    );
    ctx.blockConcurrencyWhile(async () => {
      this.deviceSessionId = (await ctx.storage.get<string>(SESSION_KEY)) ?? null;
    });
  }

  async isDeviceSessionActive(deviceSessionId: string) {
    if (this.deviceSessionId !== deviceSessionId) return false;
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socketAttachment<DeviceAttachment>(socket);
      if (attachment?.deviceSessionId === deviceSessionId) return true;
    }
    return false;
  }

  async sendDeviceFrame(frame: unknown): Promise<boolean> {
    const active = this.activeDeviceSocket();
    if (!active) return false;
    return safeSend(active.socket, frame);
  }

  async closeDeviceSocket(code: string): Promise<void> {
    const active = this.activeDeviceSocket();
    if (!active) return;
    closeWith(active.socket, 4000, code);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    this.deviceId = url.searchParams.get("deviceId") ?? "owner";
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket", { status: 426 });
    }
    const { client, server } = createAcceptedPair();
    this.ctx.acceptWebSocket(server);
    return upgradeResponse(client);
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    if (message instanceof ArrayBuffer) {
      const attachment = socketAttachment<DeviceAttachment>(socket);
      if (!attachment) return closeWith(socket, 4000, "hello_required");
      return mediaStub(this.env).handleDeviceBinary(attachment.deviceSessionId, message);
    }

    const json = parseJson(message);
    if (!json) {
      console.log("[device-do] unparseable_message", { message: message.slice(0, 300) });
      return closeWith(socket, 4000, "invalid_frame");
    }
    const protocol = (json as { protocol?: unknown }).protocol;
    console.log("[device-do] message", { protocol, type: (json as { type?: unknown }).type });

    if (protocol === DEVICE_WS_PROTOCOL) {
      const attachment = socketAttachment<DeviceAttachment>(socket);
      if (attachment) return;
      const frame = parseFrame(DeviceWsHelloFrameSchema, message);
      if (!frame) {
        console.log("[device-do] hello_parse_failed", { message: message.slice(0, 500) });
        return closeWith(socket, 4000, "invalid_frame");
      }
      return this.acceptHello(socket, frame);
    }

    const attachment = socketAttachment<DeviceAttachment>(socket);
    if (!attachment) return closeWith(socket, 4000, "hello_required");

    if (protocol === PRESENCE_PROTOCOL) {
      const frame = parseFrame(DevicePresenceFrameSchema, message);
      if (!frame) return closeWith(socket, 4000, "invalid_frame");
      if (frame.type === "snapshot") return this.applyPresence(frame.payload.state);
      if (frame.type === "session_end") return this.endSession(socket);
      return;
    }

    if (protocol === DEVICE_MEDIA_PROTOCOL) {
      return mediaStub(this.env).handleDeviceFrame(attachment.deviceSessionId, message);
    }

    console.log("[device-do] unknown_protocol", { protocol, message: message.slice(0, 300) });
    return closeWith(socket, 4000, "invalid_frame");
  }

  async webSocketClose(socket: WebSocket) {
    await this.endSession(socket);
  }

  async webSocketError(socket: WebSocket) {
    await this.endSession(socket);
  }

  async checkHeartbeatLease(now = Date.now()) {
    const active = this.activeDeviceSocket();
    if (!active || !this.deviceSessionId) return;
    const lastHeartbeat = this.ctx.getWebSocketAutoResponseTimestamp(active.socket);
    const fallback = Date.parse(active.attachment.connectedAt);
    const lastSeen = lastHeartbeat?.getTime() ?? fallback;
    if (Number.isFinite(lastSeen) && now - lastSeen < DEVICE_HEARTBEAT_LEASE_MS) {
      await this.ctx.storage.setAlarm(lastSeen + DEVICE_HEARTBEAT_LEASE_MS);
      return;
    }
    closeWith(active.socket, 4000, "device_lease_expired");
    await this.endSession(active.socket);
  }

  async alarm() {
    await this.checkHeartbeatLease();
  }

  private async acceptHello(
    socket: WebSocket,
    frame: DeviceWsHelloFrame,
  ) {
    const deviceSessionId = crypto.randomUUID();
    const attachment: DeviceAttachment = {
      protocol: DEVICE_WS_PROTOCOL,
      connectionId: crypto.randomUUID(),
      deviceId: this.deviceId,
      deviceSessionId,
      connectedAt: nowIso(),
    };
    this.deviceSessionId = deviceSessionId;
    await this.ctx.storage.put(SESSION_KEY, deviceSessionId);
    socket.serializeAttachment(attachment);
    await this.ctx.storage.setAlarm(Date.now() + DEVICE_HEARTBEAT_LEASE_MS);

    const streaming = frame.payload.media.capabilities.media;
    await mediaStub(this.env).acceptDeviceSession(this.deviceId, deviceSessionId, streaming);

    safeSend(socket, {
      protocol: DEVICE_WS_PROTOCOL,
      type: "hello_ack",
      payload: {
        accepted: true,
        serverTime: nowIso(),
        connectionId: attachment.connectionId,
        deviceSessionId,
        selectedProtocols: frame.payload.supportedProtocols,
        capabilities: { streaming },
      },
    });
  }

  private async applyPresence(state: {
    focus?: {
      app?: {
        id?: string;
        name?: string;
        category?: string;
        window?: { title?: string };
      };
    };
  }) {
    await globalStub(this.env).updateOwnerFocus({
      app: state.focus?.app
        ? {
            id: state.focus.app.id,
            name: state.focus.app.name,
            category: state.focus.app.category,
          }
        : undefined,
      window: state.focus?.app?.window
        ? { title: state.focus.app.window.title }
        : undefined,
      updatedAt: nowIso(),
    });
  }

  private async endSession(socket: WebSocket) {
    const attachment = socketAttachment<DeviceAttachment>(socket);
    if (!attachment || this.deviceSessionId !== attachment.deviceSessionId) return;
    this.deviceSessionId = null;
    await this.ctx.storage.delete(SESSION_KEY);
    await this.ctx.storage.deleteAlarm();
    await mediaStub(this.env).endDeviceSession(attachment.deviceSessionId);
    await globalStub(this.env).updateOwnerFocus(null);
  }

  private activeDeviceSocket() {
    if (!this.deviceSessionId) return null;
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socketAttachment<DeviceAttachment>(socket);
      if (attachment?.deviceSessionId === this.deviceSessionId) {
        return { socket, attachment };
      }
    }
    return null;
  }
}

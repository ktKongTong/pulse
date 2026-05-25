import { DurableObject } from "cloudflare:workers";
import {
  DEVICE_CONNECTION_PROTOCOL,
  DeviceCommonClientFrameSchema,
  type DeviceCommonConnectionHelloFrame,
} from "@ktfun/pulse-protocol";
import type { Env } from "../env";
import { globalStub } from "../env";
import { parseFrame } from "../utils/frame";
import { createAcceptedPair, upgradeResponse } from "../utils/pair";
import { nowIso } from "../utils/time";
import { closeWith, safeSend, socketAttachment } from "../utils/ws";

interface DeviceAttachment {
  protocol: typeof DEVICE_CONNECTION_PROTOCOL;
  connectionId: string;
  deviceId: string;
  deviceSessionId: string;
  connectedAt: string;
}

const SESSION_KEY = "device-session";

export class DeviceDO extends DurableObject<Env> {
  private deviceId = "owner";
  private deviceSessionId: string | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
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
    const frame = parseFrame(DeviceCommonClientFrameSchema, message);
    if (!frame) return closeWith(socket, 4000, "invalid_frame");
    if (frame.type === "hello") return this.acceptHello(socket, frame);
    if (frame.type === "snapshot") return this.applyPresence(frame.payload.state);
    if (frame.type === "session_end") return this.endSession(socket);
  }

  async webSocketClose(socket: WebSocket) {
    await this.endSession(socket);
  }

  async webSocketError(socket: WebSocket) {
    await this.endSession(socket);
  }

  private async acceptHello(
    socket: WebSocket,
    frame: DeviceCommonConnectionHelloFrame,
  ) {
    const deviceSessionId = crypto.randomUUID();
    const attachment: DeviceAttachment = {
      protocol: DEVICE_CONNECTION_PROTOCOL,
      connectionId: crypto.randomUUID(),
      deviceId: this.deviceId,
      deviceSessionId,
      connectedAt: nowIso(),
    };
    this.deviceSessionId = deviceSessionId;
    await this.ctx.storage.put(SESSION_KEY, deviceSessionId);
    socket.serializeAttachment(attachment);
    safeSend(socket, {
      protocol: DEVICE_CONNECTION_PROTOCOL,
      type: "hello_ack",
      payload: {
        accepted: true,
        serverTime: nowIso(),
        connectionId: attachment.connectionId,
        deviceSessionId,
        selectedProtocols: frame.payload.supportedProtocols,
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
    await globalStub(this.env).updateOwnerFocus(null);
  }
}

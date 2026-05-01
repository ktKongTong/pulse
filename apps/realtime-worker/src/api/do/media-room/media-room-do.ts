import { DurableObject } from "cloudflare:workers";

import type { Env } from "../../config/env";

type MediaRoomRole = "producer" | "consumer";

interface MediaRoomSocketAttachment {
  role: MediaRoomRole;
  roomId: string;
  connectionId: string;
}

/**
 * MediaRoomDO 是 Live Listen 的 WebSocket 音频中继实验版。
 *
 * Producer 通过 WebSocket 发送二进制音频块；DO 不解码、不转码、也不缓存，
 * 只把二进制块原样 fan-out 给所有 Consumer。这样可以用 3-5 秒播放缓冲
 * 换取稳定的字节传输链路，绕开 WebRTC 编码/抖动/丢包问题。
 */
export class MediaRoomDO extends DurableObject<Env> {
  private readonly consumers = new Set<WebSocket>();
  private readonly producers = new Set<WebSocket>();

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
    const role = this.parseRole(url.searchParams.get("role"));
    if (!role) {
      return new Response("Missing or invalid role. Use ?role=producer or ?role=consumer.", {
        status: 400,
      });
    }

    const roomId = url.searchParams.get("roomId") ?? "room-test-1";
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    server.serializeAttachment({
      role,
      roomId,
      connectionId: crypto.randomUUID(),
    } satisfies MediaRoomSocketAttachment);

    this.registerSocket(server, role);
    this.ctx.acceptWebSocket(server);

    server.send(JSON.stringify({
      type: "connected",
      role,
      roomId,
      connectionId: this.socketAttachment(server)?.connectionId,
    }));

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    const attachment = this.socketAttachment(socket);
    if (!attachment) return;

    if (typeof message === "string") {
      this.handleTextMessage(socket, attachment, message);
      return;
    }

    if (attachment.role !== "producer") {
      socket.send(JSON.stringify({ type: "error", message: "Only producer can send binary audio." }));
      return;
    }

    this.broadcastAudioChunk(message);
  }

  async webSocketClose(socket: WebSocket) {
    this.unregisterSocket(socket);
  }

  async webSocketError(socket: WebSocket) {
    this.unregisterSocket(socket);
  }

  private parseRole(raw: string | null): MediaRoomRole | null {
    if (raw === "producer" || raw === "consumer") return raw;
    return null;
  }

  private registerSocket(socket: WebSocket, role: MediaRoomRole) {
    if (role === "producer") {
      this.producers.add(socket);
    } else {
      this.consumers.add(socket);
    }
  }

  private unregisterSocket(socket: WebSocket) {
    this.producers.delete(socket);
    this.consumers.delete(socket);
  }

  private socketAttachment(socket: WebSocket): MediaRoomSocketAttachment | null {
    try {
      return socket.deserializeAttachment() as MediaRoomSocketAttachment;
    } catch {
      return null;
    }
  }

  private handleTextMessage(
    socket: WebSocket,
    attachment: MediaRoomSocketAttachment,
    message: string,
  ) {
    if (message === "ping") return;
    if (message === "stats") {
      socket.send(JSON.stringify({
        type: "stats",
        roomId: attachment.roomId,
        producers: this.producers.size,
        consumers: this.consumers.size,
      }));
      return;
    }
    socket.send(JSON.stringify({ type: "ignored", message }));
  }

  private broadcastAudioChunk(chunk: ArrayBuffer) {
    for (const consumer of this.consumerSockets()) {
      try {
        consumer.send(chunk);
      } catch {
        this.unregisterSocket(consumer);
      }
    }
  }

  private consumerSockets(): WebSocket[] {
    const sockets = new Set<WebSocket>(this.consumers);
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = this.socketAttachment(socket);
      if (attachment?.role === "consumer") sockets.add(socket);
    }
    return [...sockets];
  }
}

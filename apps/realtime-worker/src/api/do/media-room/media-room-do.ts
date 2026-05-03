import { DurableObject } from "cloudflare:workers";

import type { Env } from "../../config/env";

type MediaRoomRole = "producer" | "consumer" | "observer";

interface MediaRoomSocketAttachment {
  role: MediaRoomRole;
  roomId: string;
  connectionId: string;
}

interface MediaRoomChunkEnvelope {
  type: "audio-chunk";
  protocol: "pulse.media-room.v1";
  roomId: string;
  streamId: string;
  seq: number;
  sentAt: string;
  durationMs: number;
  codec: "pcm16-wav";
  byteLength: number;
  data: string;
}

interface StoredMediaRoomChunk {
  roomId: string;
  streamId: string;
  seq: number;
  sentAt: string;
  durationMs: number;
  codec: "pcm16-wav";
  byteLength: number;
  data: string;
}

const DEFAULT_ROOM_ID = "room-test-1";
const DEFAULT_STREAM_ID = "native-ws-stream";
const CHUNK_DURATION_MS = 1000;
const RING_BUFFER_SECONDS = 30;
const RING_BUFFER_MAX_CHUNKS = Math.ceil(RING_BUFFER_SECONDS * 1000 / CHUNK_DURATION_MS);
const DEFAULT_ZERO_CONSUMER_GRACE_MS = 10_000;
const LIVE_LISTEN_ROOM_ID = "live-listen:owner";
const LIVE_LISTEN_DEVICE_ID = "owner";

/**
 * MediaRoomDO 是 Live Listen 的 WebSocket 音频中继实验版。
 *
 * Producer 发送音频 chunk；DO 将 chunk 包装成带 seq 的 envelope，写入最近 30 秒
 * 内存 ring buffer，并 fan-out 给 Consumer。Consumer 重连时可用 ?fromSeq=N 请求补发。
 */
export class MediaRoomDO extends DurableObject<Env> {
  private readonly consumers = new Set<WebSocket>();
  private readonly producers = new Set<WebSocket>();
  private readonly observers = new Set<WebSocket>();
  private nextSeq = 1;
  private ringBuffer: StoredMediaRoomChunk[] = [];
  private totalBytesIn = 0;
  private totalBytesOut = 0;
  private totalChunksIn = 0;
  private totalChunksOut = 0;
  private totalReplayChunks = 0;
  private totalReplayMisses = 0;
  private openedAt = new Date().toISOString();
  private zeroConsumersSinceMs: number | null = null;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("ping", "pong"),
    );
    this.ctx.blockConcurrencyWhile(async () => {
      this.nextSeq = await this.ctx.storage.get<number>("nextSeq") ?? 1;
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket", { status: 426 });
    }

    const url = new URL(request.url);
    const role = this.parseRole(url.searchParams.get("role"));
    if (!role) {
      return new Response("Missing or invalid role. Use ?role=producer, ?role=consumer, or ?role=observer.", {
        status: 400,
      });
    }

    const roomId = url.searchParams.get("roomId") ?? DEFAULT_ROOM_ID;
    const fromSeq = this.parseSeq(url.searchParams.get("fromSeq"));
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    server.serializeAttachment({
      role,
      roomId,
      connectionId: crypto.randomUUID(),
    } satisfies MediaRoomSocketAttachment);

    this.registerSocket(server, role);
    await this.refreshZeroConsumerGuard(roomId);
    this.ctx.acceptWebSocket(server);

    server.send(JSON.stringify({
      type: "connected",
      protocol: "pulse.media-room.v1",
      role,
      roomId,
      connectionId: this.socketAttachment(server)?.connectionId,
      nextSeq: this.nextSeq,
      availableFromSeq: this.ringBuffer[0]?.seq ?? this.nextSeq,
      latestSeq: this.nextSeq - 1,
      ringBufferSeconds: RING_BUFFER_SECONDS,
      snapshot: role === "observer" ? this.snapshot(roomId) : undefined,
    }));

    this.emitTelemetry({ type: "socket.open", role, roomId, connectionId: this.socketAttachment(server)?.connectionId ?? "unknown" });

    if (role === "consumer") {
      this.replayBufferedChunks(server, fromSeq);
    }

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
      this.emitTelemetry({ type: "socket.rejected_binary", role: attachment.role, roomId: attachment.roomId, connectionId: attachment.connectionId });
      return;
    }

    if (await this.stopIfZeroConsumerGraceElapsed(attachment.roomId, "chunk_in_without_consumers")) return;
    await this.acceptProducerChunk(attachment, message);
  }

  async webSocketClose(socket: WebSocket) {
    const attachment = this.socketAttachment(socket);
    this.unregisterSocket(socket);
    if (attachment) {
      await this.refreshZeroConsumerGuard(attachment.roomId);
      this.emitTelemetry({ type: "socket.close", role: attachment.role, roomId: attachment.roomId, connectionId: attachment.connectionId });
    }
  }

  async webSocketError(socket: WebSocket) {
    const attachment = this.socketAttachment(socket);
    this.unregisterSocket(socket);
    if (attachment) {
      await this.refreshZeroConsumerGuard(attachment.roomId);
      this.emitTelemetry({ type: "socket.error", role: attachment.role, roomId: attachment.roomId, connectionId: attachment.connectionId });
    }
  }

  async alarm() {
    await this.stopIfZeroConsumerGraceElapsed(DEFAULT_ROOM_ID, "zero_consumer_alarm");
  }

  private parseRole(raw: string | null): MediaRoomRole | null {
    if (raw === "producer" || raw === "consumer" || raw === "observer") return raw;
    return null;
  }

  private parseSeq(raw: string | null): number | null {
    if (!raw) return null;
    const seq = Number.parseInt(raw, 10);
    return Number.isFinite(seq) && seq > 0 ? seq : null;
  }

  private registerSocket(socket: WebSocket, role: MediaRoomRole) {
    if (role === "producer") {
      this.producers.add(socket);
    } else if (role === "consumer") {
      this.consumers.add(socket);
    } else {
      this.observers.add(socket);
    }
  }

  private unregisterSocket(socket: WebSocket) {
    this.producers.delete(socket);
    this.consumers.delete(socket);
    this.observers.delete(socket);
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
        protocol: "pulse.media-room.v1",
        roomId: attachment.roomId,
        producers: this.producers.size,
        consumers: this.consumers.size,
        observers: this.observers.size,
        nextSeq: this.nextSeq,
        availableFromSeq: this.ringBuffer[0]?.seq ?? this.nextSeq,
        latestSeq: this.nextSeq - 1,
        bufferedChunks: this.ringBuffer.length,
        bufferedSeconds: this.bufferedSeconds(),
        snapshot: this.snapshot(attachment.roomId),
      }));
      return;
    }

    try {
      const parsed = JSON.parse(message) as { type?: string; fromSeq?: unknown };
      if (parsed.type === "replay") {
        this.replayBufferedChunks(socket, typeof parsed.fromSeq === "number" ? parsed.fromSeq : null);
        return;
      }
    } catch {
      // Ignore non-JSON control messages below.
    }

    socket.send(JSON.stringify({ type: "ignored", message }));
  }

  private async acceptProducerChunk(attachment: MediaRoomSocketAttachment, chunk: ArrayBuffer) {
    const stored: StoredMediaRoomChunk = {
      roomId: attachment.roomId,
      streamId: DEFAULT_STREAM_ID,
      seq: this.nextSeq,
      sentAt: new Date().toISOString(),
      durationMs: CHUNK_DURATION_MS,
      codec: "pcm16-wav",
      byteLength: chunk.byteLength,
      data: this.arrayBufferToBase64(chunk),
    };
    this.nextSeq += 1;
    this.totalChunksIn += 1;
    this.totalBytesIn += chunk.byteLength;
    this.ringBuffer.push(stored);
    if (this.ringBuffer.length > RING_BUFFER_MAX_CHUNKS) {
      this.ringBuffer = this.ringBuffer.slice(-RING_BUFFER_MAX_CHUNKS);
    }
    await this.ctx.storage.put("nextSeq", this.nextSeq);
    this.broadcastAudioChunk(stored);
    this.emitTelemetry({
      type: "chunk.in",
      roomId: attachment.roomId,
      seq: stored.seq,
      byteLength: stored.byteLength,
      consumers: this.consumerSockets().length,
    });
  }

  private replayBufferedChunks(socket: WebSocket, fromSeq: number | null) {
    if (fromSeq == null) return;
    const availableFromSeq = this.ringBuffer[0]?.seq ?? this.nextSeq;
    if (fromSeq < availableFromSeq) {
      this.totalReplayMisses += 1;
      socket.send(JSON.stringify({
        type: "replay-miss",
        protocol: "pulse.media-room.v1",
        requestedFromSeq: fromSeq,
        availableFromSeq,
        latestSeq: this.nextSeq - 1,
      }));
    }
    let replayed = 0;
    for (const chunk of this.ringBuffer) {
      if (chunk.seq >= fromSeq) {
        this.sendAudioChunk(socket, chunk, true);
        replayed += 1;
      }
    }
    if (replayed > 0) {
      this.totalReplayChunks += replayed;
      this.emitTelemetry({ type: "chunk.replay", requestedFromSeq: fromSeq, replayed });
    }
  }

  private broadcastAudioChunk(chunk: StoredMediaRoomChunk) {
    for (const consumer of this.consumerSockets()) {
      this.sendAudioChunk(consumer, chunk, false);
    }
  }

  private sendAudioChunk(socket: WebSocket, chunk: StoredMediaRoomChunk, replayed: boolean) {
    const envelope: MediaRoomChunkEnvelope & { replayed?: true } = {
      type: "audio-chunk",
      protocol: "pulse.media-room.v1",
      roomId: chunk.roomId,
      streamId: chunk.streamId,
      seq: chunk.seq,
      sentAt: chunk.sentAt,
      durationMs: chunk.durationMs,
      codec: chunk.codec,
      byteLength: chunk.byteLength,
      data: chunk.data,
      ...(replayed ? { replayed: true } : null),
    };
    try {
      socket.send(JSON.stringify(envelope));
      this.totalChunksOut += 1;
      this.totalBytesOut += chunk.byteLength;
    } catch {
      this.unregisterSocket(socket);
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

  private observerSockets(): WebSocket[] {
    const sockets = new Set<WebSocket>(this.observers);
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = this.socketAttachment(socket);
      if (attachment?.role === "observer") sockets.add(socket);
    }
    return [...sockets];
  }

  private emitTelemetry(event: Record<string, unknown>) {
    const roomId = typeof event.roomId === "string" ? event.roomId : DEFAULT_ROOM_ID;
    const payload = JSON.stringify({
      protocol: "pulse.media-room.v1",
      kind: "telemetry",
      at: new Date().toISOString(),
      event,
      snapshot: this.snapshot(roomId),
    });
    for (const observer of this.observerSockets()) {
      try {
        observer.send(payload);
      } catch {
        this.unregisterSocket(observer);
      }
    }
  }

  private snapshot(roomId: string) {
    return {
      roomId,
      openedAt: this.openedAt,
      producers: this.producerSockets().length,
      consumers: this.consumerSockets().length,
      observers: this.observerSockets().length,
      nextSeq: this.nextSeq,
      latestSeq: this.nextSeq - 1,
      availableFromSeq: this.ringBuffer[0]?.seq ?? this.nextSeq,
      bufferedChunks: this.ringBuffer.length,
      bufferedSeconds: this.bufferedSeconds(),
      ringBufferSeconds: RING_BUFFER_SECONDS,
      totalBytesIn: this.totalBytesIn,
      totalBytesOut: this.totalBytesOut,
      totalChunksIn: this.totalChunksIn,
      totalChunksOut: this.totalChunksOut,
      totalReplayChunks: this.totalReplayChunks,
      totalReplayMisses: this.totalReplayMisses,
      zeroConsumersSinceMs: this.zeroConsumersSinceMs,
      zeroConsumerGraceMs: this.zeroConsumerGraceMs(),
      lastChunkBytes: this.ringBuffer.at(-1)?.byteLength ?? 0,
      lastChunkAt: this.ringBuffer.at(-1)?.sentAt ?? null,
    };
  }

  private producerSockets(): WebSocket[] {
    const sockets = new Set<WebSocket>(this.producers);
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = this.socketAttachment(socket);
      if (attachment?.role === "producer") sockets.add(socket);
    }
    return [...sockets];
  }

  private bufferedSeconds() {
    return this.ringBuffer.reduce((total, chunk) => total + chunk.durationMs, 0) / 1000;
  }

  private zeroConsumerGraceMs() {
    const raw = this.env.MEDIA_ROOM_ZERO_CONSUMER_GRACE_MS;
    if (!raw) return DEFAULT_ZERO_CONSUMER_GRACE_MS;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_ZERO_CONSUMER_GRACE_MS;
  }

  private async refreshZeroConsumerGuard(roomId: string) {
    const hasProducer = this.producerSockets().length > 0;
    const hasConsumer = this.consumerSockets().length > 0;
    if (hasConsumer || !hasProducer) {
      if (this.zeroConsumersSinceMs != null) {
        this.emitTelemetry({ type: "zero_consumers.cleared", roomId, consumers: this.consumerSockets().length, producers: this.producerSockets().length });
      }
      this.zeroConsumersSinceMs = null;
      await this.ctx.storage.deleteAlarm();
      return;
    }

    if (this.zeroConsumersSinceMs == null) {
      this.zeroConsumersSinceMs = Date.now();
      this.emitTelemetry({ type: "zero_consumers.started", roomId, graceMs: this.zeroConsumerGraceMs() });
    }
    await this.ctx.storage.setAlarm(this.zeroConsumersSinceMs + this.zeroConsumerGraceMs());
  }

  private async stopIfZeroConsumerGraceElapsed(roomId: string, reason: string) {
    await this.refreshZeroConsumerGuard(roomId);
    if (this.zeroConsumersSinceMs == null) return false;
    if (Date.now() - this.zeroConsumersSinceMs < this.zeroConsumerGraceMs()) return false;
    await this.stopProducersForZeroConsumers(roomId, reason);
    return true;
  }

  private async stopProducersForZeroConsumers(roomId: string, reason: string) {
    const producers = this.producerSockets();
    if (producers.length === 0) return;
    const message = JSON.stringify({
      type: "producer.stop",
      protocol: "pulse.media-room.v1",
      reason: "zero_consumers",
      detail: reason,
      roomId,
      sentAt: new Date().toISOString(),
    });
    for (const producer of producers) {
      try {
        producer.send(message);
        producer.close(1000, "zero consumers");
      } catch {
        this.unregisterSocket(producer);
      }
    }
    this.zeroConsumersSinceMs = null;
    await this.ctx.storage.deleteAlarm();
    await this.sendDeviceStopCommand(roomId, reason);
    this.emitTelemetry({ type: "producer.stop", roomId, reason: "zero_consumers", detail: reason, producers: producers.length });
  }

  private async sendDeviceStopCommand(mediaRoomId: string, reason: string) {
    if (!this.env.DEVICE_DO) return;
    const workspaceId = this.env.WORKSPACE_ID;
    const deviceId = this.env.LIVE_LISTEN_DEVICE_ID?.trim() || LIVE_LISTEN_DEVICE_ID;
    const sentAt = new Date();
    try {
      const id = this.env.DEVICE_DO.idFromName(`${workspaceId}:${deviceId}`);
      const stub = this.env.DEVICE_DO.get(id) as unknown as {
        sendLiveListenCommand(command: unknown): Promise<{ delivered: number }>;
      };
      await stub.sendLiveListenCommand({
        protocol: "live-listen.device.v1",
        kind: "command",
        commandId: crypto.randomUUID(),
        workspaceId,
        roomId: LIVE_LISTEN_ROOM_ID,
        deviceId,
        sentAt: sentAt.toISOString(),
        expiresAt: new Date(sentAt.getTime() + 10_000).toISOString(),
        command: {
          type: "stream.stop",
          reason: "zero_consumers",
          detail: reason,
          mediaRoomId,
        },
      });
    } catch (error) {
      this.emitTelemetry({ type: "device.stop_failed", roomId: mediaRoomId, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    for (let index = 0; index < bytes.byteLength; index += 1) {
      binary += String.fromCharCode(bytes[index]);
    }
    return btoa(binary);
  }
}

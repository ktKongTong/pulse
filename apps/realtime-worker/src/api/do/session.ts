import { DurableObject } from "cloudflare:workers";
import {
  REALTIME_WS_PROTOCOL_V2,
  RealtimeClientMessageSchema,
  RealtimeErrorEnvelopeSchema,
  RealtimeHelloAckSchema,
  RealtimeSnapshotEnvelopeSchema,
  type RealtimeCapabilities,
  type RealtimeClientMessage,
  type RoomSnapshot,
} from "@pulse/realtime-protocol";
import type { Env } from "../config/env";
import { createWorkerLogger } from "../observability/logger";

export interface RoomSessionConnectionState {
  workspaceId: string;
  roomId: string;
  connectionId: string;
  selectedProtocol: string | null;
}

export interface RoomSessionConnectionRecord<
  TState extends RoomSessionConnectionState,
> {
  socket: WebSocket;
  state: TState;
}

type RoomSessionRuntimeMessage = Exclude<
  RealtimeClientMessage,
  { type: "hello" }
>;

export abstract class SessionDO<
  TState extends RoomSessionConnectionState,
> extends DurableObject<Env> {
  private readonly connections = new Map<
    string,
    RoomSessionConnectionRecord<TState>
  >();
  protected readonly sessionLogger;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.sessionLogger = createWorkerLogger(env, "room.session");
    this.restoreConnections();
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const connectionState = await this.createConnectionState(
      request,
      crypto.randomUUID(),
    );

    this.ctx.acceptWebSocket(server);
    this.storeConnection(server, connectionState);
    this.sessionLogger.debug("accept room websocket", {
      roomId: connectionState.roomId,
      workspaceId: connectionState.workspaceId,
      connectionId: connectionState.connectionId,
      connectionCount: this.connections.size,
      url: request.url,
    });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(
    socket: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    const record = this.findConnectionRecord(socket);
    const raw =
      typeof message === "string" ? message : new TextDecoder().decode(message);

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      this.sendError(
        socket,
        record?.state.roomId ?? "unknown",
        "invalid_message",
        "Message failed schema validation.",
      );
      return;
    }

    const parsed = RealtimeClientMessageSchema.safeParse(parsedJson);
    if (!parsed.success) {
      this.sendError(
        socket,
        record?.state.roomId ?? "unknown",
        "invalid_message",
        "Message failed schema validation.",
      );
      return;
    }

    if (!record) {
      this.sessionLogger.warn("missing room connection for websocket message", {
        raw,
      });
      return;
    }

    if (parsed.data.type === "hello") {
      await this.handleHello(record, parsed.data.supportedProtocols);
      return;
    }

    if (!record.state.selectedProtocol) {
      this.sendError(
        socket,
        record.state.roomId,
        "hello_required",
        "Send hello before room commands.",
      );
      return;
    }

    await this.handleRoomMessage(record, parsed.data);
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    const record = this.findConnectionRecord(socket);
    if (!record) return;

    this.removeConnection(record.state.connectionId);
    await this.cleanupConnection(record);
  }

  async webSocketError(socket: WebSocket, error: unknown): Promise<void> {
    const record = this.findConnectionRecord(socket);
    if (!record) return;

    this.sessionLogger.warn("room websocket error", {
      roomId: record.state.roomId,
      connectionId: record.state.connectionId,
      error: error instanceof Error ? error.message : String(error),
    });
    this.removeConnection(record.state.connectionId);
    await this.cleanupConnection(record);
  }

  protected updateConnection(
    record: RoomSessionConnectionRecord<TState>,
    nextState: TState,
  ) {
    const serialized = this.serializeConnectionState(nextState);
    record.state = serialized;
    record.socket.serializeAttachment(serialized);
    this.connections.set(serialized.connectionId, record);
    return serialized;
  }

  protected getConnectionCount() {
    return this.connections.size;
  }

  protected getConnections() {
    return Array.from(this.connections.values());
  }

  protected findConnectionRecord(socket: WebSocket) {
    return this.ensureConnection(socket);
  }

  protected removeConnection(connectionId: string) {
    this.deleteConnection(connectionId);
  }

  protected broadcastSnapshot(snapshot: RoomSnapshot) {
    const payload = RealtimeSnapshotEnvelopeSchema.parse({
      type: "snapshot",
      roomId: snapshot.roomId,
      payload: snapshot,
    });
    const encoded = JSON.stringify(payload);
    for (const record of this.connections.values()) {
      try {
        record.socket.send(encoded);
      } catch (error) {
        this.sessionLogger.warn("room snapshot send failed", {
          roomId: record.state.roomId,
          connectionId: record.state.connectionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  protected sendError(
    socket: WebSocket,
    roomId: string,
    code: string,
    message: string,
  ) {
    this.send(
      socket,
      RealtimeErrorEnvelopeSchema.parse({
        type: "error",
        roomId,
        code,
        message,
      }),
    );
  }

  protected send(socket: WebSocket, message: unknown) {
    try {
      socket.send(JSON.stringify(message));
    } catch (error) {
      this.sessionLogger.warn("room websocket send failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  protected abstract createConnectionState(
    request: Request,
    connectionId: string,
  ): Promise<TState>;

  protected abstract serializeConnectionState(state: TState): TState;

  protected abstract buildInitialSnapshot(
    record: RoomSessionConnectionRecord<TState>,
  ): Promise<RoomSnapshot>;

  protected abstract handleRoomMessage(
    record: RoomSessionConnectionRecord<TState>,
    message: RoomSessionRuntimeMessage,
  ): Promise<void>;

  protected abstract cleanupConnection(
    record: RoomSessionConnectionRecord<TState>,
  ): Promise<void>;

  protected connectionCapabilities(
    _record: RoomSessionConnectionRecord<TState>,
  ): RealtimeCapabilities {
    return {
      presence: true,
      multiRoom: true,
      chat: true,
      richMedia: true,
      interaction: true,
    };
  }

  private async handleHello(
    record: RoomSessionConnectionRecord<TState>,
    supportedProtocols: string[],
  ) {
    if (!supportedProtocols.includes(REALTIME_WS_PROTOCOL_V2)) {
      this.sendError(
        record.socket,
        record.state.roomId,
        "unsupported_protocol",
        "Client does not support realtime.ws.v2.",
      );
      return;
    }

    const nextState = this.updateConnection(record, {
      ...record.state,
      selectedProtocol: REALTIME_WS_PROTOCOL_V2,
    });
    this.send(
      record.socket,
      RealtimeHelloAckSchema.parse({
        type: "hello_ack",
        selectedProtocol: REALTIME_WS_PROTOCOL_V2,
        capabilities: this.connectionCapabilities(record),
      }),
    );

    const snapshot = await this.buildInitialSnapshot({
      socket: record.socket,
      state: nextState,
    });
    this.send(
      record.socket,
      RealtimeSnapshotEnvelopeSchema.parse({
        type: "snapshot",
        roomId: snapshot.roomId,
        payload: snapshot,
      }),
    );
  }

  private ensureConnection(socket: WebSocket) {
    const attached = socket.deserializeAttachment() as TState | null;
    if (!attached?.connectionId || !attached.roomId || !attached.workspaceId) {
      return null;
    }

    const existing = this.connections.get(attached.connectionId);
    if (existing) {
      if (existing.socket !== socket) {
        existing.socket = socket;
      }
      return existing;
    }

    const record = { socket, state: attached };
    this.connections.set(attached.connectionId, record);
    return record;
  }

  private storeConnection(socket: WebSocket, state: TState) {
    const serialized = this.serializeConnectionState(state);
    socket.serializeAttachment(serialized);
    this.connections.set(serialized.connectionId, { socket, state: serialized });
  }

  private restoreConnections() {
    for (const socket of this.ctx.getWebSockets()) {
      const attached = socket.deserializeAttachment() as TState | null;
      if (!attached?.connectionId || !attached.roomId || !attached.workspaceId) {
        continue;
      }
      this.connections.set(attached.connectionId, { socket, state: attached });
    }
  }

  private deleteConnection(connectionId: string) {
    this.connections.delete(connectionId);
  }
}

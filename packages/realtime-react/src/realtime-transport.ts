import {
  REALTIME_WS_PROTOCOL_V2,
  RealtimeHelloAckSchema,
  RealtimeServerMessageSchema,
  type RealtimeCapabilities,
  type RealtimeServerMessage,
} from "@pulse/realtime-protocol";

import type { PulseRealtimeConfig } from "./types";
import { createRealtimeLogger } from "./logger";

type MessageHandler = (message: RealtimeServerMessage) => void;
type ReadyHandler = () => void;
type StateHandler = (state: RealtimeTransportState) => void;

export type RealtimeTransportStatus =
  | "idle"
  | "connecting"
  | "ready"
  | "reconnecting"
  | "closed"
  | "error";

export interface RealtimeTransportState {
  status: RealtimeTransportStatus;
  selectedProtocol: string | null;
  capabilities: RealtimeCapabilities | null;
  lastError: string | null;
  lastMessageType: RealtimeServerMessage["type"] | null;
}

export class RealtimeTransport {
  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private handshakeComplete = false;
  private manuallyClosed = false;
  private messageHandlers = new Set<MessageHandler>();
  private readyHandlers = new Set<ReadyHandler>();
  private stateHandlers = new Set<StateHandler>();
  private readonly logger;

  private state: RealtimeTransportState = {
    status: "idle",
    selectedProtocol: null,
    capabilities: null,
    lastError: null,
    lastMessageType: null,
  };

  constructor(
    private readonly config: PulseRealtimeConfig,
    readonly roomId: string,
  ) {
    this.logger = createRealtimeLogger(config.debug ?? false);
  }

  connect() {
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING)
    ) {
      this.debug("connect.skip", {
        readyState: this.socket.readyState,
        handshakeComplete: this.handshakeComplete,
      });
      return;
    }

    this.manuallyClosed = false;
    this.updateState({
      status:
        this.state.status === "reconnecting" ? "reconnecting" : "connecting",
      lastError: null,
    });
    const endpoint = new URL(
      `/api/v1/realtime/ws`,
      this.config.baseUrl ? this.config.baseUrl : window.location.origin,
    );
    endpoint.searchParams.set("workspaceId", this.config.workspaceId);
    endpoint.searchParams.set("roomId", this.roomId);
    this.debug("connect.start", {
      endpoint: endpoint.toString().replace(/^http/, "ws"),
      workspaceId: this.config.workspaceId,
      roomId: this.roomId,
    });

    const socket = new WebSocket(endpoint.toString().replace(/^http/, "ws"));
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.debug("socket.open");
      socket.send(
        JSON.stringify({
          type: "hello",
          supportedProtocols: [REALTIME_WS_PROTOCOL_V2],
          sdkVersion: "0.1.0",
        }),
      );
    });

    socket.addEventListener("message", (event) => {
      const raw =
        typeof event.data === "string" ? event.data : String(event.data);
      this.debug("socket.message", { raw });
      const parsed = RealtimeServerMessageSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        this.updateState({
          status: "error",
          lastError: "invalid_server_message",
        });
        this.debug("socket.invalid_message");
        return;
      }
      this.updateState({ lastMessageType: parsed.data.type });
      if (parsed.data.type === "hello_ack") {
        const ack = RealtimeHelloAckSchema.parse(parsed.data);
        this.handshakeComplete = true;
        this.debug("socket.hello_ack", {
          selectedProtocol: ack.selectedProtocol,
          capabilities: ack.capabilities,
        });
        this.updateState({
          status: "ready",
          selectedProtocol: ack.selectedProtocol,
          capabilities: ack.capabilities,
          lastError: null,
        });
        this.readyHandlers.forEach((handler) => handler());
      }
      this.messageHandlers.forEach((handler) => handler(parsed.data));
    });

    socket.addEventListener("error", () => {
      this.debug("socket.error");
      this.updateState({ status: "error", lastError: "socket_error" });
    });

    socket.addEventListener("close", () => {
      this.debug("socket.close", { manuallyClosed: this.manuallyClosed });
      this.socket = null;
      this.handshakeComplete = false;
      this.updateState({
        status: this.manuallyClosed ? "closed" : "reconnecting",
      });
      if (!this.manuallyClosed) {
        this.scheduleReconnect();
      }
    });
  }

  disconnect() {
    this.manuallyClosed = true;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
    this.handshakeComplete = false;
    this.updateState({ status: "closed" });
  }

  send(message: unknown) {
    this.debug("send", {
      readyState: this.socket?.readyState ?? null,
      handshakeComplete: this.handshakeComplete,
      message,
    });
    if (this.socket?.readyState === WebSocket.OPEN && this.handshakeComplete) {
      this.socket.send(JSON.stringify(message));
    }
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onReady(handler: ReadyHandler): () => void {
    this.readyHandlers.add(handler);
    return () => this.readyHandlers.delete(handler);
  }

  onState(handler: StateHandler): () => void {
    this.stateHandlers.add(handler);
    handler(this.state);
    return () => this.stateHandlers.delete(handler);
  }

  get isReady() {
    return this.handshakeComplete;
  }

  get snapshot() {
    return this.state;
  }

  private scheduleReconnect() {
    if (this.reconnectTimer !== null) return;
    this.updateState({ status: "reconnecting" });
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 1000);
  }

  private updateState(patch: Partial<RealtimeTransportState>) {
    this.state = {
      ...this.state,
      ...patch,
    };
    this.debug("state", this.state);
    this.stateHandlers.forEach((handler) => handler(this.state));
  }

  private debug(event: string, payload?: unknown) {
    this.logger.debug("[realtime.transport]", event, payload ?? "");
  }
}

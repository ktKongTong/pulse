import { DurableObject } from "cloudflare:workers";
import {
  REALTIME_WS_PROTOCOL_V1,
  RealtimeClientMessageSchema,
  RealtimeHelloAckSchema,
  RealtimeSnapshotEnvelopeSchema,
  type RoomSnapshot
} from "@pulse/realtime-protocol";

import type { Env } from "./env";
import { createWorkerLogger } from "./logger";
import type { RoomRpc } from "./durable-stubs";
import { pageRoomId } from "./lib/url";

interface SessionPresenceContext {
  sessionId: string;
  tabId: string;
  userId?: string;
  page: {
    title: string;
    url: string;
    canonicalUrl?: string;
  };
}

interface StoredSessionState {
  workspaceId: string;
  selectedProtocol: string | null;
  roomSubscriptions: Record<string, string>;
  chatMemberships: Record<string, { displayName: string; userId?: string }>;
  presenceContext?: SessionPresenceContext;
}

export class RealtimeSession extends DurableObject<Env> {
  private sessionState?: StoredSessionState;
  private readonly logger;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.logger = createWorkerLogger(env, "session.do");
    const restored = this.ctx
      .getWebSockets()
      .map((socket) => socket.deserializeAttachment() as StoredSessionState | null)
      .find(Boolean);
    if (restored) {
      this.sessionState = restored;
    }
  }

  // --- External Fetch (WS Handshake) ---

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const sessionState = this.getState(this.env.WORKSPACE_ID);

    this.logger.debug("accept websocket", {
      sessionDoId: this.ctx.id.toString(),
      workspaceId: sessionState.workspaceId,
      url: request.url,
    });
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(sessionState);
    this.sessionState = sessionState;
    return new Response(null, { status: 101, webSocket: client });
  }

  // --- WebSocket Hibernation Events ---

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const raw = typeof message === "string" ? message : new TextDecoder().decode(message);
    this.logger.debug("ws message inbound", {
      sessionDoId: this.ctx.id.toString(),
      raw,
    });
    const parsed = RealtimeClientMessageSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      this.send(socket, {
        protocol: REALTIME_WS_PROTOCOL_V1,
        type: "error",
        code: "invalid_message",
        message: "Message failed schema validation."
      });
      return;
    }

    const sessionState = this.getState();
    switch (parsed.data.type) {
      case "hello": {
        const selectedProtocol = parsed.data.supportedProtocols.includes(REALTIME_WS_PROTOCOL_V1)
          ? REALTIME_WS_PROTOCOL_V1
          : parsed.data.supportedProtocols[0];
        sessionState.selectedProtocol = selectedProtocol;
        this.persist(sessionState);
        this.logger.debug("hello ack", {
          sessionDoId: this.ctx.id.toString(),
          selectedProtocol,
        });
        this.send(
          socket,
          RealtimeHelloAckSchema.parse({
            type: "hello_ack",
            selectedProtocol,
            capabilities: {
              presence: true,
              multiRoom: true,
              chat: true,
              richMedia: true,
              interaction: true
            }
          })
        );
        return;
      }
      case "subscribe": {
        if (!sessionState.selectedProtocol) return this.sendHelloRequiredError(socket);

        for (const item of parsed.data.subscriptions) {
          const roomId = item.roomId;
          try {
            const previousSubscriptionId = sessionState.roomSubscriptions[roomId];
            if (previousSubscriptionId && previousSubscriptionId !== item.subscriptionId) {
              this.logger.debug("replace existing subscription", {
                sessionDoId: this.ctx.id.toString(),
                roomId,
                previousSubscriptionId,
                nextSubscriptionId: item.subscriptionId,
              });
              await this.roomStub(sessionState.workspaceId, roomId).unsubscribeSession(this.ctx.id.toString());
            }
            sessionState.roomSubscriptions[roomId] = item.subscriptionId;
            this.persist(sessionState);
            this.logger.debug("subscription stored", {
              sessionDoId: this.ctx.id.toString(),
              workspaceId: sessionState.workspaceId,
              roomId,
              subscriptionId: item.subscriptionId,
              roomSubscriptions: sessionState.roomSubscriptions,
            });

            const roomStub = this.roomStub(sessionState.workspaceId, roomId);
            this.logger.debug("subscribe room start", {
              sessionDoId: this.ctx.id.toString(),
              roomId,
              subscriptionId: item.subscriptionId,
            });
            await roomStub.subscribeSession(sessionState.workspaceId, roomId, this.ctx.id.toString());
            this.logger.debug("subscribe room success", {
              sessionDoId: this.ctx.id.toString(),
              roomId,
              subscriptionId: item.subscriptionId,
            });
            
            const snapshot = await roomStub.getSnapshot(sessionState.workspaceId, roomId) as RoomSnapshot;
            this.logger.debug("initial snapshot", {
              sessionDoId: this.ctx.id.toString(),
              roomId,
              subscriptionId: item.subscriptionId,
              population: roomSnapshotPopulation(snapshot),
              revision: snapshot.revision,
            });
            this.sendSnapshot(socket, item.subscriptionId, roomId, snapshot);
          } catch (error) {
            this.logger.error("subscribe failed", {
              sessionDoId: this.ctx.id.toString(),
              workspaceId: sessionState.workspaceId,
              roomId,
              subscriptionId: item.subscriptionId,
              error: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined,
            });
            this.send(socket, {
              protocol: REALTIME_WS_PROTOCOL_V1,
              type: "error",
              code: "subscribe_failed",
              message: error instanceof Error ? error.message : "subscribe_failed",
              subscriptionId: item.subscriptionId,
            });
          }
        }
        return;
      }
      case "unsubscribe": {
        for (const subscriptionId of parsed.data.subscriptionIds) {
          const roomId = findRoomIdBySubscriptionId(sessionState.roomSubscriptions, subscriptionId);
          if (!roomId) continue;

          if (roomId.startsWith("chat:") && sessionState.chatMemberships[roomId]) {
            delete sessionState.chatMemberships[roomId];
            await this.roomStub(sessionState.workspaceId, roomId).leaveChat(
              sessionState.workspaceId,
              roomId,
              this.ctx.id.toString(),
            );
          }
          delete sessionState.roomSubscriptions[roomId];
          this.persist(sessionState);
          this.logger.debug("unsubscribe removed", {
            sessionDoId: this.ctx.id.toString(),
            roomId,
            subscriptionId,
            roomSubscriptions: sessionState.roomSubscriptions,
          });
          await this.roomStub(sessionState.workspaceId, roomId).unsubscribeSession(this.ctx.id.toString());
        }
        return;
      }
      case "chat_join": {
        if (!sessionState.selectedProtocol) return this.sendHelloRequiredError(socket);
        sessionState.chatMemberships[parsed.data.roomId] = {
          displayName: parsed.data.displayName,
          userId: parsed.data.userId,
        };
        this.persist(sessionState);
        await this.roomStub(sessionState.workspaceId, parsed.data.roomId).joinChat(
          sessionState.workspaceId,
          parsed.data.roomId,
          this.ctx.id.toString(),
          parsed.data.userId ?? `anon:${this.ctx.id.toString().slice(0, 8)}`,
          parsed.data.displayName,
        );
        return;
      }
      case "chat_leave": {
        if (sessionState.chatMemberships[parsed.data.roomId]) {
          delete sessionState.chatMemberships[parsed.data.roomId];
          this.persist(sessionState);
          await this.roomStub(sessionState.workspaceId, parsed.data.roomId).leaveChat(
            sessionState.workspaceId,
            parsed.data.roomId,
            this.ctx.id.toString(),
          );
        }
        return;
      }
      case "chat_send": {
        if (!sessionState.selectedProtocol) return this.sendHelloRequiredError(socket);
        const membership = sessionState.chatMemberships[parsed.data.roomId];
        if (!membership) {
          this.send(socket, {
            protocol: REALTIME_WS_PROTOCOL_V1,
            type: "error",
            code: "chat_join_required",
            message: "Join chat room before sending messages.",
          });
          return;
        }
        await this.roomStub(sessionState.workspaceId, parsed.data.roomId).postChatMessage(
          sessionState.workspaceId,
          parsed.data.roomId,
          this.ctx.id.toString(),
          membership.userId ?? `anon:${this.ctx.id.toString().slice(0, 8)}`,
          membership.displayName,
          parsed.data.content,
        );
        return;
      }
      case "presence_context": {
        sessionState.presenceContext = {
          sessionId: parsed.data.sessionId,
          tabId: parsed.data.tabId,
          userId: parsed.data.userId,
          page: parsed.data.page,
        };
        this.persist(sessionState);
        return;
      }
    }
  }

  async webSocketClose(_socket: WebSocket): Promise<void> {
    const sessionState = this.getState();
    this.logger.debug("websocket close", {
      sessionDoId: this.ctx.id.toString(),
      roomSubscriptions: sessionState.roomSubscriptions,
    });
    await this.notifyPresenceEnded(sessionState);
    await this.unsubscribeFromAllRooms(sessionState);
    this.sessionState = undefined;
  }

  async webSocketError(_socket: WebSocket, error: unknown): Promise<void> {
    const sessionState = this.getState();
    this.logger.warn("websocket error", {
      sessionDoId: this.ctx.id.toString(),
      error: error instanceof Error ? error.message : String(error),
    });
    await this.notifyPresenceEnded(sessionState);
    await this.unsubscribeFromAllRooms(sessionState);
    this.sessionState = undefined;
  }

  // --- RPC Inbound API ---
  
  async pushRoomSnapshot(roomId: string, snapshot: RoomSnapshot): Promise<void> {
    const sessionState = this.getState();
    const subscriptionId = sessionState.roomSubscriptions[roomId];
    this.logger.debug("push room snapshot inbound", {
      sessionDoId: this.ctx.id.toString(),
      roomId,
      subscriptionId: subscriptionId ?? null,
      knownSubscriptions: sessionState.roomSubscriptions,
      population: roomSnapshotPopulation(snapshot),
      revision: snapshot.revision,
      socketCount: this.ctx.getWebSockets().length,
    });
    if (!subscriptionId) {
      this.logger.warn("push room snapshot missing subscription", {
        sessionDoId: this.ctx.id.toString(),
        roomId,
        knownSubscriptions: sessionState.roomSubscriptions,
      });
      return;
    }

    const payload = RealtimeSnapshotEnvelopeSchema.parse({
      type: "snapshot",
      subscriptionId,
      roomId,
      payload: snapshot
    });
    this.sendToAll(payload);
  }

  // --- Helpers ---

  private sendHelloRequiredError(socket: WebSocket) {
    this.send(socket, {
      protocol: REALTIME_WS_PROTOCOL_V1,
      type: "error",
      code: "hello_required",
      message: "Send hello before subscribe."
    });
  }

  private sendSnapshot(socket: WebSocket, subscriptionId: string, roomId: string, snapshot: RoomSnapshot) {
    this.send(
      socket,
      RealtimeSnapshotEnvelopeSchema.parse({
        type: "snapshot",
        subscriptionId,
        roomId,
        payload: snapshot
      })
    );
  }

  private send(socket: WebSocket, message: unknown) {
    try {
      this.logger.debug("send single", {
        sessionDoId: this.ctx.id.toString(),
        type: (message as { type?: string })?.type ?? "unknown",
      });
      socket.send(JSON.stringify(message));
    } catch (e) {
      // socket closed
      this.logger.warn("send single failed", {
        sessionDoId: this.ctx.id.toString(),
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  private sendToAll(message: unknown) {
    const payload = JSON.stringify(message);
    this.logger.debug("send to all begin", {
      sessionDoId: this.ctx.id.toString(),
      type: (message as { type?: string })?.type ?? "unknown",
      socketCount: this.ctx.getWebSockets().length,
    });
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(payload);
      } catch (e) {
        this.logger.warn("send to all failed", {
          sessionDoId: this.ctx.id.toString(),
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  private roomStub(workspaceId: string, roomId: string): RoomRpc {
    const id = this.env.REALTIME_ROOM.idFromName(`${workspaceId}:${roomId}`);
    return this.env.REALTIME_ROOM.get(id) as unknown as RoomRpc;
  }

  private getState(workspaceId?: string): StoredSessionState {
    if (this.sessionState) {
      return this.sessionState;
    }
    const loaded = this.ctx
      .getWebSockets()
      .map((socket) => socket.deserializeAttachment() as StoredSessionState | null)
      .find(Boolean);
    this.sessionState = loaded ?? {
      workspaceId: workspaceId ?? this.env.WORKSPACE_ID,
      selectedProtocol: null,
      roomSubscriptions: {},
      chatMemberships: {}
    };
    if (!this.sessionState.roomSubscriptions) {
      this.sessionState.roomSubscriptions = {};
    }
    if (!this.sessionState.chatMemberships) {
      this.sessionState.chatMemberships = {};
    }
    return this.sessionState;
  }

  private persist(sessionState: StoredSessionState) {
    this.sessionState = sessionState;
    for (const socket of this.ctx.getWebSockets()) {
      socket.serializeAttachment(sessionState);
    }
  }

  private async unsubscribeFromAllRooms(sessionState: StoredSessionState) {
    const roomIds = Object.keys(sessionState.roomSubscriptions);
    await Promise.all(
      roomIds.map(async (roomId) => {
        if (roomId.startsWith("chat:") && sessionState.chatMemberships[roomId]) {
          await this.roomStub(sessionState.workspaceId, roomId).leaveChat(
            sessionState.workspaceId,
            roomId,
            this.ctx.id.toString(),
          );
        }
        await this.roomStub(sessionState.workspaceId, roomId).unsubscribeSession(this.ctx.id.toString());
      })
    );
    sessionState.roomSubscriptions = {};
    sessionState.chatMemberships = {};
    sessionState.presenceContext = undefined;
  }

  private async notifyPresenceEnded(sessionState: StoredSessionState) {
    const context = sessionState.presenceContext;
    if (!context) return;

    const canonicalUrl = context.page.canonicalUrl ?? context.page.url;
    await this.roomStub(sessionState.workspaceId, "global").removeWebReader(
      sessionState.workspaceId,
      "global",
      context.sessionId,
      context.tabId,
    );
    await this.roomStub(sessionState.workspaceId, pageRoomId(canonicalUrl)).removeWebReader(
      sessionState.workspaceId,
      pageRoomId(canonicalUrl),
      context.sessionId,
      context.tabId,
    );
    sessionState.presenceContext = undefined;
  }
}

function findRoomIdBySubscriptionId(roomSubscriptions: Record<string, string>, subscriptionId: string) {
  return Object.entries(roomSubscriptions).find(([, value]) => value === subscriptionId)?.[0];
}

function roomSnapshotPopulation(snapshot: RoomSnapshot) {
  switch (snapshot.roomKind) {
    case "chat":
      return snapshot.participantCount;
    case "page":
    case "global":
      return snapshot.onlineCount;
  }
}

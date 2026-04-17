import { DurableObject } from "cloudflare:workers";
import {
  RealtimeStatsEnvelopeSchema,
  RealtimeStatsErrorEnvelopeSchema,
  REALTIME_WS_PROTOCOL_V1,
  RealtimeClientMessageSchema,
  RealtimeHelloAckSchema,
  RealtimeSnapshotEnvelopeSchema,
  type RealtimeStatsSubscription,
  type RoomSnapshot
} from "@pulse/realtime-protocol";

import type { Env } from "./env";
import type { RealtimeRoom } from "./room-do";

interface StoredSessionState {
  workspaceId: string;
  selectedProtocol: string | null;
  roomSubscriptions: Record<string, string>;
  chatMemberships: Record<string, { displayName: string; userId?: string }>;
}

const SESSION_STATE_KEY = "session-state";

export class RealtimeSession extends DurableObject<Env> {
  private sessionState?: StoredSessionState;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
  }

  // --- External Fetch (WS Handshake) ---

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket", { status: 426 });
    }

    const sessionState = await this.getState(this.env.WORKSPACE_ID);
    
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    console.log("[session.fetch] accept", {
      sessionDoId: this.ctx.id.toString(),
      workspaceId: sessionState.workspaceId,
      url: request.url,
    });
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  // --- WebSocket Hibernation Events ---

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const raw = typeof message === "string" ? message : new TextDecoder().decode(message);
    console.log("[session.wsMessage] inbound", {
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

    const sessionState = await this.getState();
    switch (parsed.data.type) {
      case "hello": {
        const selectedProtocol = parsed.data.supportedProtocols.includes(REALTIME_WS_PROTOCOL_V1)
          ? REALTIME_WS_PROTOCOL_V1
          : parsed.data.supportedProtocols[0];
        sessionState.selectedProtocol = selectedProtocol;
        await this.persist(sessionState);
        console.log("[session.hello] ack", {
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
              interaction: true,
              statsPush: true
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
              console.log("[session.subscribe] replacingExisting", {
                sessionDoId: this.ctx.id.toString(),
                roomId,
                previousSubscriptionId,
                nextSubscriptionId: item.subscriptionId,
              });
              await this.roomStub(sessionState.workspaceId, roomId).unsubscribeSession(this.ctx.id.toString());
            }
            sessionState.roomSubscriptions[roomId] = item.subscriptionId;
            await this.persist(sessionState);
            console.log("[session.subscribe] stored", {
              sessionDoId: this.ctx.id.toString(),
              workspaceId: sessionState.workspaceId,
              roomId,
              subscriptionId: item.subscriptionId,
              roomSubscriptions: sessionState.roomSubscriptions,
            });

            const roomStub = this.roomStub(sessionState.workspaceId, roomId);
            console.log("[session.subscribe] subscribingRoom", {
              sessionDoId: this.ctx.id.toString(),
              roomId,
              subscriptionId: item.subscriptionId,
            });
            await roomStub.subscribeSession(sessionState.workspaceId, roomId, this.ctx.id.toString());
            console.log("[session.subscribe] roomSubscribed", {
              sessionDoId: this.ctx.id.toString(),
              roomId,
              subscriptionId: item.subscriptionId,
            });
            
            const snapshot = await roomStub.getSnapshot(sessionState.workspaceId, roomId) as RoomSnapshot;
            console.log("[session.subscribe] initialSnapshot", {
              sessionDoId: this.ctx.id.toString(),
              roomId,
              subscriptionId: item.subscriptionId,
              population: roomSnapshotPopulation(snapshot),
              revision: snapshot.revision,
            });
            this.sendSnapshot(socket, item.subscriptionId, roomId, snapshot);
          } catch (error) {
            console.error("[session.subscribe] failed", {
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
      case "subscribe_stats": {
        // Stats omitted for brevity
        return;
      }
      case "unsubscribe_stats": {
        // Stats omitted for brevity
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
          await this.persist(sessionState);
          console.log("[session.unsubscribe] removed", {
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
        await this.persist(sessionState);
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
          await this.persist(sessionState);
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
    }
  }

  async webSocketClose(_socket: WebSocket): Promise<void> {
    const sessionState = await this.getState();
    console.log("[session.close] closing", {
      sessionDoId: this.ctx.id.toString(),
      roomSubscriptions: sessionState.roomSubscriptions,
    });
    await this.unsubscribeFromAllRooms(sessionState);
    await this.ctx.storage.delete(SESSION_STATE_KEY);
    this.sessionState = undefined;
  }

  // --- RPC Inbound API ---
  
  async pushRoomSnapshot(roomId: string, snapshot: RoomSnapshot): Promise<void> {
    const sessionState = await this.getState();
    const subscriptionId = sessionState.roomSubscriptions[roomId];
    console.log("[session.pushRoomSnapshot] inbound", {
      sessionDoId: this.ctx.id.toString(),
      roomId,
      subscriptionId: subscriptionId ?? null,
      knownSubscriptions: sessionState.roomSubscriptions,
      population: roomSnapshotPopulation(snapshot),
      revision: snapshot.revision,
      socketCount: this.ctx.getWebSockets().length,
    });
    if (!subscriptionId) {
      console.warn("[session.pushRoomSnapshot] missingSubscription", {
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

  async pushDeviceUpdate(deviceId: string, state: any): Promise<void> {
    // Currently, DeviceUpdates are pushed through to all websockets on this session 
    // Usually they listen on global channel
    this.sendToAll({
        type: "device_update",
        deviceId,
        state
    });
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
      console.log("[session.send] single", {
        sessionDoId: this.ctx.id.toString(),
        type: (message as { type?: string })?.type ?? "unknown",
      });
      socket.send(JSON.stringify(message));
    } catch (e) {
      // socket closed
      console.warn("[session.send] failed", {
        sessionDoId: this.ctx.id.toString(),
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  private sendToAll(message: unknown) {
    const payload = JSON.stringify(message);
    console.log("[session.sendToAll] begin", {
      sessionDoId: this.ctx.id.toString(),
      type: (message as { type?: string })?.type ?? "unknown",
      socketCount: this.ctx.getWebSockets().length,
    });
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(payload);
      } catch (e) {
        console.warn("[session.sendToAll] failed", {
          sessionDoId: this.ctx.id.toString(),
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  private roomStub(workspaceId: string, roomId: string): DurableObjectStub<RealtimeRoom> {
    const id = this.env.REALTIME_ROOM.idFromName(`${workspaceId}:${roomId}`);
    return this.env.REALTIME_ROOM.get(id) as unknown as DurableObjectStub<RealtimeRoom>;
  }

  private async getState(workspaceId?: string): Promise<StoredSessionState> {
    if (this.sessionState) {
      return this.sessionState;
    }
    const loaded = await this.ctx.storage.get<StoredSessionState>(SESSION_STATE_KEY);
    this.sessionState = loaded
      ? loaded
      : {
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

  private async persist(sessionState: StoredSessionState) {
    this.sessionState = sessionState;
    await this.ctx.storage.put(SESSION_STATE_KEY, sessionState);
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

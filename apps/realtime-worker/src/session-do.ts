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

interface StoredSessionState {
  workspaceId: string;
  roomsBySubscriptionId: Record<string, string>;
  subscriptionIdsByRoom: Record<string, string[]>;
  statsBySubscriptionId: Record<string, RealtimeStatsSubscription>;
  selectedProtocol: string | null;
}

interface PushPayload {
  roomId: string;
  snapshot: RoomSnapshot;
}

const SESSION_STATE_KEY = "session-state";

export class RealtimeSession extends DurableObject<Env> {
  private sessionState?: StoredSessionState;

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const sessionState = await this.getState(request);
    switch (url.pathname) {
      case "/internal/ws":
      case "/api/v1/realtime/ws":
        return this.handleWebSocket(request);
      case "/internal/push":
        return this.handlePush(request, sessionState);
      default:
        return new Response("Not found", { status: 404 });
    }
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const raw = typeof message === "string" ? message : new TextDecoder().decode(message);
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
        this.send(
          socket,
          RealtimeHelloAckSchema.parse({
            type: "hello_ack",
            selectedProtocol,
            capabilities: {
              presence: true,
              multiRoom: true,
              chat: false,
              richMedia: true,
              interaction: true,
              statsPush: true
            }
          })
        );
        return;
      }
      case "subscribe": {
        if (!sessionState.selectedProtocol) {
          this.send(socket, {
            protocol: REALTIME_WS_PROTOCOL_V1,
            type: "error",
            code: "hello_required",
            message: "Send hello before subscribe."
          });
          return;
        }

        for (const item of parsed.data.subscriptions) {
          const roomId = item.roomId;
          sessionState.roomsBySubscriptionId[item.subscriptionId] = roomId;
          sessionState.subscriptionIdsByRoom[roomId] = [
            ...(sessionState.subscriptionIdsByRoom[roomId] ?? []).filter((id) => id !== item.subscriptionId),
            item.subscriptionId
          ];

          await this.roomStub(sessionState.workspaceId, roomId).fetch(
            new Request("https://room.internal/internal/subscribe-session", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-workspace-id": sessionState.workspaceId,
                "x-room-id": roomId
              },
              body: JSON.stringify({ sessionDoId: this.ctx.id.toString() })
            })
          );

          const snapshotResponse = await this.roomStub(sessionState.workspaceId, roomId).fetch(
            new Request("https://room.internal/internal/snapshot", {
              headers: {
                "x-workspace-id": sessionState.workspaceId,
                "x-room-id": roomId
              }
            })
          );
          const snapshot = (await snapshotResponse.json()) as RoomSnapshot;
          this.sendSnapshot(socket, item.subscriptionId, roomId, snapshot);
        }

        await this.persist(sessionState);
        return;
      }
      case "subscribe_stats": {
        if (!sessionState.selectedProtocol) {
          this.send(socket, {
            protocol: REALTIME_WS_PROTOCOL_V1,
            type: "error",
            code: "hello_required",
            message: "Send hello before subscribe_stats."
          });
          return;
        }

        for (const item of parsed.data.subscriptions) {
          sessionState.statsBySubscriptionId[item.subscriptionId] = item;
          await this.sendStats(socket, sessionState, item);
        }

        await this.persist(sessionState);
        return;
      }
      case "unsubscribe_stats": {
        for (const subscriptionId of parsed.data.subscriptionIds) {
          delete sessionState.statsBySubscriptionId[subscriptionId];
        }
        await this.persist(sessionState);
        return;
      }
      case "unsubscribe": {
        for (const subscriptionId of parsed.data.subscriptionIds) {
          const roomId = sessionState.roomsBySubscriptionId[subscriptionId];
          if (!roomId) continue;

          delete sessionState.roomsBySubscriptionId[subscriptionId];
          const remaining = (sessionState.subscriptionIdsByRoom[roomId] ?? []).filter((id) => id !== subscriptionId);
          if (remaining.length === 0) {
            delete sessionState.subscriptionIdsByRoom[roomId];
            await this.roomStub(sessionState.workspaceId, roomId).fetch(
              new Request("https://room.internal/internal/unsubscribe-session", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "x-workspace-id": sessionState.workspaceId,
                  "x-room-id": roomId
                },
                body: JSON.stringify({ sessionDoId: this.ctx.id.toString() })
              })
            );
          } else {
            sessionState.subscriptionIdsByRoom[roomId] = remaining;
          }
        }

        await this.persist(sessionState);
      }
    }
  }

  async webSocketClose(_socket: WebSocket): Promise<void> {
    const sessionState = await this.getState();
    await this.unsubscribeAll(sessionState);
    await this.ctx.storage.delete(SESSION_STATE_KEY);
    this.sessionState = createSessionState(sessionState.workspaceId);
  }

  private async handleWebSocket(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  private async handlePush(request: Request, sessionState: StoredSessionState): Promise<Response> {
    const payload = (await request.json()) as PushPayload;
    const subscriptionIds = sessionState.subscriptionIdsByRoom[payload.roomId] ?? [];
    for (const subscriptionId of subscriptionIds) {
      this.sendToAllSnapshot(subscriptionId, payload.roomId, payload.snapshot);
    }
    if (payload.roomId === "global" && Object.keys(sessionState.statsBySubscriptionId).length > 0) {
      await this.pushStatsUpdates(sessionState);
    }
    return Response.json({ ok: true });
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

  private sendToAllSnapshot(subscriptionId: string, roomId: string, snapshot: RoomSnapshot) {
    this.sendToAll(
      RealtimeSnapshotEnvelopeSchema.parse({
        type: "snapshot",
        subscriptionId,
        roomId,
        payload: snapshot
      })
    );
  }

  private async sendStats(socket: WebSocket, sessionState: StoredSessionState, subscription: RealtimeStatsSubscription) {
    const message = await this.buildStatsMessage(sessionState, subscription);
    this.send(socket, message);
  }

  private async pushStatsUpdates(sessionState: StoredSessionState) {
    const cache = new Map<string, unknown>();
    for (const subscription of Object.values(sessionState.statsBySubscriptionId)) {
      const message = await this.buildStatsMessage(sessionState, subscription, cache);
      this.sendToAll(message);
    }
  }

  private async buildStatsMessage(
    sessionState: StoredSessionState,
    subscription: RealtimeStatsSubscription,
    cache = new Map<string, unknown>()
  ) {
    try {
      const payload = await this.fetchStatsPayload(sessionState, subscription, cache);
      return RealtimeStatsEnvelopeSchema.parse({
        type: "stats",
        subscriptionId: subscription.subscriptionId,
        target: subscription.target,
        day: subscription.day,
        payload,
      });
    } catch (error) {
      return RealtimeStatsErrorEnvelopeSchema.parse({
        type: "stats_error",
        subscriptionId: subscription.subscriptionId,
        code: "stats_fetch_failed",
        message: error instanceof Error ? error.message : "stats_fetch_failed",
      });
    }
  }

  private async fetchStatsPayload(
    sessionState: StoredSessionState,
    subscription: RealtimeStatsSubscription,
    cache: Map<string, unknown>
  ) {
    const cacheKey = [
      subscription.target,
      subscription.day,
      subscription.deviceId ?? "",
      String(subscription.limit ?? ""),
    ].join("|");
    const cached = cache.get(cacheKey);
    if (cached !== undefined) return cached;

    const path = (() => {
      switch (subscription.target) {
        case "global":
          return `/internal/stats/global?day=${encodeURIComponent(subscription.day)}`;
        case "device":
          if (!subscription.deviceId) {
            throw new Error("device_id_required");
          }
          return `/internal/stats/device?day=${encodeURIComponent(subscription.day)}&deviceId=${encodeURIComponent(subscription.deviceId)}`;
        case "pages":
          return `/internal/stats/pages?day=${encodeURIComponent(subscription.day)}&limit=${encodeURIComponent(String(subscription.limit ?? 5))}`;
        case "rooms":
          return `/internal/stats/rooms?day=${encodeURIComponent(subscription.day)}&limit=${encodeURIComponent(String(subscription.limit ?? 5))}`;
      }
    })();

    const response = await this.roomStub(sessionState.workspaceId, "global").fetch(
      new Request(`https://room.internal${path}`, {
        headers: {
          "x-workspace-id": sessionState.workspaceId,
          "x-room-id": "global",
        },
      })
    );
    const payload = await response.json();
    cache.set(cacheKey, payload);
    return payload;
  }

  private send(socket: WebSocket, message: unknown) {
    socket.send(JSON.stringify(message));
  }

  private sendToAll(message: unknown) {
    const payload = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets()) {
      socket.send(payload);
    }
  }

  private roomStub(workspaceId: string, roomId: string) {
    const id = this.env.REALTIME_ROOM.idFromName(`${workspaceId}:${roomId}`);
    return this.env.REALTIME_ROOM.get(id);
  }

  private async getState(request?: Request): Promise<StoredSessionState> {
    if (this.sessionState) {
      return this.sessionState;
    }
    const loaded = await this.ctx.storage.get<StoredSessionState>(SESSION_STATE_KEY);
    const workspaceId = request
      ? new URL(request.url).searchParams.get("workspaceId") ?? this.env.WORKSPACE_ID
      : this.env.WORKSPACE_ID;
    this.sessionState = loaded
      ? {
          workspaceId: loaded.workspaceId ?? workspaceId,
          roomsBySubscriptionId: loaded.roomsBySubscriptionId ?? {},
          subscriptionIdsByRoom: loaded.subscriptionIdsByRoom ?? {},
          statsBySubscriptionId: loaded.statsBySubscriptionId ?? {},
          selectedProtocol: loaded.selectedProtocol ?? null,
        }
      : createSessionState(workspaceId);
    return this.sessionState;
  }

  private async persist(sessionState: StoredSessionState) {
    this.sessionState = sessionState;
    await this.ctx.storage.put(SESSION_STATE_KEY, sessionState);
  }

  private async unsubscribeAll(sessionState: StoredSessionState) {
    await Promise.all(
      Object.keys(sessionState.subscriptionIdsByRoom).map((roomId) =>
        this.roomStub(sessionState.workspaceId, roomId).fetch(
          new Request("https://room.internal/internal/unsubscribe-session", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-workspace-id": sessionState.workspaceId,
              "x-room-id": roomId
            },
            body: JSON.stringify({ sessionDoId: this.ctx.id.toString() })
          })
        )
      )
    );
  }
}

function createSessionState(workspaceId: string): StoredSessionState {
  return {
    workspaceId,
    roomsBySubscriptionId: {},
    subscriptionIdsByRoom: {},
    statsBySubscriptionId: {},
    selectedProtocol: null
  };
}

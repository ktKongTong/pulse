import { DurableObject } from "cloudflare:workers";
import {
  PresenceIngestAckSchema,
  type PresenceIngestRequest,
  REALTIME_STREAM_PROTOCOL_V1,
  type RoomSnapshot,
  type RoomStreamEnvelope,
  type WebEvent,
  type WebIngestAck,
  WebIngestAckSchema,
} from "@pulse/realtime-protocol";

import type { Env } from "./env";
import {
  applyPresenceIngest,
  applyWebEventToPageRoom,
  applyWebIngestToGlobal,
  applyWebLeaveToPageRoom,
  createRoomState,
  deviceStatsHistory,
  deviceStatsForDay,
  globalStatsHistory,
  globalStatsForDay,
  pageStatsHistory,
  normalizeRoomState,
  pageStatsForDay,
  roomStatsHistory,
  roomStatsForDay,
  type PageEventPayload,
  pruneState,
  snapshotFromState,
  type StoredRoomState,
} from "./lib/room-state";
import { noteBroadcast } from "./lib/stats-state";

interface PresenceIngestPayload {
  request: PresenceIngestRequest;
  ttlMs: number;
}

interface WebIngestPayload {
  request: import("@pulse/realtime-protocol").WebIngestRequest;
  ttlMs: number;
}

interface PageLeavePayload {
  sessionId: string;
  observedAt: string;
}

interface PageEventEnvelope extends PageEventPayload {
  ttlMs: number;
}

interface InternalWebAck extends WebIngestAck {
  pageTransitions: Array<{
    eventId: string;
    currentRoomId?: string;
    previousRoomId?: string;
  }>;
}

interface SessionSubscriberPayload {
  sessionDoId: string;
}

const STATE_KEY = "room-state";

export class RealtimeRoom extends DurableObject<Env> {
  private roomState?: StoredRoomState;
  private sseClients = new Set<ReadableStreamDefaultController<Uint8Array>>();

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const nowMs = Date.now();
    const roomState = await this.getState(request);
    if (pruneState(roomState, nowMs)) {
      await this.persist(roomState);
      await this.broadcastSnapshot(roomState);
    }

    switch (url.pathname) {
      case "/internal/ingest/device":
        return this.handlePresenceIngest(request, roomState, nowMs);
      case "/internal/ingest/web":
        return this.handleWebIngest(request, roomState, nowMs);
      case "/internal/page-event":
        return this.handlePageEvent(request, roomState, nowMs);
      case "/internal/page-leave":
        return this.handlePageLeave(request, roomState, nowMs);
      case "/internal/subscribe-session":
        return this.handleSubscribeSession(request, roomState);
      case "/internal/unsubscribe-session":
        return this.handleUnsubscribeSession(request, roomState);
      case "/internal/snapshot":
        return this.json(snapshotFromState(roomState));
      case "/internal/stats/global":
        return this.json(
          globalStatsForDay(
            roomState,
            new URL(request.url).searchParams.get("day") ??
              new Date().toISOString().slice(0, 10),
          ),
        );
      case "/internal/stats/pages":
        return this.json(
          pageStatsForDay(
            roomState,
            new URL(request.url).searchParams.get("day") ??
              new Date().toISOString().slice(0, 10),
            Number(new URL(request.url).searchParams.get("limit") ?? "20"),
          ),
        );
      case "/internal/stats/rooms":
        return this.json(
          roomStatsForDay(
            roomState,
            new URL(request.url).searchParams.get("day") ??
              new Date().toISOString().slice(0, 10),
            Number(new URL(request.url).searchParams.get("limit") ?? "20"),
          ),
        );
      case "/internal/stats/device":
        return this.json(
          deviceStatsForDay(
            roomState,
            new URL(request.url).searchParams.get("day") ??
              new Date().toISOString().slice(0, 10),
            new URL(request.url).searchParams.get("deviceId") ?? "",
          ),
        );
      case "/internal/stats/global/history":
        return this.json(
          globalStatsHistory(
            roomState,
            (new URL(request.url).searchParams.get("period") as
              | import("@pulse/realtime-protocol").StatsPeriod
              | null) ?? "day",
            Number(new URL(request.url).searchParams.get("limit") ?? "12"),
            new URL(request.url).searchParams.get("anchorDay") ??
              new Date().toISOString().slice(0, 10),
          ),
        );
      case "/internal/stats/pages/history":
        return this.json(
          pageStatsHistory(
            roomState,
            (new URL(request.url).searchParams.get("period") as
              | import("@pulse/realtime-protocol").StatsPeriod
              | null) ?? "day",
            Number(new URL(request.url).searchParams.get("limit") ?? "12"),
            new URL(request.url).searchParams.get("anchorDay") ??
              new Date().toISOString().slice(0, 10),
            Number(new URL(request.url).searchParams.get("itemLimit") ?? "10"),
          ),
        );
      case "/internal/stats/rooms/history":
        return this.json(
          roomStatsHistory(
            roomState,
            (new URL(request.url).searchParams.get("period") as
              | import("@pulse/realtime-protocol").StatsPeriod
              | null) ?? "day",
            Number(new URL(request.url).searchParams.get("limit") ?? "12"),
            new URL(request.url).searchParams.get("anchorDay") ??
              new Date().toISOString().slice(0, 10),
            Number(new URL(request.url).searchParams.get("itemLimit") ?? "10"),
          ),
        );
      case "/internal/stats/device/history":
        return this.json(
          deviceStatsHistory(
            roomState,
            (new URL(request.url).searchParams.get("period") as
              | import("@pulse/realtime-protocol").StatsPeriod
              | null) ?? "day",
            Number(new URL(request.url).searchParams.get("limit") ?? "12"),
            new URL(request.url).searchParams.get("anchorDay") ??
              new Date().toISOString().slice(0, 10),
            new URL(request.url).searchParams.get("deviceId") ?? "",
          ),
        );
      case "/internal/sse":
        return this.handleSse(roomState);
      case "/internal/ws":
        return this.handleWebSocket(request, roomState);
      default:
        return new Response("Not found", { status: 404 });
    }
  }

  async webSocketMessage(
    _ws: WebSocket,
    _message: string | ArrayBuffer,
  ): Promise<void> {
    // Stream is server-push only in v1.
  }

  async webSocketClose(_ws: WebSocket): Promise<void> {
    // No-op.
  }

  private async handlePresenceIngest(
    request: Request,
    roomState: StoredRoomState,
    nowMs: number,
  ): Promise<Response> {
    const payload = (await request.json()) as PresenceIngestPayload;
    const result = applyPresenceIngest(
      roomState,
      payload.request,
      payload.ttlMs,
      nowMs,
    );
    console.log(payload);
    console.log(JSON.stringify(payload.request["events"]));
    await this.persist(roomState);
    if (result.changed) {
      console.log("broadcast");
      await this.broadcastSnapshot(roomState);
    }

    const ack = PresenceIngestAckSchema.parse({
      workspaceId: payload.request.workspaceId,
      deviceId: payload.request.deviceId,
      acceptedSeqMax: result.acceptedSeqMax,
      dedupedEventIds: result.dedupedEventIds,
      rejected: result.rejected,
      workspaceRevision: roomState.revision,
    });

    return this.json(ack);
  }

  private async handleWebIngest(
    request: Request,
    roomState: StoredRoomState,
    nowMs: number,
  ): Promise<Response> {
    const payload = (await request.json()) as WebIngestPayload;
    const result = applyWebIngestToGlobal(
      roomState,
      payload.request,
      payload.ttlMs,
      nowMs,
    );
    await this.persist(roomState);
    if (result.changed) {
      await this.broadcastSnapshot(roomState);
    }

    const ack: InternalWebAck = {
      ...WebIngestAckSchema.parse({
        workspaceId: payload.request.workspaceId,
        siteId: payload.request.siteId,
        sessionId: payload.request.sessionId,
        acceptedSeqMax: result.acceptedSeqMax,
        dedupedEventIds: result.dedupedEventIds,
        rejected: result.rejected,
        workspaceRevision: roomState.revision,
      }),
      pageTransitions: result.pageTransitions,
    };

    return this.json(ack);
  }

  private async handlePageEvent(
    request: Request,
    roomState: StoredRoomState,
    nowMs: number,
  ): Promise<Response> {
    const payload = (await request.json()) as PageEventEnvelope;
    const changed = applyWebEventToPageRoom(
      roomState,
      payload,
      payload.ttlMs,
      nowMs,
    );
    if (changed) {
      await this.persist(roomState);
      await this.broadcastSnapshot(roomState);
    }

    return this.json(snapshotFromState(roomState));
  }

  private async handlePageLeave(
    request: Request,
    roomState: StoredRoomState,
    nowMs: number,
  ): Promise<Response> {
    const payload = (await request.json()) as PageLeavePayload;
    const changed = applyWebLeaveToPageRoom(
      roomState,
      payload,
      payload.observedAt,
      nowMs,
    );
    if (changed) {
      await this.persist(roomState);
      await this.broadcastSnapshot(roomState);
    }

    return this.json(snapshotFromState(roomState));
  }

  private async handleSubscribeSession(
    request: Request,
    roomState: StoredRoomState,
  ): Promise<Response> {
    const payload = (await request.json()) as SessionSubscriberPayload;
    if (!roomState.sessionSubscribers[payload.sessionDoId]) {
      roomState.sessionSubscribers[payload.sessionDoId] = true;
      await this.persist(roomState);
    }
    return this.json(snapshotFromState(roomState));
  }

  private async handleUnsubscribeSession(
    request: Request,
    roomState: StoredRoomState,
  ): Promise<Response> {
    const payload = (await request.json()) as SessionSubscriberPayload;
    if (roomState.sessionSubscribers[payload.sessionDoId]) {
      delete roomState.sessionSubscribers[payload.sessionDoId];
      await this.persist(roomState);
    }
    return this.json(snapshotFromState(roomState));
  }

  private async handleSse(roomState: StoredRoomState): Promise<Response> {
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.sseClients.add(controller);
        controller.enqueue(
          encodeSse(snapshotEnvelope(snapshotFromState(roomState))),
        );
      },
      cancel: () => {
        // handled below by removing on write failure too
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  }

  private async handleWebSocket(
    request: Request,
    roomState: StoredRoomState,
  ): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.send(JSON.stringify(snapshotEnvelope(snapshotFromState(roomState))));
    return new Response(null, { status: 101, webSocket: client });
  }

  private async broadcastSnapshot(roomState: StoredRoomState): Promise<void> {
    const snapshot = snapshotFromState(roomState);
    const envelope = snapshotEnvelope(snapshot);
    const payload = JSON.stringify(envelope);
    noteBroadcast(
      roomState,
      Date.now(),
      this.ctx.getWebSockets().length,
      this.sseClients.size,
    );

    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(payload);
      } catch {
        socket.close(1011, "broadcast_failed");
      }
    }

    const encoded = encodeSse(envelope);
    for (const controller of this.sseClients) {
      try {
        controller.enqueue(encoded);
      } catch {
        this.sseClients.delete(controller);
      }
    }

    await Promise.all(
      Object.keys(roomState.sessionSubscribers).map(async (sessionDoId) => {
        try {
          await this.sessionStub(sessionDoId).fetch(
            new Request("https://session.internal/internal/push", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                roomId: roomState.roomId,
                snapshot,
              }),
            }),
          );
        } catch {
          delete roomState.sessionSubscribers[sessionDoId];
        }
      }),
    );
  }

  private async getState(request: Request): Promise<StoredRoomState> {
    if (this.roomState) {
      return this.roomState;
    }
    const loaded = await this.ctx.storage.get<StoredRoomState>(STATE_KEY);
    const workspaceId =
      request.headers.get("x-workspace-id") ?? this.env.WORKSPACE_ID;
    const roomId = request.headers.get("x-room-id") ?? "unknown";
    this.roomState = loaded
      ? normalizeRoomState(loaded)
      : createRoomState(workspaceId, roomId);
    return this.roomState;
  }

  private async persist(roomState: StoredRoomState): Promise<void> {
    this.roomState = roomState;
    await this.ctx.storage.put(STATE_KEY, roomState);
  }

  private json(value: unknown, init?: ResponseInit): Response {
    return Response.json(value, init);
  }

  private sessionStub(sessionDoId: string) {
    const id = this.env.REALTIME_SESSION.idFromString(sessionDoId);
    return this.env.REALTIME_SESSION.get(id);
  }
}

function snapshotEnvelope(snapshot: RoomSnapshot): RoomStreamEnvelope {
  return {
    protocol: REALTIME_STREAM_PROTOCOL_V1,
    kind: "snapshot.updated",
    workspaceId: snapshot.workspaceId,
    roomId: snapshot.roomId,
    revision: snapshot.revision,
    payload: snapshot,
  };
}

function encodeSse(envelope: RoomStreamEnvelope): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(envelope)}\n\n`);
}

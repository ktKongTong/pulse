import { Hono } from "hono";
import {
  INTERACTION_PROTOCOL_V1,
  InteractionRequestSchema,
  InteractionStateSchema,
  type InteractionState,
  type PresenceIngestAck,
  PresenceIngestRequestSchema,
  RealtimeMetaResponseSchema,
  StatsPeriodSchema,
  type WebIngestAck,
  WebIngestRequestSchema
} from "@pulse/realtime-protocol";

import type { Env } from "./env";
import { deviceSessionTtlMs, isAllowedOriginForRequest, webSessionTtlMs } from "./env";
import { pageRoomId } from "./lib/url";
import { InteractionHub } from "./interaction-hub-do";
import { InteractionInbox } from "./interaction-inbox-do";
import { RealtimeRoom } from "./room-do";
import { RealtimeSession } from "./session-do";

interface InternalWebAck extends WebIngestAck {
  pageTransitions: Array<{
    eventId: string;
    currentRoomId?: string;
    previousRoomId?: string;
  }>;
}

const app = new Hono<{ Bindings: Env }>()

app.use("*", async (c, next) => {
  const origin = c.req.header("Origin") ?? null;
  await next();

  c.header("Vary", "Origin");
  if (isAllowedOriginForRequest(c.env, origin, c.req.url)) {
    c.header("Access-Control-Allow-Origin", origin!);
    c.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    c.header("Access-Control-Allow-Headers", "Content-Type,Authorization");
  }
});

app.options("*", (c) => {
  const origin = c.req.header("Origin") ?? null;
  if (!isAllowedOriginForRequest(c.env, origin, c.req.url)) {
    return c.body(null, 403);
  }

  c.header("Access-Control-Allow-Origin", origin!);
  c.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  c.header("Access-Control-Allow-Headers", "Content-Type,Authorization");
  c.header("Access-Control-Max-Age", "86400");
  c.header("Vary", "Origin");
  return c.body(null, 204);
});

app.get("/", (c) =>
  c.json({
    name: "pulse-realtime-worker",
    protocol: ["presence.v2", "web.v1", "realtime.v1-stream"],
    endpoints: [
      "POST /api/v2/presence/ingest",
      "GET /api/v2/presence/stream/ws",
      "GET /api/v2/presence/stream/sse",
      "POST /api/v1/web/ingest",
      "GET /api/v1/stats/global",
      "GET /api/v1/stats/global/history",
      "GET /api/v1/stats/pages",
      "GET /api/v1/stats/pages/history",
      "GET /api/v1/stats/rooms",
      "GET /api/v1/stats/rooms/history",
      "GET /api/v1/stats/device/:deviceId",
      "GET /api/v1/stats/device/:deviceId/history",
      "POST /api/v1/interaction/requests",
      "GET /api/v1/interaction/requests/:requestId",
      "GET /api/v1/interaction/stream/sse",
      "GET /api/v1/device-interactions/ws",
      "GET /api/v1/realtime/ws",
      "GET /api/v1/realtime/sse",
      "GET /api/v1/realtime/snapshot"
    ]
  })
);

app.get("/v1/stats/global", async (c) => {
  const workspaceId = c.req.query("workspaceId") ?? c.env.WORKSPACE_ID;
  const day = c.req.query("day") ?? new Date().toISOString().slice(0, 10);
  if (workspaceId !== c.env.WORKSPACE_ID) {
    return c.json({ error: "workspace_mismatch" }, 403);
  }
  return fetchRoom(c.env, workspaceId, "global", `/internal/stats/global?day=${encodeURIComponent(day)}`);
});

app.get("/v1/stats/pages", async (c) => {
  const workspaceId = c.req.query("workspaceId") ?? c.env.WORKSPACE_ID;
  const day = c.req.query("day") ?? new Date().toISOString().slice(0, 10);
  const limit = c.req.query("limit") ?? "20";
  if (workspaceId !== c.env.WORKSPACE_ID) {
    return c.json({ error: "workspace_mismatch" }, 403);
  }
  return fetchRoom(c.env, workspaceId, "global", `/internal/stats/pages?day=${encodeURIComponent(day)}&limit=${encodeURIComponent(limit)}`);
});

app.get("/v1/stats/rooms", async (c) => {
  const workspaceId = c.req.query("workspaceId") ?? c.env.WORKSPACE_ID;
  const day = c.req.query("day") ?? new Date().toISOString().slice(0, 10);
  const limit = c.req.query("limit") ?? "20";
  if (workspaceId !== c.env.WORKSPACE_ID) {
    return c.json({ error: "workspace_mismatch" }, 403);
  }
  return fetchRoom(c.env, workspaceId, "global", `/internal/stats/rooms?day=${encodeURIComponent(day)}&limit=${encodeURIComponent(limit)}`);
});

app.get("/v1/stats/device/:deviceId", async (c) => {
  const workspaceId = c.req.query("workspaceId") ?? c.env.WORKSPACE_ID;
  const day = c.req.query("day") ?? new Date().toISOString().slice(0, 10);
  const deviceId = c.req.param("deviceId");
  if (workspaceId !== c.env.WORKSPACE_ID) {
    return c.json({ error: "workspace_mismatch" }, 403);
  }
  return fetchRoom(c.env, workspaceId, "global", `/internal/stats/device?day=${encodeURIComponent(day)}&deviceId=${encodeURIComponent(deviceId)}`);
});

app.get("/v1/stats/global/history", async (c) => {
  const workspaceId = c.req.query("workspaceId") ?? c.env.WORKSPACE_ID;
  const period = StatsPeriodSchema.parse(c.req.query("period") ?? "day");
  const limit = c.req.query("limit") ?? (period === "day" ? "90" : period === "week" ? "12" : period === "month" ? "12" : "5");
  const anchorDay = c.req.query("anchorDay") ?? new Date().toISOString().slice(0, 10);
  if (workspaceId !== c.env.WORKSPACE_ID) return c.json({ error: "workspace_mismatch" }, 403);
  return fetchRoom(c.env, workspaceId, "global", `/internal/stats/global/history?period=${encodeURIComponent(period)}&limit=${encodeURIComponent(limit)}&anchorDay=${encodeURIComponent(anchorDay)}`);
});

app.get("/v1/stats/pages/history", async (c) => {
  const workspaceId = c.req.query("workspaceId") ?? c.env.WORKSPACE_ID;
  const period = StatsPeriodSchema.parse(c.req.query("period") ?? "day");
  const limit = c.req.query("limit") ?? (period === "day" ? "90" : period === "week" ? "12" : period === "month" ? "12" : "5");
  const itemLimit = c.req.query("itemLimit") ?? "10";
  const anchorDay = c.req.query("anchorDay") ?? new Date().toISOString().slice(0, 10);
  if (workspaceId !== c.env.WORKSPACE_ID) return c.json({ error: "workspace_mismatch" }, 403);
  return fetchRoom(c.env, workspaceId, "global", `/internal/stats/pages/history?period=${encodeURIComponent(period)}&limit=${encodeURIComponent(limit)}&itemLimit=${encodeURIComponent(itemLimit)}&anchorDay=${encodeURIComponent(anchorDay)}`);
});

app.get("/v1/stats/rooms/history", async (c) => {
  const workspaceId = c.req.query("workspaceId") ?? c.env.WORKSPACE_ID;
  const period = StatsPeriodSchema.parse(c.req.query("period") ?? "day");
  const limit = c.req.query("limit") ?? (period === "day" ? "90" : period === "week" ? "12" : period === "month" ? "12" : "5");
  const itemLimit = c.req.query("itemLimit") ?? "10";
  const anchorDay = c.req.query("anchorDay") ?? new Date().toISOString().slice(0, 10);
  if (workspaceId !== c.env.WORKSPACE_ID) return c.json({ error: "workspace_mismatch" }, 403);
  return fetchRoom(c.env, workspaceId, "global", `/internal/stats/rooms/history?period=${encodeURIComponent(period)}&limit=${encodeURIComponent(limit)}&itemLimit=${encodeURIComponent(itemLimit)}&anchorDay=${encodeURIComponent(anchorDay)}`);
});

app.get("/v1/stats/device/:deviceId/history", async (c) => {
  const workspaceId = c.req.query("workspaceId") ?? c.env.WORKSPACE_ID;
  const period = StatsPeriodSchema.parse(c.req.query("period") ?? "day");
  const limit = c.req.query("limit") ?? (period === "day" ? "90" : period === "week" ? "12" : period === "month" ? "12" : "5");
  const anchorDay = c.req.query("anchorDay") ?? new Date().toISOString().slice(0, 10);
  const deviceId = c.req.param("deviceId");
  if (workspaceId !== c.env.WORKSPACE_ID) return c.json({ error: "workspace_mismatch" }, 403);
  return fetchRoom(c.env, workspaceId, "global", `/internal/stats/device/history?period=${encodeURIComponent(period)}&limit=${encodeURIComponent(limit)}&anchorDay=${encodeURIComponent(anchorDay)}&deviceId=${encodeURIComponent(deviceId)}`);
});

app.get("/v1/meta", (c) =>
  c.json(
    RealtimeMetaResponseSchema.parse({
      serverVersion: "2026.04.09",
      ingestProtocols: {
        presence: ["presence.v2"],
        web: ["web.v1"]
      },
      streamProtocols: ["realtime.ws.v1"],
      capabilities: {
        presence: true,
        multiRoom: true,
        chat: false,
        richMedia: true,
        interaction: true,
        statsPush: true
      },
      interactionProtocols: ["interaction.v1", "interaction.ws.v1"],
      supportedInteractionCommands: ["media.recommend.track"]
    })
  )
);

app.post("/v2/presence/ingest", async (c) => {
  const payload = PresenceIngestRequestSchema.parse(await c.req.json());
  if (payload.workspaceId !== c.env.WORKSPACE_ID) {
    return c.json({ error: "workspace_mismatch" }, 403);
  }

  const ack = await fetchRoomJson<PresenceIngestAck>(c.env, payload.workspaceId, "global", "/internal/ingest/device", {
    request: payload,
    ttlMs: deviceSessionTtlMs(c.env)
  });

  return c.json(ack);
});

app.post("/v1/web/ingest", async (c) => {
  const origin = c.req.header("Origin") ?? null;
  if (!isAllowedOriginForRequest(c.env, origin, c.req.url)) {
    return c.json({ error: "origin_not_allowed" }, 403);
  }

  const payload = WebIngestRequestSchema.parse(await c.req.json());
  if (payload.workspaceId !== c.env.WORKSPACE_ID || payload.siteId !== c.env.SITE_ID) {
    return c.json({ error: "workspace_or_site_mismatch" }, 403);
  }

  const ttlMs = webSessionTtlMs(c.env);
  const ack = await fetchRoomJson<InternalWebAck>(c.env, payload.workspaceId, "global", "/internal/ingest/web", {
    request: payload,
    ttlMs
  });

  for (const transition of ack.pageTransitions) {
    const event = payload.events.find((item) => item.eventId === transition.eventId);
    if (!event) continue;

    if (transition.previousRoomId && transition.previousRoomId !== transition.currentRoomId) {
      await fetchRoomJson(
        c.env,
        payload.workspaceId,
        transition.previousRoomId,
        "/internal/page-leave",
        {
          sessionId: payload.sessionId,
          observedAt: event.observedAt
        }
      );
    }

    if (transition.currentRoomId) {
      await fetchRoomJson(
        c.env,
        payload.workspaceId,
        transition.currentRoomId,
        "/internal/page-event",
        {
          workspaceId: payload.workspaceId,
          siteId: payload.siteId,
          sessionId: payload.sessionId,
          userId: payload.userId,
          event,
          ttlMs
        }
      );
    }
  }

  return c.json(ack);
});

app.post("/v1/interaction/requests", async (c) => {
  const payload = InteractionRequestSchema.parse(await c.req.json());
  if (payload.workspaceId !== c.env.WORKSPACE_ID) {
    return c.json({ error: "workspace_mismatch" }, 403);
  }
  const isSupportedCommand =
    (payload.command.provider === "spotify" && payload.command.uri.startsWith("spotify:track:")) ||
    payload.command.provider === "apple-music";
  if (!isSupportedCommand) {
    return c.json({ error: "unsupported_command" }, 400);
  }

  const targetDevice = await resolveActiveDevice(c.env, payload.workspaceId, payload.command.provider);
  if (!targetDevice) {
    const rejected = InteractionStateSchema.parse({
      protocol: INTERACTION_PROTOCOL_V1,
      requestId: payload.requestId,
      workspaceId: payload.workspaceId,
      status: "rejected",
      issuedAt: payload.issuedAt,
      updatedAt: new Date().toISOString(),
      actor: payload.actor,
      command: payload.command,
      constraints: payload.constraints,
      error: {
        code: "no_target_device",
        message: "No active compatible PulseBar device is available."
      }
    });
    await updateInteractionState(c.env, payload.workspaceId, rejected);
    return c.json(rejected, 202);
  }

  const queued = InteractionStateSchema.parse({
    protocol: INTERACTION_PROTOCOL_V1,
    requestId: payload.requestId,
    workspaceId: payload.workspaceId,
    targetDeviceId: targetDevice.deviceId,
    status: "queued",
    issuedAt: payload.issuedAt,
    updatedAt: new Date().toISOString(),
    actor: payload.actor,
    command: payload.command,
    constraints: payload.constraints
  });

  await updateInteractionState(c.env, payload.workspaceId, queued);
  const delivered = InteractionStateSchema.parse({
    ...queued,
    status: "delivered",
    updatedAt: new Date().toISOString()
  });
  await updateInteractionState(c.env, payload.workspaceId, delivered);
  await interactionInboxStub(c.env, payload.workspaceId, targetDevice.deviceId).fetch(
    new Request("https://interaction.internal/internal/enqueue", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-workspace-id": payload.workspaceId,
        "x-device-id": targetDevice.deviceId
      },
      body: JSON.stringify(delivered)
    })
  );

  return c.json(delivered, 202);
});

app.get("/v1/interaction/requests/:requestId", async (c) => {
  const requestId = c.req.param("requestId");
  const response = await interactionHubStub(c.env, c.env.WORKSPACE_ID).fetch(
    new Request(`https://interaction.internal/internal/get-request?requestId=${encodeURIComponent(requestId)}`, {
      headers: {
        "x-workspace-id": c.env.WORKSPACE_ID
      }
    })
  );
  return response;
});

app.get("/v1/interaction/stream/sse", async (c) => {
  return interactionHubStub(c.env, c.env.WORKSPACE_ID).fetch(
    new Request("https://interaction.internal/internal/stream", {
      headers: {
        "x-workspace-id": c.env.WORKSPACE_ID
      }
    })
  );
});

app.get("/v1/device-interactions/ws", async (c) => {
  const workspaceId = c.req.query("workspaceId");
  const deviceId = c.req.query("deviceId");
  if (!workspaceId || !deviceId) {
    return c.json({ error: "workspaceId_and_deviceId_required" }, 400);
  }
  if (workspaceId !== c.env.WORKSPACE_ID) {
    return c.json({ error: "workspace_mismatch" }, 403);
  }
  return interactionInboxStub(c.env, workspaceId, deviceId).fetch(
    new Request(c.req.raw, {
      headers: new Headers(c.req.raw.headers)
    })
  );
});

app.get("/v1/realtime/snapshot", async (c) => {
  const workspaceId = c.req.query("workspaceId");
  const roomId = c.req.query("roomId");

  if (!workspaceId || !roomId) {
    return c.json({ error: "workspaceId_and_roomId_required" }, 400);
  }
  if (workspaceId !== c.env.WORKSPACE_ID) {
    return c.json({ error: "workspace_mismatch" }, 403);
  }
  if (!isAllowedRoomId(roomId)) {
    return c.json({ error: "invalid_room_id" }, 400);
  }

  const snapshot = await fetchRoom(c.env, workspaceId, roomId, "/internal/snapshot");
  return snapshot;
});

app.get("/v1/realtime/sse", async (c) => {
  const workspaceId = c.req.query("workspaceId");
  const roomId = c.req.query("roomId");
  if (!workspaceId || !roomId) {
    return c.json({ error: "workspaceId_and_roomId_required" }, 400);
  }
  if (workspaceId !== c.env.WORKSPACE_ID) {
    return c.json({ error: "workspace_mismatch" }, 403);
  }
  if (!isAllowedRoomId(roomId)) {
    return c.json({ error: "invalid_room_id" }, 400);
  }

  return fetchRoom(c.env, workspaceId, roomId, "/internal/sse");
});

app.get("/v1/realtime/ws", async (c) => {
  const workspaceId = c.req.query("workspaceId");
  const roomId = c.req.query("roomId");
  if (!workspaceId) {
    return c.json({ error: "workspaceId_required" }, 400);
  }
  if (workspaceId !== c.env.WORKSPACE_ID) {
    return c.json({ error: "workspace_mismatch" }, 403);
  }
  if (roomId) {
    if (!isAllowedRoomId(roomId)) {
      return c.json({ error: "invalid_room_id" }, 400);
    }
    return fetchRoom(c.env, workspaceId, roomId, "/internal/ws", c.req.raw);
  }

  const id = c.env.REALTIME_SESSION.newUniqueId();
  const stub = c.env.REALTIME_SESSION.get(id);
  return stub.fetch(c.req.raw);
});

app.get("/v2/presence/stream/sse", async (c) => {
  const workspaceId = c.req.query("workspaceId") ?? c.env.WORKSPACE_ID;
  return fetchRoom(c.env, workspaceId, "global", "/internal/sse");
});

app.get("/v2/presence/stream/ws", async (c) => {
  const workspaceId = c.req.query("workspaceId") ?? c.env.WORKSPACE_ID;
  return fetchRoom(c.env, workspaceId, "global", "/internal/ws", c.req.raw);
});

app.notFound((c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
export { RealtimeRoom, RealtimeSession, InteractionHub, InteractionInbox };

function roomStub(env: Env, workspaceId: string, roomId: string) {
  const id = env.REALTIME_ROOM.idFromName(`${workspaceId}:${roomId}`);
  return env.REALTIME_ROOM.get(id);
}

function interactionHubStub(env: Env, workspaceId: string) {
  const id = env.INTERACTION_HUB.idFromName(workspaceId);
  return env.INTERACTION_HUB.get(id);
}

function interactionInboxStub(env: Env, workspaceId: string, deviceId: string) {
  const id = env.INTERACTION_INBOX.idFromName(`${workspaceId}:${deviceId}`);
  return env.INTERACTION_INBOX.get(id);
}

async function fetchRoomJson<T>(
  env: Env,
  workspaceId: string,
  roomId: string,
  path: string,
  body: unknown
): Promise<T> {
  const response = await fetchRoom(
    env,
    workspaceId,
    roomId,
    path,
    new Request(`https://room.internal${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    })
  );
  return (await response.json()) as T;
}

function fetchRoom(
  env: Env,
  workspaceId: string,
  roomId: string,
  path: string,
  request?: Request
): Promise<Response> {
  const url = new URL(`https://room.internal${path}`);
  const headers = new Headers(request?.headers);
  headers.set("x-workspace-id", workspaceId);
  headers.set("x-room-id", roomId);
  const target = request
    ? new Request(url.toString(), {
        method: request.method,
        headers,
        body: request.body,
        redirect: request.redirect
      })
    : new Request(url.toString(), { headers });
  return roomStub(env, workspaceId, roomId).fetch(target);
}

function isAllowedRoomId(roomId: string): boolean {
  return roomId === "global" || roomId.startsWith("page:https://") || roomId.startsWith("page:http://");
}

async function resolveActiveDevice(env: Env, workspaceId: string, provider: "spotify" | "apple-music"): Promise<{ deviceId: string } | null> {
  const roomResponse = await fetchRoom(env, workspaceId, "global", "/internal/snapshot");
  const roomSnapshot = await roomResponse.json() as { activeReaders: Array<{ source: string; presenceState: string; updatedAt: string; device?: { deviceId?: string } }> };
  const devicesResponse = await interactionHubStub(env, workspaceId).fetch(
    new Request("https://interaction.internal/internal/list-devices", {
      headers: {
        "x-workspace-id": workspaceId
      }
    })
  );
  const registeredDevices = await devicesResponse.json() as Array<{ deviceId: string; connected: boolean; capabilities: { mediaRecommendTrack: boolean; providersSpotify: boolean; providersAppleMusic: boolean } }>;

  const supportedIds = new Set(
    registeredDevices
      .filter((device) => {
        if (!device.connected || !device.capabilities.mediaRecommendTrack) return false;
        return provider === "spotify" ? device.capabilities.providersSpotify : device.capabilities.providersAppleMusic;
      })
      .map((device) => device.deviceId)
  );

  return roomSnapshot.activeReaders
    .filter((reader) => reader.source === "device" && reader.presenceState === "active")
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .map((reader) => reader.device?.deviceId)
    .filter((deviceId): deviceId is string => Boolean(deviceId && supportedIds.has(deviceId)))
    .map((deviceId) => ({ deviceId }))
    .at(0) ?? null;
}

async function updateInteractionState(env: Env, workspaceId: string, state: InteractionState) {
  await interactionHubStub(env, workspaceId).fetch(
    new Request("https://interaction.internal/internal/update-request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-workspace-id": workspaceId
      },
      body: JSON.stringify(state)
    })
  );
}

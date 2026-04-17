import { Hono } from "hono";
import {
  INTERACTION_PROTOCOL_V1,
  InteractionRequestSchema,
  InteractionStateSchema,
  type InteractionState,
  PresenceIngestRequestSchema,
  RealtimeMetaResponseSchema,
  StatsPeriodSchema,
  WebIngestRequestSchema
} from "@pulse/realtime-protocol";

import { deviceSessionTtlMs, isAllowedOriginForRequest, webSessionTtlMs } from "./env";
import { InteractionHub } from "./interaction-hub-do";
import { InteractionInbox } from "./interaction-inbox-do";
import { RealtimeRoom } from "./room-do";
import { RealtimeSession } from "./session-do";
import { DeviceDO } from "./device-do";

type Env = Cloudflare.Env;

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
  })
);

app.get("/v1/stats/global", async (c) => {
  const workspaceId = c.req.query("workspaceId") ?? c.env.WORKSPACE_ID;
  const day = c.req.query("day") ?? new Date().toISOString().slice(0, 10);
  if (workspaceId !== c.env.WORKSPACE_ID) return c.json({ error: "workspace_mismatch" }, 403);

  const room = roomStub(c.env, workspaceId, "global");
  return c.json(await room.getGlobalStats(day));
});

app.get("/v1/stats/pages", async (c) => {
  const workspaceId = c.req.query("workspaceId") ?? c.env.WORKSPACE_ID;
  const day = c.req.query("day") ?? new Date().toISOString().slice(0, 10);
  const limit = c.req.query("limit") ?? "20";
  if (workspaceId !== c.env.WORKSPACE_ID) return c.json({ error: "workspace_mismatch" }, 403);

  const room = roomStub(c.env, workspaceId, "global");
  return c.json(await room.getPageStats(day, parseInt(limit)));
});

app.get("/v1/stats/rooms", async (c) => {
  const workspaceId = c.req.query("workspaceId") ?? c.env.WORKSPACE_ID;
  const day = c.req.query("day") ?? new Date().toISOString().slice(0, 10);
  const limit = c.req.query("limit") ?? "20";
  if (workspaceId !== c.env.WORKSPACE_ID) return c.json({ error: "workspace_mismatch" }, 403);

  const room = roomStub(c.env, workspaceId, "global");
  return c.json(await room.getRoomStats(day, parseInt(limit)));
});

app.get("/v1/stats/device/:deviceId", async (c) => {
  const workspaceId = c.req.query("workspaceId") ?? c.env.WORKSPACE_ID;
  const day = c.req.query("day") ?? new Date().toISOString().slice(0, 10);
  const deviceId = c.req.param("deviceId");
  if (workspaceId !== c.env.WORKSPACE_ID) return c.json({ error: "workspace_mismatch" }, 403);

  const room = roomStub(c.env, workspaceId, "global");
  return c.json(await room.getDeviceStats(day, deviceId));
});

app.get("/v1/meta", (c) =>
  c.json(
    RealtimeMetaResponseSchema.parse({
      serverVersion: "2026.04.14",
      ingestProtocols: {
        presence: ["presence.v2"],
        web: ["web.v1"]
      },
      streamProtocols: ["realtime.ws.v1"],
      capabilities: {
        presence: true,
        multiRoom: true,
        chat: true,
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

  const device = deviceStub(c.env, payload.workspaceId, payload.deviceId);
  const ack = await device.handlePresenceIngest(payload, deviceSessionTtlMs(c.env));
  console.log("presence", payload)
  return c.json(ack);
});

// Added for HISTORY_INGEST support
app.post("/v2/history/ingest", async (c) => {
  const payload = await c.req.json();
  if (payload.workspaceId !== c.env.WORKSPACE_ID) {
    return c.json({ error: "workspace_mismatch" }, 403);
  }

  const device = deviceStub(c.env, payload.workspaceId, payload.deviceId);
  const ack = await device.handleHistoryIngest(payload);

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

  // Always write to global room (site-wide presence)
  const globalRoom = roomStub(c.env, payload.workspaceId, "global");
  const ack = await globalRoom.handleWebIngest(payload, "global", ttlMs);

  // Additionally fan out to page-specific room if we can extract a canonical URL
  const lastEvent = payload.events[payload.events.length - 1];
  if (lastEvent && lastEvent.kind !== "session_end" && lastEvent.page?.url) {
    const canonicalUrl = lastEvent.page.canonicalUrl ?? lastEvent.page.url;
    const pageRoomId = `page:${canonicalUrl}`;
    const pageRoom = roomStub(c.env, payload.workspaceId, pageRoomId);
    // Fire-and-forget: don't block the ack response on the page room write
    c.executionCtx.waitUntil(pageRoom.handleWebIngest(payload, pageRoomId, ttlMs).catch(() => { }));
  }

  return c.json(ack);
});

// WEBSOCKETS via Hibernation

app.get("/v1/realtime/snapshot", async (c) => {
  const workspaceId = c.req.query("workspaceId");
  const roomId = c.req.query("roomId");

  if (!workspaceId || !roomId || workspaceId !== c.env.WORKSPACE_ID) {
    return c.json({ error: "invalid_params" }, 400);
  }

  const room = roomStub(c.env, workspaceId, roomId);
  return c.json(await room.getSnapshot(workspaceId, roomId));
});

app.get("/v1/realtime/ws", async (c) => {
  const workspaceId = c.req.query("workspaceId");
  const roomId = c.req.query("roomId");
  if (!workspaceId || workspaceId !== c.env.WORKSPACE_ID) {
    return c.json({ error: "workspace_mismatch" }, 403);
  }

  if (roomId) {
    return c.json({ error: "roomId_not_supported_on_ws_route_directly" }, 400);
  }

  const id = c.env.REALTIME_SESSION.newUniqueId();
  const stub = c.env.REALTIME_SESSION.get(id);
  console.log("[realtime.ws.route] upgrade", {
    workspaceId,
    sessionDoId: id.toString(),
    url: c.req.url,
    userAgent: c.req.header("User-Agent") ?? null,
  });

  // Forward original upgrade request to DO
  return stub.fetch(c.req.raw);
});

app.onError((err, c) => {
  console.error("Hono Error:", err);
  return c.json({
    error: "internal_server_error",
    message: err.message,
    stack: err.stack
  }, 500);
});

// Legacy macOS device-interactions endpoint — disabled, returns 410 Gone
app.all("/v1/device-interactions/*", (c) => c.json({ error: "endpoint_disabled" }, 410));

app.notFound((c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
export { RealtimeRoom, RealtimeSession, InteractionHub, InteractionInbox, DeviceDO };

function roomStub(env: Env, workspaceId: string, roomId: string): DurableObjectStub<RealtimeRoom> {
  const id = env.REALTIME_ROOM.idFromName(`${workspaceId}:${roomId}`);
  return env.REALTIME_ROOM.get(id) as unknown as DurableObjectStub<RealtimeRoom>;
}

function deviceStub(env: Env, workspaceId: string, deviceId: string): DurableObjectStub<DeviceDO> {
  const id = env.DEVICE_DO.idFromName(`${workspaceId}:${deviceId}`);
  return env.DEVICE_DO.get(id) as unknown as DurableObjectStub<DeviceDO>;
}

// Stubs for non-refactored objects
function interactionHubStub(env: Env, workspaceId: string) {
  const id = env.INTERACTION_HUB.idFromName(workspaceId);
  return env.INTERACTION_HUB.get(id);
}

function interactionInboxStub(env: Env, workspaceId: string, deviceId: string) {
  const id = env.INTERACTION_INBOX.idFromName(`${workspaceId}:${deviceId}`);
  return env.INTERACTION_INBOX.get(id);
}

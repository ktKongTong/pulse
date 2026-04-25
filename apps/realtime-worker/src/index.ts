import { Hono } from "hono";
import {
  INTERACTION_PROTOCOL_V1,
  InteractionRequestSchema,
  InteractionStateSchema,
  type InteractionState,
  PresenceIngestRequestSchema,
  REALTIME_WS_PROTOCOL_V2,
  RealtimeMetaResponseSchema,
  StatsPeriodSchema,
  WebIngestRequestSchema
} from "@pulse/realtime-protocol";

import {
  deviceSessionTtlMs,
  isAllowedOriginForRequest,
  requiredDeviceApiKey,
  webSessionTtlMs,
  type Env,
} from "./env";
import type { DeviceRpc, RoomRpc } from "./durable-stubs";
import { InteractionHub } from "./interaction-hub-do";
import { InteractionInbox } from "./interaction-inbox-do";
import { createWorkerLogger } from "./logger";
import { ChatRoom, GlobalStatusRoom, PageStatusRoom } from "./room-do";
import { realtimeRoomId, roomNamespace, roomStub } from "./room-stub";
import { DeviceDO } from "./device-do";

const app = new Hono<{ Bindings: Env }>()

app.use("*", async (c, next) => {
  const origin = c.req.header("Origin") ?? null;
  await next();

  c.header("Vary", "Origin");
  if (isAllowedOriginForRequest(c.env, origin, c.req.url)) {
    c.header("Access-Control-Allow-Origin", origin!);
    c.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    c.header("Access-Control-Allow-Headers", "Content-Type,Authorization,X-PulseBar-Protocol");
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
    protocol: ["presence.v2", "web.v1", "realtime.v1-stream", REALTIME_WS_PROTOCOL_V2],
  })
);

app.get("/v1/site/history", async (c) => {
  const workspaceId = c.req.query("workspaceId") ?? c.env.WORKSPACE_ID;
  const period = StatsPeriodSchema.parse(c.req.query("period") ?? "day");
  const limit = Number(c.req.query("limit") ?? (period === "day" ? "30" : period === "month" ? "12" : "5"));
  const anchorDay = c.req.query("anchorDay") ?? new Date().toISOString().slice(0, 10);
  if (workspaceId !== c.env.WORKSPACE_ID) return c.json({ error: "workspace_mismatch" }, 403);

  const room = roomStub(c.env, workspaceId, "global");
  return c.json(await room.getSiteHistory(period, limit, anchorDay));
});

app.get("/v1/site/lifetime", async (c) => {
  const workspaceId = c.req.query("workspaceId") ?? c.env.WORKSPACE_ID;
  if (workspaceId !== c.env.WORKSPACE_ID) return c.json({ error: "workspace_mismatch" }, 403);

  const room = roomStub(c.env, workspaceId, "global");
  return c.json(await room.getSiteLifetime());
});

app.get("/v1/content/history", async (c) => {
  const workspaceId = c.req.query("workspaceId") ?? c.env.WORKSPACE_ID;
  const canonicalUrl = c.req.query("canonicalUrl");
  const period = StatsPeriodSchema.parse(c.req.query("period") ?? "day");
  const limit = Number(c.req.query("limit") ?? (period === "day" ? "30" : period === "month" ? "12" : "5"));
  const anchorDay = c.req.query("anchorDay") ?? new Date().toISOString().slice(0, 10);
  if (!canonicalUrl || workspaceId !== c.env.WORKSPACE_ID) return c.json({ error: "invalid_params" }, 400);

  const room = roomStub(c.env, workspaceId, "global");
  return c.json(await room.getContentHistory(canonicalUrl, period, limit, anchorDay));
});

app.get("/v1/content/lifetime", async (c) => {
  const workspaceId = c.req.query("workspaceId") ?? c.env.WORKSPACE_ID;
  const canonicalUrl = c.req.query("canonicalUrl");
  if (!canonicalUrl || workspaceId !== c.env.WORKSPACE_ID) return c.json({ error: "invalid_params" }, 400);

  const room = roomStub(c.env, workspaceId, "global");
  return c.json(await room.getContentLifetime(canonicalUrl));
});

app.get("/v1/owner/history", async (c) => {
  const workspaceId = c.req.query("workspaceId") ?? c.env.WORKSPACE_ID;
  const period = StatsPeriodSchema.parse(c.req.query("period") ?? "day");
  const limit = Number(c.req.query("limit") ?? (period === "day" ? "30" : period === "month" ? "12" : "5"));
  const anchorDay = c.req.query("anchorDay") ?? new Date().toISOString().slice(0, 10);
  if (workspaceId !== c.env.WORKSPACE_ID) return c.json({ error: "workspace_mismatch" }, 403);

  const room = roomStub(c.env, workspaceId, "global");
  return c.json(await room.getOwnerHistory(period, limit, anchorDay));
});

app.get("/v1/owner/lifetime", async (c) => {
  const workspaceId = c.req.query("workspaceId") ?? c.env.WORKSPACE_ID;
  if (workspaceId !== c.env.WORKSPACE_ID) return c.json({ error: "workspace_mismatch" }, 403);

  const room = roomStub(c.env, workspaceId, "global");
  return c.json(await room.getOwnerLifetime());
});

app.get("/v1/meta", (c) =>
  c.json(
    RealtimeMetaResponseSchema.parse({
      serverVersion: "2026.04.14",
      ingestProtocols: {
        presence: ["presence.v2"],
        web: ["web.v1"]
      },
      streamProtocols: [REALTIME_WS_PROTOCOL_V2],
      capabilities: {
        presence: true,
        multiRoom: true,
        chat: true,
        richMedia: true,
        interaction: true
      },
      interactionProtocols: ["interaction.v1", "interaction.ws.v1"],
      supportedInteractionCommands: ["media.recommend.track"]
    })
  )
);

app.post("/v2/presence/ingest", async (c) => {
  const logger = createWorkerLogger(c.env, "worker.index");
  if (!isValidBearerToken(c.req.header("Authorization") ?? null, requiredDeviceApiKey(c.env))) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const payload = PresenceIngestRequestSchema.parse(await c.req.json());
  if (payload.workspaceId !== c.env.WORKSPACE_ID) {
    return c.json({ error: "workspace_mismatch" }, 403);
  }
  if (payload.siteId !== c.env.SITE_ID) {
    return c.json({ error: "site_mismatch" }, 403);
  }

  const device = deviceStub(c.env, payload.workspaceId, payload.deviceId);
  const ack = await device.handlePresenceIngest(payload, deviceSessionTtlMs(c.env));
  logger.debug("presence ingest accepted", {
    workspaceId: payload.workspaceId,
    deviceId: payload.deviceId,
    eventCount: payload.events.length,
    acceptedSeqMax: ack.acceptedSeqMax,
  });
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

app.get("/v1/realtime/ws", async (c) => {
  const logger = createWorkerLogger(c.env, "worker.index");
  const workspaceId = c.req.query("workspaceId");
  const roomId = c.req.query("roomId");
  if (!workspaceId || workspaceId !== c.env.WORKSPACE_ID) {
    return c.json({ error: "workspace_mismatch" }, 403);
  }

  if (!roomId) {
    return c.json({ error: "roomId_required" }, 400);
  }

  const namespace = roomNamespace(c.env, roomId);
  const stub = namespace.get(
    realtimeRoomId(namespace, workspaceId, roomId),
  );
  logger.debug("ws upgrade", {
    workspaceId,
    roomId,
    url: c.req.url,
    userAgent: c.req.header("User-Agent") ?? null,
  });

  // Forward original upgrade request to DO
  return stub.fetch(c.req.raw);
});

app.onError((err, c) => {
  createWorkerLogger(c.env, "worker.index").error("hono error", err);
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
export { GlobalStatusRoom, PageStatusRoom, ChatRoom, InteractionHub, InteractionInbox, DeviceDO };

function deviceStub(env: Env, workspaceId: string, deviceId: string): DeviceRpc {
  const id = env.DEVICE_DO.idFromName(`${workspaceId}:${deviceId}`);
  return env.DEVICE_DO.get(id) as unknown as DeviceRpc;
}

function isValidBearerToken(header: string | null, expectedToken: string): boolean {
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() === expectedToken;
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

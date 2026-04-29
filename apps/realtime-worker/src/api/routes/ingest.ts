import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  PresenceIngestRequestSchema,
  WebIngestRequestSchema,
} from "@pulse/realtime-protocol";

import { deviceSessionTtlMs, webSessionTtlMs } from "../config/env";
import { requireDeviceBearer } from "../http/auth";
import { requireAllowedOrigin } from "../http/cors";
import type { AppEnv } from "../http/hono";
import { createWorkerLogger } from "../observability/logger";
import { deviceStub } from "../rpc/device";
import { roomStub } from "../rpc/room";

export const ingestRoutes = new Hono<AppEnv>();

ingestRoutes.post(
  "/v2/presence/ingest",
  requireDeviceBearer,
  zValidator("json", PresenceIngestRequestSchema),
  async (c) => {
    const payload = c.req.valid("json");
    if (payload.workspaceId !== c.env.WORKSPACE_ID) return c.json({ error: "workspace_mismatch" }, 403);
    if (payload.siteId !== c.env.SITE_ID) return c.json({ error: "site_mismatch" }, 403);

    const device = deviceStub(c.env, payload.workspaceId, payload.deviceId);
    const ack = await device.handlePresenceIngest(payload, deviceSessionTtlMs(c.env));
    createWorkerLogger(c.env, "worker.presence").debug("presence ingest accepted", {
      workspaceId: payload.workspaceId,
      deviceId: payload.deviceId,
      eventCount: payload.events.length,
      acceptedSeqMax: ack.acceptedSeqMax,
    });
    return c.json(ack);
  },
);

ingestRoutes.post("/v2/history/ingest", async (c) => {
  const payload = await c.req.json() as { workspaceId?: string; deviceId: string };
  if (payload.workspaceId !== c.env.WORKSPACE_ID) {
    return c.json({ error: "workspace_mismatch" }, 403);
  }

  const device = deviceStub(c.env, payload.workspaceId, payload.deviceId);
  return c.json(await device.handleHistoryIngest(payload));
});

ingestRoutes.post(
  "/v1/web/ingest",
  requireAllowedOrigin,
  zValidator("json", WebIngestRequestSchema),
  async (c) => {
    const payload = c.req.valid("json");
    if (payload.workspaceId !== c.env.WORKSPACE_ID) return c.json({ error: "workspace_mismatch" }, 403);
    if (payload.siteId !== c.env.SITE_ID) return c.json({ error: "site_mismatch" }, 403);

    const ttlMs = webSessionTtlMs(c.env);
    const globalRoom = roomStub(c.env, payload.workspaceId, "global");
    const ack = await globalRoom.handleWebIngest(payload, "global", ttlMs);

    const lastEvent = payload.events[payload.events.length - 1];
    if (lastEvent && lastEvent.kind !== "session_end" && lastEvent.page?.url) {
      const canonicalUrl = lastEvent.page.canonicalUrl ?? lastEvent.page.url;
      const pageRoomId = `page:${canonicalUrl}`;
      const pageRoom = roomStub(c.env, payload.workspaceId, pageRoomId);
      c.executionCtx.waitUntil(
        pageRoom.handleWebIngest(payload, pageRoomId, ttlMs).catch(() => {}),
      );
    }

    return c.json(ack);
  },
);

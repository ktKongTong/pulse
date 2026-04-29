import { Hono } from "hono";

import type { AppEnv } from "../http/hono";
import { createWorkerLogger } from "../observability/logger";
import { realtimeRoomId, roomNamespace } from "../rpc/room";

export const realtimeRoutes = new Hono<AppEnv>();

realtimeRoutes.get("/v1/realtime/ws", async (c) => {
  const workspaceId = c.req.query("workspaceId");
  const roomId = c.req.query("roomId");
  if (!workspaceId || workspaceId !== c.env.WORKSPACE_ID) {
    return c.json({ error: "workspace_mismatch" }, 403);
  }
  if (!roomId) return c.json({ error: "roomId_required" }, 400);

  const namespace = roomNamespace(c.env, roomId);
  const stub = namespace.get(realtimeRoomId(namespace, workspaceId, roomId));
  createWorkerLogger(c.env, "worker.realtime").debug("ws upgrade", {
    workspaceId,
    roomId,
    url: c.req.url,
    userAgent: c.req.header("User-Agent") ?? null,
  });

  return stub.fetch(c.req.raw);
});

import { Hono } from "hono";
import type { Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

import type { AppEnv } from "../http/hono";
import { liveListenStub } from "../rpc/live-listen";

const DEFAULT_LIVE_LISTEN_ROOM_ID = "live-listen:owner";
const DEFAULT_LIVE_LISTEN_DEVICE_ID = "owner";

const LiveListenQuerySchema = z.object({
  workspaceId: z.string().optional(),
  roomId: z.string().optional(),
});

export const liveListenRoutes = new Hono<AppEnv>();

liveListenRoutes.get("/state", zValidator("query", LiveListenQuerySchema), async (c) => {
  const query = c.req.valid("query");
  const workspaceId = query.workspaceId ?? c.env.WORKSPACE_ID;
  if (workspaceId !== c.env.WORKSPACE_ID) return c.json({ error: "workspace_mismatch" }, 403);
  const roomId = query.roomId ?? DEFAULT_LIVE_LISTEN_ROOM_ID;
  return c.json(await liveListenStub(c.env, workspaceId, roomId).getSnapshot(workspaceId, roomId));
});

liveListenRoutes.get("/device-session", async (c) => {
  if (c.req.header("Upgrade") !== "websocket") {
  console.log("haha")
    return new Response("Expected websocket", { status: 426 });
  }
  console.log("haha")
  const url = new URL(c.req.url);
  if (!isValidDeviceCredential(c.req.header("Authorization"), url.searchParams.get("apiKey"), c.env.DEVICE_API_KEY)) {
      console.log("haha 401")
    return c.json({ error: "unauthorized" }, 401);
  }
  url.searchParams.delete("apiKey");
  url.searchParams.set("deviceId", url.searchParams.get("deviceId") ?? liveListenDeviceId(c.env));
  console.log("fetch")
  return liveListenRoomFetch(c, url);
});

liveListenRoutes.get("/media-session", async (c) => {
  if (c.req.header("Upgrade") !== "websocket") {
    return new Response("Expected websocket", { status: 426 });
  }
  const origin = c.req.header("Origin") ?? null;
  if (origin && !isAllowedLiveListenOrigin(origin, c.req.url, c.env.ALLOWED_ORIGINS)) {
    return c.json({ error: "origin_not_allowed" }, 403);
  }
  return liveListenRoomFetch(c);
});

liveListenRoutes.get("/observe", async (c) => {
  if (c.req.header("Upgrade") !== "websocket") {
    return new Response("Expected websocket", { status: 426 });
  }
  const origin = c.req.header("Origin") ?? null;
  if (origin && !isAllowedLiveListenOrigin(origin, c.req.url, c.env.ALLOWED_ORIGINS)) {
    return c.json({ error: "origin_not_allowed" }, 403);
  }
  return liveListenRoomFetch(c);
});

async function liveListenRoomFetch(c: Context<AppEnv>, urlOverride?: URL) {
  const url = urlOverride ?? new URL(c.req.url);
  const workspaceId = url.searchParams.get("workspaceId") ?? c.env.WORKSPACE_ID;
  if (workspaceId !== c.env.WORKSPACE_ID) return c.json({ error: "workspace_mismatch" }, 403);
  const roomId = url.searchParams.get("roomId") ?? DEFAULT_LIVE_LISTEN_ROOM_ID;
  url.searchParams.set("workspaceId", workspaceId);
  url.searchParams.set("roomId", roomId);
  const id = c.env.LIVE_LISTEN_ROOM.idFromName(`${workspaceId}:${roomId}`);
  return c.env.LIVE_LISTEN_ROOM.get(id).fetch(new Request(url, c.req.raw));
}

function liveListenDeviceId(env: AppEnv["Bindings"]): string {
  return env.LIVE_LISTEN_DEVICE_ID?.trim() || DEFAULT_LIVE_LISTEN_DEVICE_ID;
}

function isAllowedLiveListenOrigin(origin: string, requestUrl: string, allowedOrigins: string) {
  if (origin === new URL(requestUrl).origin) return true;
  return allowedOrigins
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .includes(origin);
}

function isValidDeviceCredential(authorization: string | undefined, apiKey: string | null, expectedToken: string) {
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  return bearer === expectedToken || apiKey === expectedToken;
}

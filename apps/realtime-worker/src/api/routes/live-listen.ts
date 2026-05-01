import { Hono, type Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  LiveListenHostHeartbeatRequestSchema,
  LiveListenHostStartRequestSchema,
  LiveListenHostStopRequestSchema,
  LiveListenListenerJoinRequestSchema,
  LiveListenListenerLeaveRequestSchema,
} from "@pulse/realtime-protocol";

import { requireDeviceBearer } from "../http/auth";
import { requireAllowedOrigin } from "../http/cors";
import type { AppEnv } from "../http/hono";
import { deviceStub } from "../rpc/device";
import { liveListenStub } from "../rpc/live-listen";

const DEFAULT_LIVE_LISTEN_ROOM_ID = "live-listen:owner";
const DEFAULT_MEDIA_ROOM_ID = "room-test-1";
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

liveListenRoutes.get("/device/connect", requireDeviceBearer, async (c) => {
  if (c.req.header("Upgrade") !== "websocket") {
    return new Response("Expected websocket", { status: 426 });
  }

  const url = new URL(c.req.url);
  const workspaceId = url.searchParams.get("workspaceId") ?? c.env.WORKSPACE_ID;
  if (workspaceId !== c.env.WORKSPACE_ID) return c.json({ error: "workspace_mismatch" }, 403);
  const deviceId = url.searchParams.get("deviceId") ?? liveListenDeviceId(c.env);
  return deviceStub(c.env, workspaceId, deviceId).fetch(c.req.raw);
});

liveListenRoutes.get("/events", zValidator("query", LiveListenQuerySchema), async (c) => {
  if (c.req.header("Upgrade") !== "websocket") {
    return new Response("Expected websocket", { status: 426 });
  }
  const origin = c.req.header("Origin") ?? null;
  if (origin && !isAllowedLiveListenEventOrigin(origin, c.req.url, c.env.ALLOWED_ORIGINS)) {
    return c.json({ error: "origin_not_allowed" }, 403);
  }

  const query = c.req.valid("query");
  const workspaceId = query.workspaceId ?? c.env.WORKSPACE_ID;
  if (workspaceId !== c.env.WORKSPACE_ID) return c.json({ error: "workspace_mismatch" }, 403);
  const roomId = query.roomId ?? DEFAULT_LIVE_LISTEN_ROOM_ID;
  const id = c.env.LIVE_LISTEN_ROOM.idFromName(`${workspaceId}:${roomId}`);
  return c.env.LIVE_LISTEN_ROOM.get(id).fetch(c.req.raw);
});

function isAllowedLiveListenEventOrigin(origin: string, requestUrl: string, allowedOrigins: string) {
  if (origin === new URL(requestUrl).origin) return true;
  return allowedOrigins
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .includes(origin);
}

liveListenRoutes.post(
  "/host/start",
  requireDeviceBearer,
  zValidator("json", LiveListenHostStartRequestSchema),
  async (c) => {
    const payload = c.req.valid("json");
    if (payload.workspaceId !== c.env.WORKSPACE_ID) return c.json({ error: "workspace_mismatch" }, 403);
    return sendLiveListenResult(c, () =>
      liveListenStub(c.env, payload.workspaceId, payload.roomId).startHost(payload),
    );
  },
);

liveListenRoutes.post(
  "/host/heartbeat",
  requireDeviceBearer,
  zValidator("json", LiveListenHostHeartbeatRequestSchema),
  async (c) => {
    const payload = c.req.valid("json");
    if (payload.workspaceId !== c.env.WORKSPACE_ID) return c.json({ error: "workspace_mismatch" }, 403);
    return sendLiveListenResult(c, () =>
      liveListenStub(c.env, payload.workspaceId, payload.roomId).heartbeatHost(payload),
    );
  },
);

liveListenRoutes.post(
  "/host/stop",
  requireDeviceBearer,
  zValidator("json", LiveListenHostStopRequestSchema),
  async (c) => {
    const payload = c.req.valid("json");
    if (payload.workspaceId !== c.env.WORKSPACE_ID) return c.json({ error: "workspace_mismatch" }, 403);
    return sendLiveListenResult(c, () =>
      liveListenStub(c.env, payload.workspaceId, payload.roomId).stopHost(payload),
    );
  },
);

liveListenRoutes.post(
  "/listener/join",
  requireAllowedOrigin,
  zValidator("json", LiveListenListenerJoinRequestSchema),
  async (c) => {
    const payload = c.req.valid("json");
    if (payload.workspaceId !== c.env.WORKSPACE_ID) return c.json({ error: "workspace_mismatch" }, 403);
    return sendLiveListenResult(c, async () => {
      const result = await liveListenStub(c.env, payload.workspaceId, payload.roomId).joinListener(payload);
      await sendLiveListenDeviceCommand(c, payload.workspaceId, payload.roomId, {
        type: "stream.start",
        mediaRoomId: DEFAULT_MEDIA_ROOM_ID,
        producerUrl: mediaRoomProducerUrl(c, DEFAULT_MEDIA_ROOM_ID),
        capture: {
          mode: "current-media-app",
          preferredProvider: "spotify",
          fallback: "selected",
        },
      });
      return result;
    });
  },
);

liveListenRoutes.post(
  "/listener/leave",
  requireAllowedOrigin,
  zValidator("json", LiveListenListenerLeaveRequestSchema),
  async (c) => {
    const payload = c.req.valid("json");
    if (payload.workspaceId !== c.env.WORKSPACE_ID) return c.json({ error: "workspace_mismatch" }, 403);
    return sendLiveListenResult(c, async () => {
      const snapshot = await liveListenStub(c.env, payload.workspaceId, payload.roomId).leaveListener(payload);
      if (snapshot.listenerCount === 0) {
        await sendLiveListenDeviceCommand(c, payload.workspaceId, payload.roomId, {
          type: "stream.stop",
          reason: "last_listener_left",
        });
      }
      return snapshot;
    });
  },
);

function liveListenDeviceId(env: AppEnv["Bindings"]): string {
  return env.LIVE_LISTEN_DEVICE_ID?.trim() || DEFAULT_LIVE_LISTEN_DEVICE_ID;
}

function mediaRoomProducerUrl(c: Context<AppEnv>, roomId: string): string {
  const url = new URL(c.req.url);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `/api/v1/media-room/${encodeURIComponent(roomId)}`;
  url.search = "role=producer";
  return url.toString();
}

async function sendLiveListenDeviceCommand(
  c: Context<AppEnv>,
  workspaceId: string,
  roomId: string,
  command: Record<string, unknown>,
) {
  if (!c.env.DEVICE_DO) return { delivered: 0 };
  const deviceId = liveListenDeviceId(c.env);
  const sentAt = new Date();
  try {
    return await deviceStub(c.env, workspaceId, deviceId).sendLiveListenCommand({
      protocol: "live-listen.device.v1",
      kind: "command",
      commandId: crypto.randomUUID(),
      workspaceId,
      roomId,
      deviceId,
      sentAt: sentAt.toISOString(),
      expiresAt: new Date(sentAt.getTime() + 10_000).toISOString(),
      command,
    });
  } catch (error) {
    console.warn("live listen device command failed", error);
    return { delivered: 0 };
  }
}

async function sendLiveListenResult<T>(
  c: Context<AppEnv>,
  action: () => Promise<T>,
): Promise<Response> {
  try {
    return c.json(await action());
  } catch (error) {
    const code = error instanceof Error ? error.message : "live_listen_error";
    if (code === "workspace_mismatch") return c.json({ error: code }, 403);
    if (code === "room_mismatch") return c.json({ error: code }, 409);
    if (code === "host_device_mismatch") return c.json({ error: code }, 409);
    if (code === "live_listen_not_active") return c.json({ error: code }, 409);
    throw error;
  }
}

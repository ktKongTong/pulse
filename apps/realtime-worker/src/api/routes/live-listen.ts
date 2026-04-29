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
import { liveListenStub } from "../rpc/live-listen";

const DEFAULT_LIVE_LISTEN_ROOM_ID = "live-listen:owner";

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

liveListenRoutes.get("/events", zValidator("query", LiveListenQuerySchema), async (c) => {
  if (c.req.header("Upgrade") !== "websocket") {
    return new Response("Expected websocket", { status: 426 });
  }

  const query = c.req.valid("query");
  const workspaceId = query.workspaceId ?? c.env.WORKSPACE_ID;
  if (workspaceId !== c.env.WORKSPACE_ID) return c.json({ error: "workspace_mismatch" }, 403);
  const roomId = query.roomId ?? DEFAULT_LIVE_LISTEN_ROOM_ID;
  const id = c.env.LIVE_LISTEN_ROOM.idFromName(`${workspaceId}:${roomId}`);
  return c.env.LIVE_LISTEN_ROOM.get(id).fetch(c.req.raw);
});

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
    return sendLiveListenResult(c, () =>
      liveListenStub(c.env, payload.workspaceId, payload.roomId).joinListener(payload),
    );
  },
);

liveListenRoutes.post(
  "/listener/leave",
  requireAllowedOrigin,
  zValidator("json", LiveListenListenerLeaveRequestSchema),
  async (c) => {
    const payload = c.req.valid("json");
    if (payload.workspaceId !== c.env.WORKSPACE_ID) return c.json({ error: "workspace_mismatch" }, 403);
    return sendLiveListenResult(c, () =>
      liveListenStub(c.env, payload.workspaceId, payload.roomId).leaveListener(payload),
    );
  },
);

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

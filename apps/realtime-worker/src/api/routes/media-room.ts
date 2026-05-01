import { Hono } from "hono";

import type { Env } from "../config/env";

type AppEnv = { Bindings: Env };

export const mediaRoomRoutes = new Hono<AppEnv>();

/**
 * 固定房间 MVP：/api/v1/media-room/room-test-1?role=producer|consumer
 *
 * Worker 只负责把 WebSocket 请求转交到同一个 Durable Object 实例；
 * 真正的二进制音频 fan-out 发生在 MediaRoomDO 内部。
 */
mediaRoomRoutes.get("/:roomId", (c) => {
  if (c.req.header("Upgrade") !== "websocket") {
    return c.text("Expected websocket", 426);
  }

  const roomId = c.req.param("roomId") || "room-test-1";
  const role = c.req.query("role");
  const id = c.env.MEDIA_ROOM.idFromName(roomId);
  const stub = c.env.MEDIA_ROOM.get(id);
  const url = new URL(c.req.url);
  url.searchParams.set("roomId", roomId);
  if (role) url.searchParams.set("role", role);

  return stub.fetch(new Request(url, c.req.raw));
});

import { Hono } from "hono";
import type { Env } from "../env";
import { deviceStub, mediaStub } from "../env";

export const deviceRoutes = new Hono<{ Bindings: Env }>();

deviceRoutes.get("/ws", (c) => {
  const deviceId = c.req.query("deviceId") ?? "owner";
  return deviceStub(c.env, deviceId).fetch(c.req.raw);
});

deviceRoutes.get("/media/ws", (c) => mediaStub(c.env).fetch(c.req.raw));

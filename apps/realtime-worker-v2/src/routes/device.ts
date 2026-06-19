import { Hono } from "hono";
import type { Env } from "../env";
import { deviceStub } from "../env";

export const deviceRoutes = new Hono<{ Bindings: Env }>();

deviceRoutes.get("/ws", (c) => {
  const deviceId = c.req.query("deviceId");
  if(!deviceId) {
    return c.json({message: "invalid deviceId"},400)
  }
  return deviceStub(c.env, deviceId).fetch(c.req.raw);
});

import { Hono } from "hono";
import { CLIENT_COMMON_WS_PROTOCOL } from "@ktfun/pulse-protocol";
import type { Env } from "../env";
import { globalStub, mediaStub, pageStub } from "../env";
import { badRequest, json } from "../utils/http";

export const clientRoutes = new Hono<{ Bindings: Env }>();

clientRoutes.post("/session", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || body.protocol !== CLIENT_COMMON_WS_PROTOCOL) {
    return badRequest("invalid_session_claim");
  }
  return json(await globalStub(c.env).claimSession(body));
});

clientRoutes.get("/ws", (c) => globalStub(c.env).fetch(c.req.raw));

clientRoutes.get("/page/ws", (c) => {
  const canonicalUrl = c.req.query("canonicalUrl");
  if (!canonicalUrl) return badRequest("canonicalUrl_required");
  return pageStub(c.env, canonicalUrl).fetch(c.req.raw);
});

clientRoutes.get("/media/ws", (c) => mediaStub(c.env).fetch(c.req.raw));

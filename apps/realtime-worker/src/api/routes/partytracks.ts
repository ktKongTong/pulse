import { Hono } from "hono";
import { routePartyTracksRequest } from "partytracks/server";

import { isAllowedOriginForRequest, requiredDeviceApiKey, requiredRealtimeSfuConfig } from "../config/env";
import type { AppEnv } from "../http/hono";

export const partyTracksRoutes = new Hono<AppEnv>();

partyTracksRoutes.all("/partytracks/*", async (c) => {
  const origin = c.req.header("Origin") ?? null;
  if (origin !== null && !isAllowedOriginForRequest(c.env, origin, c.req.url)) {
    return c.json({ error: "origin_not_allowed" }, 403);
  }

  const config = requiredRealtimeSfuConfig(c.env);
  return routePartyTracksRequest({
    ...config,
    prefix: resolvePartyTracksPrefix(c.req.raw),
    request: c.req.raw,
    lockSessionToInitiator: !isDeviceBearer(c.req.header("Authorization") ?? null, requiredDeviceApiKey(c.env)),
  });
});

function resolvePartyTracksPrefix(request: Request) {
  const pathname = new URL(request.url).pathname;
  if (pathname.startsWith("/api/v1/live-listen/partytracks")) {
    return "/api/v1/live-listen/partytracks";
  }
  return "/v1/live-listen/partytracks";
}

function isDeviceBearer(header: string | null, expectedToken: string): boolean {
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() === expectedToken;
}

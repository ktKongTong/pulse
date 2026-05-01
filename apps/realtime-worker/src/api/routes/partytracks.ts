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
  const request = await requestWithForwardableBody(c.req.raw);
  return routePartyTracksRequest({
    ...config,
    prefix: resolvePartyTracksPrefix(request),
    request,
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


async function requestWithForwardableBody(request: Request): Promise<Request> {
  if (request.method === "GET" || request.method === "HEAD") return request;
  if (request.headers.has("Content-Length")) return request;
  const body = await request.arrayBuffer();
  const headers = new Headers(request.headers);
  headers.set("Content-Length", String(body.byteLength));
  return new Request(request.url, {
    method: request.method,
    headers,
    body: body.byteLength > 0 ? body : undefined,
    redirect: request.redirect,
  });
}

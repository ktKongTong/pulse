import type { Context, MiddlewareHandler } from "hono";

import { isAllowedOriginForRequest } from "../config/env";
import type { AppEnv } from "./hono";

const ALLOWED_METHODS = "GET,POST,OPTIONS";
const ALLOWED_HEADERS = "Content-Type,Authorization,X-PulseBar-Protocol";

export const applyCorsHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  const origin = c.req.header("Origin") ?? null;
  await next();

  c.header("Vary", "Origin");
  if (!isAllowedOriginForRequest(c.env, origin, c.req.url)) return;

  c.header("Access-Control-Allow-Origin", origin!);
  c.header("Access-Control-Allow-Methods", ALLOWED_METHODS);
  c.header("Access-Control-Allow-Headers", ALLOWED_HEADERS);
};

export function handleOptions(c: Context<AppEnv>) {
  const origin = c.req.header("Origin") ?? null;
  if (!isAllowedOriginForRequest(c.env, origin, c.req.url)) {
    return c.body(null, 403);
  }

  c.header("Access-Control-Allow-Origin", origin!);
  c.header("Access-Control-Allow-Methods", ALLOWED_METHODS);
  c.header("Access-Control-Allow-Headers", ALLOWED_HEADERS);
  c.header("Access-Control-Max-Age", "86400");
  c.header("Vary", "Origin");
  return c.body(null, 204);
}

export const requireAllowedOrigin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const origin = c.req.header("Origin") ?? null;
  if (!isAllowedOriginForRequest(c.env, origin, c.req.url)) {
    return c.json({ error: "origin_not_allowed" }, 403);
  }
  await next();
};

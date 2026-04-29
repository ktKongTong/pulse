import type { MiddlewareHandler } from "hono";

import { requiredDeviceApiKey } from "../config/env";
import type { AppEnv } from "./hono";

export const requireDeviceBearer: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!isValidBearerToken(c.req.header("Authorization") ?? null, requiredDeviceApiKey(c.env))) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
};

function isValidBearerToken(header: string | null, expectedToken: string): boolean {
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() === expectedToken;
}

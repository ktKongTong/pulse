export interface Env {
  REALTIME_ROOM: DurableObjectNamespace;
  REALTIME_SESSION: DurableObjectNamespace;
  INTERACTION_HUB: DurableObjectNamespace;
  INTERACTION_INBOX: DurableObjectNamespace;
  ASSETS: Fetcher;
  WORKSPACE_ID: string;
  SITE_ID: string;
  ALLOWED_ORIGINS: string;
  ROOM_SESSION_TTL_SECONDS?: string;
  WEB_HEARTBEAT_SECONDS?: string;
}

export function allowedOrigins(env: Env): Set<string> {
  return new Set(
    env.ALLOWED_ORIGINS.split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

export function isAllowedOrigin(env: Env, origin: string | null): boolean {
  if (!origin) return false;
  return allowedOrigins(env).has(origin);
}

export function isAllowedOriginForRequest(env: Env, origin: string | null, requestUrl: string): boolean {
  if (!origin) return false;
  if (origin == new URL(requestUrl).origin) return true;
  return isAllowedOrigin(env, origin);
}

export function webSessionTtlMs(env: Env): number {
  const seconds = Number(env.ROOM_SESSION_TTL_SECONDS ?? "45");
  return Math.max(1, Number.isFinite(seconds) ? seconds : 45) * 1000;
}

export function webHeartbeatSeconds(env: Env): number {
  const seconds = Number(env.WEB_HEARTBEAT_SECONDS ?? "15");
  return Math.max(1, Number.isFinite(seconds) ? seconds : 15);
}

export function deviceSessionTtlMs(env: Env): number {
  return Math.max(120, webHeartbeatSeconds(env) * 2) * 1000;
}

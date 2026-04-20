import type { DeviceDO } from "./device-do";
import type { InteractionHub } from "./interaction-hub-do";
import type { InteractionInbox } from "./interaction-inbox-do";
import type { ChatRoom, GlobalStatusRoom, PageStatusRoom } from "./room-do";

export type Env = Cloudflare.Env & {
  GLOBAL_STATUS_ROOM: DurableObjectNamespace<GlobalStatusRoom>;
  PAGE_STATUS_ROOM: DurableObjectNamespace<PageStatusRoom>;
  CHAT_ROOM: DurableObjectNamespace<ChatRoom>;
  INTERACTION_HUB: DurableObjectNamespace<InteractionHub>;
  INTERACTION_INBOX: DurableObjectNamespace<InteractionInbox>;
  DEVICE_DO: DurableObjectNamespace<DeviceDO>;
  ASSETS: Fetcher;
  WORKSPACE_ID: string;
  SITE_ID: string;
  ALLOWED_ORIGINS: string;
  ROOM_SESSION_TTL_SECONDS?: string;
  WEB_HEARTBEAT_SECONDS?: string;
  AGGREGATE_FLUSH_SECONDS?: string;
  DEBUG_LOGS?: string;
  LOG_LEVEL?: string;
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
  const fallbackSeconds = Math.max(45, webHeartbeatSeconds(env) * 2);
  const seconds = Number(env.ROOM_SESSION_TTL_SECONDS ?? String(fallbackSeconds));
  return Math.max(1, Number.isFinite(seconds) ? seconds : 45) * 1000;
}

export function webHeartbeatSeconds(env: Env): number {
  const seconds = Number(env.WEB_HEARTBEAT_SECONDS ?? "30");
  return Math.max(1, Number.isFinite(seconds) ? seconds : 30);
}

export function deviceSessionTtlMs(env: Env): number {
  return Math.max(120, webHeartbeatSeconds(env) * 2) * 1000;
}

export function aggregateFlushMs(env: Env): number {
  const values = env as unknown as Record<string, unknown>;
  const seconds = Number(values.AGGREGATE_FLUSH_SECONDS ?? "30");
  return Math.max(5, Number.isFinite(seconds) ? seconds : 30) * 1000;
}

export function debugLoggingEnabled(env: Env): boolean {
  const values = env as unknown as Record<string, unknown>;
  const debugFlag = String(values.DEBUG_LOGS ?? "").trim().toLowerCase();
  const logLevel = String(values.LOG_LEVEL ?? "").trim().toLowerCase();

  if (["1", "true", "yes", "on"].includes(debugFlag)) return true;
  return ["debug", "trace", "verbose"].includes(logLevel);
}

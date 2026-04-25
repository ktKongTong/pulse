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
  DEVICE_API_KEY: string;
  ALLOWED_ORIGINS: string;
  ROOM_SESSION_TTL_SECONDS: string;
  WEB_HEARTBEAT_SECONDS: string;
  AGGREGATE_FLUSH_SECONDS: string;
  DEBUG_LOGS?: string;
  LOG_LEVEL?: string;
}

function requiredEnvValue(env: Env, key: keyof Env): string {
  const value = env[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${String(key)}`);
  }
  return value;
}

export function requiredDeviceApiKey(env: Env): string {
  return requiredEnvValue(env, "DEVICE_API_KEY");
}

function requiredEnvNumber(env: Env, key: keyof Env): number {
  const raw = requiredEnvValue(env, key);
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid numeric environment variable: ${String(key)}`);
  }
  return value;
}

export function allowedOrigins(env: Env): Set<string> {
  const values = requiredEnvValue(env, "ALLOWED_ORIGINS")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (values.length === 0) {
    throw new Error("Missing required environment variable: ALLOWED_ORIGINS");
  }

  return new Set(values);
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
  const seconds = requiredEnvNumber(env, "ROOM_SESSION_TTL_SECONDS");
  if (seconds < 1) {
    throw new Error("Invalid numeric environment variable: ROOM_SESSION_TTL_SECONDS");
  }
  return seconds * 1000;
}

export function webHeartbeatSeconds(env: Env): number {
  const seconds = requiredEnvNumber(env, "WEB_HEARTBEAT_SECONDS");
  if (seconds < 1) {
    throw new Error("Invalid numeric environment variable: WEB_HEARTBEAT_SECONDS");
  }
  return seconds;
}

export function deviceSessionTtlMs(env: Env): number {
  return webHeartbeatSeconds(env) * 2 * 1000;
}

export function aggregateFlushMs(env: Env): number {
  const seconds = requiredEnvNumber(env, "AGGREGATE_FLUSH_SECONDS");
  if (seconds < 1) {
    throw new Error("Invalid numeric environment variable: AGGREGATE_FLUSH_SECONDS");
  }
  return seconds * 1000;
}

export function debugLoggingEnabled(env: Env): boolean {
  const values = env as unknown as Record<string, unknown>;
  const debugFlag = String(values.DEBUG_LOGS ?? "").trim().toLowerCase();
  const logLevel = String(values.LOG_LEVEL ?? "").trim().toLowerCase();

  if (["1", "true", "yes", "on"].includes(debugFlag)) return true;
  return ["debug", "trace", "verbose"].includes(logLevel);
}

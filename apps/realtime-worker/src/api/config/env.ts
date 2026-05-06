import type { DeviceDO } from "../do/device/device-do";
import type { InteractionHub } from "../do/interaction/hub-do";
import type { InteractionInbox } from "../do/interaction/inbox-do";
import type { LiveListenRoom } from "../do/live-listen/room-do";
import type { MediaRoomDO } from "../do/media-room/media-room-do";
import type { ChatRoom, GlobalStatusRoom, PageStatusRoom } from "../do/room";

export type Env = Cloudflare.Env & {
  GLOBAL_STATUS_ROOM: DurableObjectNamespace<GlobalStatusRoom>;
  PAGE_STATUS_ROOM: DurableObjectNamespace<PageStatusRoom>;
  CHAT_ROOM: DurableObjectNamespace<ChatRoom>;
  INTERACTION_HUB: DurableObjectNamespace<InteractionHub>;
  INTERACTION_INBOX: DurableObjectNamespace<InteractionInbox>;
  LIVE_LISTEN_ROOM: DurableObjectNamespace<LiveListenRoom>;
  MEDIA_ROOM: DurableObjectNamespace<MediaRoomDO>;
  DEVICE_DO: DurableObjectNamespace<DeviceDO>;
  ASSETS: Fetcher;
  WORKSPACE_ID: string;
  SITE_ID: string;
  DEVICE_API_KEY: string;
  ALLOWED_ORIGINS: string;
  ROOM_SESSION_TTL_SECONDS: string;
  WEB_HEARTBEAT_SECONDS: string;
  AGGREGATE_FLUSH_SECONDS: string;
  REALTIME_SFU_APP_ID?: string;
  REALTIME_SFU_APP_TOKEN?: string;
  REALTIME_TURN_APP_ID?: string;
  REALTIME_TURN_APP_TOKEN?: string;
  DEBUG_LOGS?: string;
  LOG_LEVEL?: string;
  LIVE_LISTEN_DEVICE_ID?: string;
  LIVE_LISTEN_CHUNK_DURATION_MS?: string;
  LIVE_LISTEN_TARGET_LATENCY_MS?: string;
  LIVE_LISTEN_RING_BUFFER_SECONDS?: string;
  MEDIA_ROOM_ZERO_CONSUMER_GRACE_MS?: string;
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

export function requiredRealtimeSfuConfig(env: Env) {
  const appId = optionalEnvValue(env, "REALTIME_SFU_APP_ID");
  const token = optionalEnvValue(env, "REALTIME_SFU_APP_TOKEN");
  if (!appId || !token) throw new Error("missing_realtime_sfu_config");
  return {
    appId,
    token,
    turnServerAppId: optionalEnvValue(env, "REALTIME_TURN_APP_ID") ?? undefined,
    turnServerAppToken: optionalEnvValue(env, "REALTIME_TURN_APP_TOKEN") ?? undefined,
  };
}

export function optionalEnvValue(env: Env, key: keyof Env): string | null {
  const value = env[key];
  if (typeof value !== "string" || value.trim() === "") return null;
  return value.trim();
}

export function liveListenStreamConfig(env: Env) {
  const chunkDurationMs = optionalEnvInt(env, "LIVE_LISTEN_CHUNK_DURATION_MS", 500, 50, 2_000);
  const targetLatencyMs = optionalEnvInt(env, "LIVE_LISTEN_TARGET_LATENCY_MS", 2_000, 0, 30_000);
  const ringBufferSeconds = optionalEnvInt(env, "LIVE_LISTEN_RING_BUFFER_SECONDS", 30, 1, 300);
  return {
    chunkDurationMs,
    targetLatencyMs,
    ringBufferSeconds,
    maxBufferedChunks: Math.max(1, Math.ceil((ringBufferSeconds * 1_000) / chunkDurationMs)),
  };
}

function optionalEnvInt(env: Env, key: keyof Env, defaultValue: number, min: number, max: number) {
  const raw = optionalEnvValue(env, key);
  if (raw === null) return defaultValue;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Invalid numeric environment variable: ${String(key)}`);
  }
  return value;
}

import type { DeviceDO } from "./durable/device";
import type { GlobalDO } from "./durable/global";
import type { MediaDO } from "./durable/media";
import type { PageDO } from "./durable/page";

export interface Env extends Cloudflare.Env {
  GLOBAL_DO: DurableObjectNamespace<GlobalDO>;
  PAGE_DO: DurableObjectNamespace<PageDO>;
  MEDIA_DO: DurableObjectNamespace<MediaDO>;
  DEVICE_DO: DurableObjectNamespace<DeviceDO>;
  WORKSPACE_ID: string;
  SITE_ID: string;
  MEDIA_RING_BUFFER_DURATION_MS?: string;
  MEDIA_DEVICE_COMMAND_TIMEOUT_MS?: string;
  MEDIA_CHUNK_STALL_TIMEOUT_MS?: string;
}

export function globalStub(env: Env) {
  return env.GLOBAL_DO.getByName("global");
}

export function pageStub(env: Env, canonicalUrl: string) {
  return env.PAGE_DO.getByName(canonicalUrl);
}

export function mediaStub(env: Env) {
  return env.MEDIA_DO.getByName("owner");
}

export function deviceStub(env: Env, deviceId: string) {
  return env.DEVICE_DO.getByName(deviceId);
}

export function envInt(
  env: Env,
  key: keyof Env,
  fallback: number,
  min = 0,
) {
  const raw = env[key];
  if (typeof raw !== "string" || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) return fallback;
  return value;
}

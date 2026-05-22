import type { Env } from "../env";
import { envInt } from "../env";
import type { AudioChunkMeta, PendingDeviceCommand } from "../state/media";

export function commandTimeoutMs(env: Env) {
  return envInt(env, "MEDIA_DEVICE_COMMAND_TIMEOUT_MS", 5000, 100);
}

export function commandExpired(command: PendingDeviceCommand, now = Date.now()) {
  return Date.parse(command.expiresAt) <= now;
}

export function maxBufferedChunks(env: Env, chunkDurationMs: number | null) {
  const duration = envInt(env, "MEDIA_RING_BUFFER_DURATION_MS", 30_000, 1_000);
  const chunkMs = Math.max(1, chunkDurationMs ?? 1000);
  return Math.max(1, Math.ceil(duration / chunkMs));
}

export function binaryMatchesMeta(bytes: ArrayBuffer, meta: AudioChunkMeta) {
  return bytes.byteLength === meta.byteLength;
}

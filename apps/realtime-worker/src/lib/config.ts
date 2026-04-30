function requiredViteEnv(key: keyof ImportMetaEnv): string {
  const value = import.meta.env[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optionalViteEnv(key: keyof ImportMetaEnv): string | null {
  const value = import.meta.env[key];
  if (typeof value !== "string" || value.trim() === "") return null;
  return value.trim();
}

function optionalViteEnvNumber(key: keyof ImportMetaEnv): number | null {
  const value = optionalViteEnv(key);
  if (value === null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric environment variable: ${key}`);
  }
  return parsed;
}

export const REALTIME_BASE_URL = requiredViteEnv("VITE_REALTIME_BASE_URL");
export const WORKSPACE_ID = requiredViteEnv("VITE_WORKSPACE_ID");
export const SITE_ID = requiredViteEnv("VITE_SITE_ID");
export const LIVE_LISTEN_RECEIVER_JITTER_BUFFER_MS = optionalViteEnvNumber("VITE_LIVE_LISTEN_RECEIVER_JITTER_BUFFER_MS");
export const LIVE_LISTEN_SENDER_WAVEFORM_URL = optionalViteEnv("VITE_LIVE_LISTEN_SENDER_WAVEFORM_URL") ?? "http://127.0.0.1:9323/waveform";
export const READING_HEARTBEAT_MS = 30_000;
export const READING_PROGRESS_THROTTLE_MS = 4_000;
export const READING_PROGRESS_DELTA_PERCENT = 10;

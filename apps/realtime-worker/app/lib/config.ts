function requiredViteEnv(key: keyof ImportMetaEnv): string {
  const value = import.meta.env[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export const REALTIME_BASE_URL = requiredViteEnv("VITE_REALTIME_BASE_URL");
export const WORKSPACE_ID = requiredViteEnv("VITE_WORKSPACE_ID");
export const SITE_ID = requiredViteEnv("VITE_SITE_ID");
export const READING_HEARTBEAT_MS = 30_000;
export const READING_PROGRESS_THROTTLE_MS = 4_000;
export const READING_PROGRESS_DELTA_PERCENT = 10;

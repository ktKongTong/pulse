export const REALTIME_BASE_URL = import.meta.env.VITE_REALTIME_BASE_URL ?? "http://localhost:8900";
export const BRANDFETCH_CLIENT_ID = import.meta.env.VITE_BRANDFETCH_CLIENT_ID ?? "";

export const WORKSPACE_ID = import.meta.env.VITE_WORKSPACE_ID ?? "pulse-demo";
export const SITE_ID = import.meta.env.VITE_SITE_ID ?? "blog-demo";
export const READING_HEARTBEAT_MS = 15_000;
export const READING_PROGRESS_THROTTLE_MS = 4_000;
export const READING_PROGRESS_DELTA_PERCENT = 10;

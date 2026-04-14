import type { PulseRealtimeConfig } from "./types";

export function getOrCreateSessionId(config: PulseRealtimeConfig): string {
  if (typeof window === "undefined") {
    return "ssr-session";
  }

  const key = config.sessionStorageKey ?? "pulse.realtime.sessionId";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const next = crypto.randomUUID();
  localStorage.setItem(key, next);
  return next;
}

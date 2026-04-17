import type { PulseRealtimeConfig } from "./types";

export function getOrCreateSessionId(config: PulseRealtimeConfig): string {
  if (typeof window === "undefined") {
    return "ssr-session";
  }

  const key = config.sessionStorageKey ?? "pulse.realtime.sessionId";
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const next = crypto.randomUUID();
  window.localStorage.setItem(key, next);
  return next;
}

export function getOrCreateTabId(config: PulseRealtimeConfig): string {
  if (typeof window === "undefined") {
    return "ssr-tab";
  }

  const key = config.tabStorageKey ?? "pulse.realtime.tabId";
  try {
    const existing = window.sessionStorage.getItem(key);
    if (existing) return existing;
    const next = crypto.randomUUID();
    window.sessionStorage.setItem(key, next);
    return next;
  } catch {
    return crypto.randomUUID();
  }
}

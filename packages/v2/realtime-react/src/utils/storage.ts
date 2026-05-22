import type { PulseRealtimeV2Config } from "../types";
import { createClientId } from "./id";

const DEFAULT_SESSION_STORAGE_KEY = "pulse.v2.realtime.sessionId";
const DEFAULT_TAB_STORAGE_KEY = "pulse.v2.realtime.tabId";

export function readStoredSessionId(config: PulseRealtimeV2Config) {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(
    config.sessionStorageKey ?? DEFAULT_SESSION_STORAGE_KEY,
  );
}

export function storeSessionId(
  config: PulseRealtimeV2Config,
  sessionId: string,
) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    config.sessionStorageKey ?? DEFAULT_SESSION_STORAGE_KEY,
    sessionId,
  );
}

export function getOrCreateTabId(config: PulseRealtimeV2Config) {
  if (typeof window === "undefined") return "ssr-tab";
  const key = config.tabStorageKey ?? DEFAULT_TAB_STORAGE_KEY;
  try {
    const existing = window.sessionStorage.getItem(key);
    if (existing) return existing;
    const next = createClientId("tab");
    window.sessionStorage.setItem(key, next);
    return next;
  } catch {
    return createClientId("tab");
  }
}

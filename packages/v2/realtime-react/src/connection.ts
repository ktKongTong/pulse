import type {
  ClientConnectionState,
  PulseRealtimeV2Snapshot,
} from "./types";
import { nowIso } from "./utils/time";

export function idleConnection(): ClientConnectionState {
  return {
    status: "idle",
    error: null,
    connected: false,
    updatedAt: null,
  };
}

export function nextConnection(
  status: ClientConnectionState["status"],
  error: string | null = null,
): ClientConnectionState {
  return {
    status,
    error,
    connected: status === "connected",
    updatedAt: nowIso(),
  };
}

export function createInitialSnapshot(): PulseRealtimeV2Snapshot {
  return {
    identity: null,
    common: {
      connection: idleConnection(),
      snapshot: null,
    },
    pages: {},
    media: {
      connection: idleConnection(),
      source: { state: "offline" },
      media: null,
      stream: { state: "observer" },
    },
  };
}

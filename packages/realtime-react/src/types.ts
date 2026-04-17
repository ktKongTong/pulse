export interface PulseRealtimeConfig {
  baseUrl: string;
  workspaceId: string;
  siteId: string;
  debug?: boolean;
  readingHeartbeatMs?: number;
  readingProgressThrottleMs?: number;
  readingProgressDeltaPercent?: number;
  sessionStorageKey?: string;
  tabStorageKey?: string;
  interactionActor?: {
    kind: "owner" | "user" | "anonymous";
    userId?: string;
  };
}

export const defaultPulseRealtimeConfig = {
  debug: false,
  readingHeartbeatMs: 30_000,
  readingProgressThrottleMs: 4_000,
  readingProgressDeltaPercent: 10,
  sessionStorageKey: "pulse.realtime.sessionId",
  tabStorageKey: "pulse.realtime.tabId",
  interactionActor: {
    kind: "anonymous" as const,
  },
};

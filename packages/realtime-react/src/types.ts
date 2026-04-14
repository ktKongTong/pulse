export interface PulseRealtimeConfig {
  baseUrl: string;
  workspaceId: string;
  siteId: string;
  readingHeartbeatMs?: number;
  readingProgressThrottleMs?: number;
  readingProgressDeltaPercent?: number;
  sessionStorageKey?: string;
  interactionActor?: {
    kind: "owner" | "user" | "anonymous";
    userId?: string;
  };
}

export const defaultPulseRealtimeConfig = {
  readingHeartbeatMs: 15_000,
  readingProgressThrottleMs: 4_000,
  readingProgressDeltaPercent: 10,
  sessionStorageKey: "pulse.realtime.sessionId",
  interactionActor: {
    kind: "anonymous" as const,
  },
};

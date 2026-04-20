export interface PulseRealtimeViewer {
  kind: "owner" | "user" | "anonymous";
  userId?: string;
}

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
  viewer?: PulseRealtimeViewer;
  interactionActor?: PulseRealtimeViewer;
}

export const defaultPulseRealtimeConfig = {
  debug: false,
  readingHeartbeatMs: 30_000,
  readingProgressThrottleMs: 4_000,
  readingProgressDeltaPercent: 10,
  sessionStorageKey: "pulse.realtime.sessionId",
  tabStorageKey: "pulse.realtime.tabId",
  viewer: {
    kind: "anonymous" as const,
  },
  interactionActor: {
    kind: "anonymous" as const,
  },
};

export function resolveConfigViewer(config: PulseRealtimeConfig): PulseRealtimeViewer {
  return config.viewer ?? config.interactionActor ?? defaultPulseRealtimeConfig.viewer;
}

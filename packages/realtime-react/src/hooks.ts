import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ChatEventEnvelope,
  ChatRoomSnapshot,
  ContentHistoryPoint,
  ContentLifetime,
  GlobalRoomSnapshot,
  InteractionState,
  OwnerHistoryPoint,
  OwnerLifetime,
  PageRoomSnapshot,
  RoomSnapshot,
  SiteHistoryPoint,
  SiteLifetime,
  StatsPeriod,
  WebEvent,
  WebPresence,
} from "@pulse/realtime-protocol";
import {
  isGlobalRoomSnapshot,
  isPageRoomSnapshot,
} from "@pulse/realtime-protocol";

import { usePulseRealtimeClient } from "./provider";
import type { RoomSubscriptionDebugState } from "./room-subscription-manager";
import { getOrCreateSessionId, getOrCreateTabId } from "./session";
import {
  selectChatRoom,
  selectGlobalStatus,
  selectOwnerFocusApp,
  selectOwnerMedia,
  selectOwnerStats,
  selectOwnerStatsSeries,
  selectOwnerStatus,
  selectPageStats,
  selectPageStatsSeries,
  selectPageStatus,
  selectSiteStats,
  selectSiteStatsSeries,
  type ChatRoom,
  type FocusStatus,
  type GlobalStatus,
  type MediaStatus,
  type OwnerStats,
  type OwnerStatus,
  type PageStats,
  type PageStatus,
  type QueryState,
  type SiteStats,
  type StatsQueryOptions,
  type StatsSeriesPoint,
} from "./user-api";

function useRefreshTrigger() {
  const [refreshKey, setRefreshKey] = useState(0);
  const refetch = useCallback(() => {
    setRefreshKey((current) => current + 1);
  }, []);
  return { refreshKey, refetch };
}

export function useGlobalPresenceSnapshot() {
  const client = usePulseRealtimeClient();
  const { refreshKey, refetch } = useRefreshTrigger();
  const [state, setState] = useState<{
    snapshot: GlobalRoomSnapshot | null;
    loading: boolean;
    error: string | null;
  }>({
    snapshot: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    setState((current) => ({ ...current, loading: true, error: null }));
    void client.subscriptions
      .subscribePresence(
        { capability: "presence", scope: "site", subject: "global" },
        (next) => {
          if (!isGlobalRoomSnapshot(next)) {
            setState((current) => ({
              ...current,
              loading: false,
              error: "unexpected_room_kind",
            }));
            return;
          }
          setState({
            snapshot: next,
            loading: false,
            error: null,
          });
        },
        (message) =>
          setState((current) => ({
            ...current,
            loading: false,
            error: message,
          })),
      )
      .then((unsubscribe) => {
        cleanup = unsubscribe;
      });

    return () => cleanup?.();
  }, [client, refreshKey]);

  return { ...state, refetch };
}

export function usePagePresenceSnapshot(canonicalUrl: string) {
  const client = usePulseRealtimeClient();
  const { refreshKey, refetch } = useRefreshTrigger();
  const [state, setState] = useState<{
    snapshot: PageRoomSnapshot | null;
    loading: boolean;
    error: string | null;
  }>({
    snapshot: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    setState((current) => ({ ...current, loading: true, error: null }));
    void client.subscriptions
      .subscribePresence(
        { capability: "presence", scope: "page", canonicalUrl },
        (next) => {
          if (!isPageRoomSnapshot(next)) {
            setState((current) => ({
              ...current,
              loading: false,
              error: "unexpected_room_kind",
            }));
            return;
          }
          setState({
            snapshot: next,
            loading: false,
            error: null,
          });
        },
        (message) =>
          setState((current) => ({
            ...current,
            loading: false,
            error: message,
          })),
      )
      .then((unsubscribe) => {
        cleanup = unsubscribe;
      });

    return () => cleanup?.();
  }, [client, canonicalUrl, refreshKey]);

  return { ...state, refetch };
}

function useChatRoomStream(options: {
  roomId: string;
  displayName: string;
  userId?: string;
}) {
  const client = usePulseRealtimeClient();
  const { refreshKey, refetch } = useRefreshTrigger();
  const [state, setState] = useState<{
    snapshot: ChatRoomSnapshot | null;
    events: ChatEventEnvelope[];
    loading: boolean;
    error: string | null;
  }>({
    snapshot: null,
    events: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    setState((current) => ({ ...current, loading: true, error: null }));
    void client.subscriptions
      .subscribeChatRoom(
        options.roomId,
        { displayName: options.displayName, userId: options.userId },
        (next) => {
          setState((current) => ({
            ...current,
            snapshot: next,
            loading: false,
            error: null,
          }));
        },
        (event) =>
          setState((current) => ({
            ...current,
            events: [...current.events.slice(-19), event],
          })),
        (message) =>
          setState((current) => ({
            ...current,
            loading: false,
            error: message,
          })),
      )
      .then((unsubscribe) => {
        cleanup = unsubscribe;
      });

    return () => cleanup?.();
  }, [client, options.displayName, options.roomId, options.userId, refreshKey]);

  return {
    ...state,
    refetch,
    sendMessage(content: string) {
      client.subscriptions.sendChatMessage(options.roomId, content);
    },
  };
}

export function useGlobalStatus(): QueryState<GlobalStatus> {
  const realtime = useGlobalPresenceSnapshot();
  const siteLifetime = useSiteLifetime();
  const data = useMemo(
    () =>
      realtime.snapshot
        ? selectGlobalStatus(realtime.snapshot, siteLifetime.data)
        : null,
    [realtime.snapshot, siteLifetime.data],
  );

  const refetch = useCallback(() => {
    realtime.refetch();
    siteLifetime.refetch();
  }, [realtime, siteLifetime]);

  return {
    data,
    loading: realtime.loading || siteLifetime.loading,
    error: realtime.error ?? siteLifetime.error,
    refetch,
  };
}

export function useOwnerStatus(): QueryState<OwnerStatus> {
  const realtime = useGlobalPresenceSnapshot();
  const data = useMemo(
    () => selectOwnerStatus(realtime.snapshot),
    [realtime.snapshot],
  );

  return {
    data,
    loading: realtime.loading,
    error: realtime.error,
    refetch: realtime.refetch,
  };
}

export function useOwnerFocusApp(): QueryState<FocusStatus> {
  const realtime = useGlobalPresenceSnapshot();
  const data = useMemo(
    () => selectOwnerFocusApp(realtime.snapshot),
    [realtime.snapshot],
  );

  return {
    data,
    loading: realtime.loading,
    error: realtime.error,
    refetch: realtime.refetch,
  };
}

export function useOwnerMedia(): QueryState<MediaStatus> {
  const realtime = useGlobalPresenceSnapshot();
  const data = useMemo(
    () => selectOwnerMedia(realtime.snapshot),
    [realtime.snapshot],
  );

  return {
    data,
    loading: realtime.loading,
    error: realtime.error,
    refetch: realtime.refetch,
  };
}

export function usePageStatus(canonicalUrl: string): QueryState<PageStatus> {
  const realtime = usePagePresenceSnapshot(canonicalUrl);
  const contentLifetime = useContentLifetime(canonicalUrl);
  const data = useMemo(
    () =>
      realtime.snapshot
        ? selectPageStatus(
            canonicalUrl,
            realtime.snapshot,
            contentLifetime.data,
          )
        : null,
    [canonicalUrl, contentLifetime.data, realtime.snapshot],
  );

  const refetch = useCallback(() => {
    realtime.refetch();
    contentLifetime.refetch();
  }, [contentLifetime, realtime]);

  return {
    data,
    loading: realtime.loading || contentLifetime.loading,
    error: realtime.error ?? contentLifetime.error,
    refetch,
  };
}

export function useChatRoom(options: {
  roomId: string;
  displayName: string;
  userId?: string;
}) {
  const room = useChatRoomStream(options);
  const data = useMemo(() => selectChatRoom(room.snapshot), [room.snapshot]);

  return {
    data,
    loading: room.loading,
    error: room.error,
    refetch: room.refetch,
    sendMessage: room.sendMessage,
  };
}

export function useRealtimeDebugState() {
  const client = usePulseRealtimeClient();
  const [state, setState] = useState<RoomSubscriptionDebugState>(() => ({
    transport: {
      status: "idle",
      selectedProtocol: null,
      capabilities: null,
      lastError: null,
      lastMessageType: null,
    },
    activeMode: "unknown",
    subscriptions: [],
    lastSnapshotMeta: null,
    meta: null,
    transports: [],
  }));

  useEffect(() => client.subscriptions.onDebugState(setState), [client]);
  return state;
}

export type PulseRealtimeConnectionStatus =
  RoomSubscriptionDebugState["transport"] & {
    activeMode: RoomSubscriptionDebugState["activeMode"];
    transportCount: number;
  };

export function selectRealtimeConnectionStatus(
  state: RoomSubscriptionDebugState,
): PulseRealtimeConnectionStatus {
  return {
    ...state.transport,
    activeMode: state.activeMode,
    transportCount: state.transports.length,
  };
}

export function useRealtimeConnectionStatus(): PulseRealtimeConnectionStatus {
  const state = useRealtimeDebugState();
  return useMemo(() => selectRealtimeConnectionStatus(state), [state]);
}

export function useInteractionStates() {
  const client = usePulseRealtimeClient();
  const [items, setItems] = useState<InteractionState[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return client.subscribeInteractionStream(
      (state) => {
        setItems((previous) => {
          const next = new Map(previous.map((item) => [item.requestId, item]));
          next.set(state.requestId, state);
          return Array.from(next.values()).sort(
            (left, right) =>
              Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
          );
        });
        setError(null);
      },
      (err) =>
        setError(
          err instanceof Error ? err.message : "interaction_stream_error",
        ),
    );
  }, [client]);

  return { items, error };
}

interface HistoryState<T> {
  data: T;
  loading: boolean;
  error: string | null;
}

export function useSiteHistory(options?: {
  period?: StatsPeriod;
  anchorDay?: string;
  limit?: number;
}) {
  const client = usePulseRealtimeClient();
  const { refreshKey, refetch } = useRefreshTrigger();
  const period = options?.period ?? "day";
  const anchorDay = options?.anchorDay ?? statsDayKey();
  const limit = options?.limit ?? 30;
  const [state, setState] = useState<HistoryState<SiteHistoryPoint[]>>({
    data: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    setState((current) => ({ ...current, loading: true, error: null }));

    void client.realtime
      .fetchSiteHistory(period, { anchorDay, limit })
      .then((data) => {
        if (cancelled) return;
        setState({ data, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          data: [],
          loading: false,
          error:
            error instanceof Error ? error.message : "site_history_unavailable",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [anchorDay, client, limit, period, refreshKey]);

  return { ...state, refetch };
}

export function useOwnerHistory(options?: {
  period?: StatsPeriod;
  anchorDay?: string;
  limit?: number;
}) {
  const client = usePulseRealtimeClient();
  const { refreshKey, refetch } = useRefreshTrigger();
  const period = options?.period ?? "day";
  const anchorDay = options?.anchorDay ?? statsDayKey();
  const limit = options?.limit ?? 30;
  const [state, setState] = useState<HistoryState<OwnerHistoryPoint[]>>({
    data: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    setState((current) => ({ ...current, loading: true, error: null }));

    void client.realtime
      .fetchOwnerHistory(period, { anchorDay, limit })
      .then((data) => {
        if (cancelled) return;
        setState({ data, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          data: [],
          loading: false,
          error:
            error instanceof Error
              ? error.message
              : "owner_history_unavailable",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [anchorDay, client, limit, period, refreshKey]);

  return { ...state, refetch };
}

export function useContentHistory(
  canonicalUrl: string,
  options?: {
    period?: StatsPeriod;
    anchorDay?: string;
    limit?: number;
  },
) {
  const client = usePulseRealtimeClient();
  const { refreshKey, refetch } = useRefreshTrigger();
  const period = options?.period ?? "day";
  const anchorDay = options?.anchorDay ?? statsDayKey();
  const limit = options?.limit ?? 30;
  const [state, setState] = useState<HistoryState<ContentHistoryPoint[]>>({
    data: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    setState((current) => ({ ...current, loading: true, error: null }));

    void client.realtime
      .fetchContentHistory(canonicalUrl, period, { anchorDay, limit })
      .then((data) => {
        if (cancelled) return;
        setState({ data, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          data: [],
          loading: false,
          error:
            error instanceof Error
              ? error.message
              : "content_history_unavailable",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [anchorDay, canonicalUrl, client, limit, period, refreshKey]);

  return { ...state, refetch };
}

export function useSiteLifetime() {
  const client = usePulseRealtimeClient();
  const { refreshKey, refetch } = useRefreshTrigger();
  const [state, setState] = useState<HistoryState<SiteLifetime | null>>({
    data: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    void client.realtime
      .fetchSiteLifetime()
      .then((data) => {
        if (cancelled) return;
        setState({ data, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          data: null,
          loading: false,
          error:
            error instanceof Error
              ? error.message
              : "site_lifetime_unavailable",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [client, refreshKey]);

  return { ...state, refetch };
}

export function useOwnerLifetime() {
  const client = usePulseRealtimeClient();
  const { refreshKey, refetch } = useRefreshTrigger();
  const [state, setState] = useState<HistoryState<OwnerLifetime | null>>({
    data: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    void client.realtime
      .fetchOwnerLifetime()
      .then((data) => {
        if (cancelled) return;
        setState({ data, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          data: null,
          loading: false,
          error:
            error instanceof Error
              ? error.message
              : "owner_lifetime_unavailable",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [client, refreshKey]);

  return { ...state, refetch };
}

export function useContentLifetime(canonicalUrl: string) {
  const client = usePulseRealtimeClient();
  const { refreshKey, refetch } = useRefreshTrigger();
  const [state, setState] = useState<HistoryState<ContentLifetime | null>>({
    data: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    void client.realtime
      .fetchContentLifetime(canonicalUrl)
      .then((data) => {
        if (cancelled) return;
        setState({ data, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          data: null,
          loading: false,
          error:
            error instanceof Error
              ? error.message
              : "content_lifetime_unavailable",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [canonicalUrl, client, refreshKey]);

  return { ...state, refetch };
}

export function useSiteStats(options?: StatsQueryOptions): {
  history: StatsSeriesPoint<SiteStats>[];
  lifetime: SiteStats | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
} {
  const history = useSiteHistory(options);
  const lifetime = useSiteLifetime();

  const refetch = useCallback(() => {
    history.refetch();
    lifetime.refetch();
  }, [history, lifetime]);

  return {
    history: useMemo(() => selectSiteStatsSeries(history.data), [history.data]),
    lifetime: useMemo(() => selectSiteStats(lifetime.data), [lifetime.data]),
    loading: history.loading || lifetime.loading,
    error: history.error ?? lifetime.error,
    refetch,
  };
}

export function useOwnerStats(options?: StatsQueryOptions): {
  history: StatsSeriesPoint<OwnerStats>[];
  lifetime: OwnerStats | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
} {
  const history = useOwnerHistory(options);
  const lifetime = useOwnerLifetime();

  const refetch = useCallback(() => {
    history.refetch();
    lifetime.refetch();
  }, [history, lifetime]);

  return {
    history: useMemo(
      () => selectOwnerStatsSeries(history.data),
      [history.data],
    ),
    lifetime: useMemo(() => selectOwnerStats(lifetime.data), [lifetime.data]),
    loading: history.loading || lifetime.loading,
    error: history.error ?? lifetime.error,
    refetch,
  };
}

export function usePageStats(
  canonicalUrl: string,
  options?: StatsQueryOptions,
): {
  history: StatsSeriesPoint<PageStats>[];
  lifetime: PageStats | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
} {
  const history = useContentHistory(canonicalUrl, options);
  const lifetime = useContentLifetime(canonicalUrl);

  const refetch = useCallback(() => {
    history.refetch();
    lifetime.refetch();
  }, [history, lifetime]);

  return {
    history: useMemo(() => selectPageStatsSeries(history.data), [history.data]),
    lifetime: useMemo(() => selectPageStats(lifetime.data), [lifetime.data]),
    loading: history.loading || lifetime.loading,
    error: history.error ?? lifetime.error,
    refetch,
  };
}

export function usePresenceState() {
  const [presence, setPresence] = useState<WebPresence["state"]>("active");
  const [visibility, setVisibility] = useState<WebPresence["visibility"]>(
    typeof document !== "undefined" && document.visibilityState === "visible"
      ? "visible"
      : "hidden",
  );
  const lastActivityRef = useRef(Date.now());

  useEffect(() => {
    const markActive = () => {
      lastActivityRef.current = Date.now();
      if (document.visibilityState === "visible") {
        setPresence("active");
      }
    };

    const onVisibility = () => {
      const nextVisibility =
        document.visibilityState === "visible" ? "visible" : "hidden";
      setVisibility(nextVisibility);
      setPresence(nextVisibility === "hidden" ? "hidden" : "active");
      lastActivityRef.current = Date.now();
    };

    const interval = window.setInterval(() => {
      if (!navigator.onLine) return setPresence("offline");
      if (document.visibilityState !== "visible") return setPresence("hidden");
      const idleFor = Date.now() - lastActivityRef.current;
      setPresence(idleFor >= 60_000 ? "idle" : "active");
    }, 5_000);

    const events: Array<keyof WindowEventMap> = [
      "mousemove",
      "keydown",
      "pointerdown",
      "scroll",
    ];
    for (const event of events)
      window.addEventListener(event, markActive, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(interval);
      for (const event of events) window.removeEventListener(event, markActive);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return { presence, visibility };
}

interface ReadingContext {
  title: string;
  url: string;
  canonicalUrl: string;
}

export function usePagePresence(
  page: ReadingContext,
  options?: { trackReading?: boolean },
) {
  const client = usePulseRealtimeClient();
  const sessionId = useMemo(
    () => getOrCreateSessionId(client.config),
    [client],
  );
  const tabId = useMemo(() => getOrCreateTabId(client.config), [client]);
  const { presence, visibility } = usePresenceState();
  const presenceRef = useRef(presence);
  const visibilityRef = useRef(visibility);
  const seqRef = useRef(0);
  const lastProgressSentAtRef = useRef(0);
  const lastProgressRef = useRef<number | null>(null);
  const lastHeartbeatPresenceRef = useRef<string | null>(null);
  const lastHeartbeatVisibilityRef = useRef<string | null>(null);
  const heartbeatEvent = (trackReading: boolean) =>
    client.ingestWebEvents([buildEvent("heartbeat", trackReading)], {
      sessionId,
      tabId,
    });

  useEffect(() => {
    presenceRef.current = presence;
    visibilityRef.current = visibility;
  }, [presence, visibility]);

  useEffect(() => {
    client.setPresenceContext({
      sessionId,
      tabId,
      page: {
        title: page.title,
        url: page.url,
        canonicalUrl: page.canonicalUrl,
      },
    });
  }, [client, page.canonicalUrl, page.title, page.url, sessionId, tabId]);

  const buildEvent = (
    kind: WebEvent["kind"],
    includeReading = false,
  ): WebEvent => {
    const now = new Date().toISOString();
    const progress = computeReadingProgress();
    return {
      eventId: `${sessionId}:${tabId}:${++seqRef.current}:${kind}`,
      seq: seqRef.current,
      kind,
      observedAt: now,
      sentAt: now,
      page: {
        title: page.title,
        url: page.url,
        canonicalUrl: page.canonicalUrl,
      },
      reading: includeReading
        ? {
            progressPercent: progress,
            scrollY: window.scrollY,
          }
        : undefined,
      presence: {
        state: presenceRef.current,
        visibility: visibilityRef.current,
      },
    };
  };

  useEffect(() => {
    const trackReading = options?.trackReading ?? false;
    void client.ingestWebEvents([buildEvent("page_view", trackReading)], {
      sessionId,
      tabId,
    });
    lastProgressRef.current = trackReading ? computeReadingProgress() : null;
    lastHeartbeatPresenceRef.current = presenceRef.current;
    lastHeartbeatVisibilityRef.current = visibilityRef.current;

    const onScroll = () => {
      if (!trackReading) return;
      const progress = computeReadingProgress();
      const now = Date.now();
      const previousProgress = lastProgressRef.current ?? progress;
      const progressDelta = Math.abs(progress - previousProgress);
      if (progressDelta < (client.config.readingProgressDeltaPercent ?? 10))
        return;
      if (
        now - lastProgressSentAtRef.current <
        (client.config.readingProgressThrottleMs ?? 4_000)
      )
        return;
      lastProgressSentAtRef.current = now;
      lastProgressRef.current = progress;
      void client.ingestWebEvents([buildEvent("reading_progress", true)], {
        sessionId,
        tabId,
      });
    };

    const heartbeat = window.setInterval(() => {
      lastHeartbeatPresenceRef.current = presenceRef.current;
      lastHeartbeatVisibilityRef.current = visibilityRef.current;
      void heartbeatEvent(trackReading);
    }, client.config.readingHeartbeatMs ?? 30_000);

    const endSession = () => {
      const event = buildEvent("session_end", trackReading);
      const beaconSent = client.ingestWebEventsBeacon([event], {
        sessionId,
        tabId,
      });
      if (!beaconSent) {
        void client.ingestWebEvents([event], {
          keepalive: true,
          sessionId,
          tabId,
        });
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("beforeunload", endSession);
    window.addEventListener("pagehide", endSession);

    return () => {
      window.clearInterval(heartbeat);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("beforeunload", endSession);
      window.removeEventListener("pagehide", endSession);
      endSession();
    };
  }, [
    client,
    options?.trackReading,
    page.canonicalUrl,
    page.title,
    page.url,
    sessionId,
    tabId,
  ]);

  useEffect(() => {
    const trackReading = options?.trackReading ?? false;
    if (
      lastHeartbeatPresenceRef.current == null ||
      lastHeartbeatVisibilityRef.current == null
    ) {
      return;
    }
    if (
      lastHeartbeatPresenceRef.current === presence &&
      lastHeartbeatVisibilityRef.current === visibility
    ) {
      return;
    }
    lastHeartbeatPresenceRef.current = presence;
    lastHeartbeatVisibilityRef.current = visibility;
    void heartbeatEvent(trackReading);
  }, [client, options?.trackReading, presence, visibility]);
}

export function useTrackPagePresence(
  page: ReadingContext,
  options?: { trackReading?: boolean },
) {
  return usePagePresence(page, options);
}

function statsDayKey() {
  return new Date().toISOString().slice(0, 10);
}

function computeReadingProgress() {
  if (typeof window === "undefined" || typeof document === "undefined")
    return 0;
  const scrollHeight =
    document.documentElement.scrollHeight - window.innerHeight;
  if (scrollHeight <= 0) return 100;
  const progress = (window.scrollY / scrollHeight) * 100;
  return Math.min(100, Math.max(0, Math.round(progress)));
}

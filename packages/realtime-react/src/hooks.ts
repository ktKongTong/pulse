import { useEffect, useMemo, useRef, useState } from "react";
import type {
  DeviceAggregate,
  DeviceAggregateHistoryPoint,
  InteractionState,
  PageAggregate,
  PageAggregateHistoryPoint,
  RoomAggregate,
  RoomAggregateHistoryPoint,
  RoomSnapshot,
  StatsPeriod,
  StatsSummary,
  StatsSummaryHistoryPoint,
  WebEvent,
  WebPresence,
} from "@pulse/realtime-protocol";

import { usePulseRealtimeClient } from "./provider";
import type { RoomSubscriptionDebugState } from "./room-subscription-manager";
import { getOrCreateSessionId } from "./session";

export function useRoomSnapshot(roomId: string) {
  const client = usePulseRealtimeClient();
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    void client.subscriptions
      .subscribeRawRoom(
        roomId,
        (next) => {
          setSnapshot(next);
          setError(null);
        },
        (message) => setError(message),
      )
      .then((unsubscribe) => {
        cleanup = unsubscribe;
      });

    return () => cleanup?.();
  }, [client, roomId]);

  return { snapshot, error };
}

export function useGlobalPresenceSnapshot() {
  const client = usePulseRealtimeClient();
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    void client.subscriptions
      .subscribePresence(
        { capability: "presence", scope: "site", subject: "global" },
        (next) => {
          setSnapshot(next);
          setError(null);
        },
        (message) => setError(message),
      )
      .then((unsubscribe) => {
        cleanup = unsubscribe;
      });
    return () => cleanup?.();
  }, [client]);

  return { snapshot, error };
}

export function usePagePresenceSnapshot(canonicalUrl: string) {
  const client = usePulseRealtimeClient();
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    void client.subscriptions
      .subscribePresence(
        { capability: "presence", scope: "page", canonicalUrl },
        (next) => {
          setSnapshot(next);
          setError(null);
        },
        (message) => setError(message),
      )
      .then((unsubscribe) => {
        cleanup = unsubscribe;
      });
    return () => cleanup?.();
  }, [client, canonicalUrl]);

  return { snapshot, error };
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
    statsSubscriptions: [],
    lastSnapshotMeta: null,
    lastStatsMeta: null,
    meta: null,
  }));

  useEffect(() => client.subscriptions.onDebugState(setState), [client]);
  return state;
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

interface StatusAggregatesState {
  day: string;
  global: StatsSummary | null;
  device: DeviceAggregate | null;
  pages: PageAggregate[];
  rooms: RoomAggregate[];
  loading: boolean;
  error: string | null;
}

interface StatusAggregateHistoryState {
  period: StatsPeriod;
  anchorDay: string;
  global: StatsSummaryHistoryPoint[];
  device: DeviceAggregateHistoryPoint[];
  pages: PageAggregateHistoryPoint[];
  rooms: RoomAggregateHistoryPoint[];
  loading: boolean;
  error: string | null;
}

export function useStatusAggregates(deviceId?: string | null) {
  const client = usePulseRealtimeClient();
  const [state, setState] = useState<StatusAggregatesState>(() => ({
    day: statsDayKey(),
    global: null,
    device: null,
    pages: [],
    rooms: [],
    loading: true,
    error: null,
  }));

  useEffect(() => {
    let globalCleanup: (() => void) | undefined;
    let deviceCleanup: (() => void) | undefined;
    let pagesCleanup: (() => void) | undefined;
    let roomsCleanup: (() => void) | undefined;
    const day = statsDayKey();

    setState((current) => ({ ...current, day, loading: true, error: null }));

    void client.subscriptions
      .subscribeGlobalStats(
        day,
        (payload) =>
          setState((current) => ({
            ...current,
            day,
            global: payload,
            loading: false,
            error: null,
          })),
        (message) =>
          setState((current) => ({
            ...current,
            loading: false,
            error: message,
          })),
      )
      .then((unsubscribe) => {
        globalCleanup = unsubscribe;
      });

    void client.subscriptions
      .subscribePageStats(
        day,
        5,
        (payload) =>
          setState((current) => ({
            ...current,
            day,
            pages: payload,
            loading: false,
            error: null,
          })),
        (message) =>
          setState((current) => ({
            ...current,
            loading: false,
            error: message,
          })),
      )
      .then((unsubscribe) => {
        pagesCleanup = unsubscribe;
      });

    void client.subscriptions
      .subscribeRoomStats(
        day,
        5,
        (payload) =>
          setState((current) => ({
            ...current,
            day,
            rooms: payload,
            loading: false,
            error: null,
          })),
        (message) =>
          setState((current) => ({
            ...current,
            loading: false,
            error: message,
          })),
      )
      .then((unsubscribe) => {
        roomsCleanup = unsubscribe;
      });

    if (deviceId) {
      void client.subscriptions
        .subscribeDeviceStats(
          day,
          deviceId,
          (payload) =>
            setState((current) => ({
              ...current,
              day,
              device: payload,
              loading: false,
              error: null,
            })),
          (message) =>
            setState((current) => ({
              ...current,
              loading: false,
              error: message,
            })),
        )
        .then((unsubscribe) => {
          deviceCleanup = unsubscribe;
        });
    } else {
      setState((current) => ({ ...current, device: null }));
    }

    return () => {
      globalCleanup?.();
      deviceCleanup?.();
      pagesCleanup?.();
      roomsCleanup?.();
    };
  }, [client, deviceId]);

  return state;
}

export function useStatusAggregateHistory(options?: {
  deviceId?: string | null;
  period?: Exclude<StatsPeriod, "week">;
  anchorDay?: string;
  limit?: number;
  itemLimit?: number;
}) {
  const client = usePulseRealtimeClient();
  const period = options?.period ?? "day";
  const anchorDay = options?.anchorDay ?? statsDayKey();
  const limit =
    options?.limit ?? (period === "day" ? 30 : period === "month" ? 12 : 5);
  const itemLimit = options?.itemLimit ?? 5;
  const deviceId = options?.deviceId ?? null;

  const [state, setState] = useState<StatusAggregateHistoryState>(() => ({
    period,
    anchorDay,
    global: [],
    device: [],
    pages: [],
    rooms: [],
    loading: true,
    error: null,
  }));

  useEffect(() => {
    let cancelled = false;

    setState((current) => ({
      ...current,
      period,
      anchorDay,
      loading: true,
      error: null,
    }));

    void Promise.all([
      client.realtime.fetchGlobalHistory(period, { limit, anchorDay }),
      client.realtime.fetchPageHistory(period, { limit, itemLimit, anchorDay }),
      client.realtime.fetchRoomHistory(period, { limit, itemLimit, anchorDay }),
      deviceId
        ? client.realtime.fetchDeviceHistory(deviceId, period, {
            limit,
            anchorDay,
          })
        : Promise.resolve([] as DeviceAggregateHistoryPoint[]),
    ])
      .then(([global, pages, rooms, device]) => {
        if (cancelled) return;
        setState({
          period,
          anchorDay,
          global,
          pages,
          rooms,
          device,
          loading: false,
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState((current) => ({
          ...current,
          period,
          anchorDay,
          loading: false,
          error:
            error instanceof Error
              ? error.message
              : "stats_history_unavailable",
        }));
      });

    return () => {
      cancelled = true;
    };
  }, [anchorDay, client, deviceId, itemLimit, limit, period]);

  return state;
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
  const { presence, visibility } = usePresenceState();
  const presenceRef = useRef(presence);
  const visibilityRef = useRef(visibility);
  const seqRef = useRef(0);
  const lastProgressSentAtRef = useRef(0);
  const lastProgressRef = useRef<number | null>(null);
  const lastHeartbeatPresenceRef = useRef<string | null>(null);
  const lastHeartbeatVisibilityRef = useRef<string | null>(null);

  useEffect(() => {
    presenceRef.current = presence;
    visibilityRef.current = visibility;
  }, [presence, visibility]);

  const buildEvent = (
    kind: WebEvent["kind"],
    includeReading = false,
  ): WebEvent => {
    const now = new Date().toISOString();
    const progress = computeReadingProgress();
    return {
      eventId: `${sessionId}:${++seqRef.current}:${kind}`,
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
    void client.ingestWebEvents([buildEvent("page_view", trackReading)]);
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
      void client.ingestWebEvents([buildEvent("reading_progress", true)]);
    };

    const heartbeat = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        const presenceChanged =
          lastHeartbeatPresenceRef.current !== presenceRef.current;
        const visibilityChanged =
          lastHeartbeatVisibilityRef.current !== visibilityRef.current;
        if (!presenceChanged && !visibilityChanged) return;
        lastHeartbeatPresenceRef.current = presenceRef.current;
        lastHeartbeatVisibilityRef.current = visibilityRef.current;
        void client.ingestWebEvents([buildEvent("heartbeat", trackReading)]);
      }
    }, client.config.readingHeartbeatMs ?? 15_000);

    const endSession = () => {
      void client.ingestWebEvents([buildEvent("session_end", trackReading)], {
        keepalive: true,
      });
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
  ]);
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

function statsDayKey() {
  return new Date().toISOString().slice(0, 10);
}

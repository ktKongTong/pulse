import { useEffect, useMemo, useRef, useState } from "react";
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

export function useGlobalPresenceSnapshot() {
  const client = usePulseRealtimeClient();
  const [snapshot, setSnapshot] = useState<GlobalRoomSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    void client.subscriptions
      .subscribePresence(
        { capability: "presence", scope: "site", subject: "global" },
        (next) => {
          if (!isGlobalRoomSnapshot(next)) {
            setError("unexpected_room_kind");
            return;
          }
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
  const [snapshot, setSnapshot] = useState<PageRoomSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    void client.subscriptions
      .subscribePresence(
        { capability: "presence", scope: "page", canonicalUrl },
        (next) => {
          if (!isPageRoomSnapshot(next)) {
            setError("unexpected_room_kind");
            return;
          }
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

export function useChatRoom(options: {
  roomId: string;
  displayName: string;
  userId?: string;
}) {
  const client = usePulseRealtimeClient();
  const [snapshot, setSnapshot] = useState<ChatRoomSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<ChatEventEnvelope[]>([]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    void client.subscriptions
      .subscribeChatRoom(
        options.roomId,
        { displayName: options.displayName, userId: options.userId },
        (next) => {
          setSnapshot(next);
          setError(null);
        },
        (event) => setEvents((previous) => [...previous.slice(-19), event]),
        (message) => setError(message),
      )
      .then((unsubscribe) => {
        cleanup = unsubscribe;
      });

    return () => cleanup?.();
  }, [client, options.displayName, options.roomId, options.userId]);

  return {
    snapshot,
    events,
    error,
    sendMessage(content: string) {
      client.subscriptions.sendChatMessage(options.roomId, content);
    },
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
          error: error instanceof Error ? error.message : "site_history_unavailable",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [anchorDay, client, limit, period]);

  return state;
}

export function useOwnerHistory(options?: {
  period?: StatsPeriod;
  anchorDay?: string;
  limit?: number;
}) {
  const client = usePulseRealtimeClient();
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
          error: error instanceof Error ? error.message : "owner_history_unavailable",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [anchorDay, client, limit, period]);

  return state;
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
          error: error instanceof Error ? error.message : "content_history_unavailable",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [anchorDay, canonicalUrl, client, limit, period]);

  return state;
}

export function useSiteLifetime() {
  const client = usePulseRealtimeClient();
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
          error: error instanceof Error ? error.message : "site_lifetime_unavailable",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [client]);

  return state;
}

export function useOwnerLifetime() {
  const client = usePulseRealtimeClient();
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
          error: error instanceof Error ? error.message : "owner_lifetime_unavailable",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [client]);

  return state;
}

export function useContentLifetime(canonicalUrl: string) {
  const client = usePulseRealtimeClient();
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
          error: error instanceof Error ? error.message : "content_lifetime_unavailable",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [canonicalUrl, client]);

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
    client.ingestWebEvents([buildEvent("heartbeat", trackReading)]);

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
      lastHeartbeatPresenceRef.current = presenceRef.current;
      lastHeartbeatVisibilityRef.current = visibilityRef.current;
      void heartbeatEvent(trackReading);
    }, client.config.readingHeartbeatMs ?? 30_000);

    const endSession = () => {
      const event = buildEvent("session_end", trackReading);
      const beaconSent = client.ingestWebEventsBeacon([event]);
      if (!beaconSent) {
        void client.ingestWebEvents([event], {
          keepalive: true,
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

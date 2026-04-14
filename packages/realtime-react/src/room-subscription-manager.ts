import type {
  DeviceAggregate,
  PageAggregate,
  RealtimeMetaResponse,
  RealtimeSnapshotEnvelope,
  RealtimeStatsEnvelope,
  RealtimeStatsSubscription,
  RoomAggregate,
  RoomSnapshot,
  StatsSummary,
} from "@pulse/realtime-protocol";
import { RealtimeMetaResponseSchema } from "@pulse/realtime-protocol";

import type { PulseRealtimeConfig } from "./types";
import type { PresenceSubscriptionIntent } from "./room-resolver";
import { presenceSubscriptionKey, resolveRoomId } from "./room-resolver";
import { fetchRealtimeMeta, subscribeRoomLegacy } from "./realtime";
import type { RealtimeTransportState } from "./realtime-transport";
import { RealtimeTransport } from "./realtime-transport";

type SnapshotListener = (snapshot: RoomSnapshot) => void;
type StatsPayloadByTarget = {
  global: StatsSummary;
  device: DeviceAggregate | null;
  pages: PageAggregate[];
  rooms: RoomAggregate[];
};
type UntypedStatsListener = (payload: unknown) => void;
type ErrorListener = (error: string) => void;
type DebugListener = (state: RoomSubscriptionDebugState) => void;

interface ActiveRoomSubscription {
  key: string;
  roomId: string;
  subscriptionId: string;
  refCount: number;
  mode: "ws" | "sse";
  listeners: Set<SnapshotListener>;
  errorListeners: Set<ErrorListener>;
  legacyUnsubscribe?: () => void;
}

interface ActiveStatsSubscription {
  key: string;
  subscriptionId: string;
  refCount: number;
  request: RealtimeStatsSubscription;
  listeners: Set<UntypedStatsListener>;
  errorListeners: Set<ErrorListener>;
}

export interface RoomSubscriptionDebugState {
  transport: RealtimeTransportState;
  activeMode: "ws" | "sse" | "unknown";
  subscriptions: Array<{
    key: string;
    roomId: string;
    subscriptionId: string;
    refCount: number;
    mode: "ws" | "sse";
  }>;
  statsSubscriptions: Array<{
    key: string;
    subscriptionId: string;
    target: RealtimeStatsSubscription["target"];
  }>;
  lastSnapshotMeta: {
    roomId: string;
    subscriptionId: string;
    revision: number;
    updatedAt: string;
  } | null;
  lastStatsMeta: {
    subscriptionId: string;
    target: RealtimeStatsSubscription["target"];
    day: string;
  } | null;
  meta: RealtimeMetaResponse | null;
}

export class RoomSubscriptionManager {
  private transport: RealtimeTransport;
  private subscriptions = new Map<string, ActiveRoomSubscription>();
  private statsSubscriptions = new Map<string, ActiveStatsSubscription>();
  private subscriptionIdCounter = 0;
  private metaPromise: Promise<RealtimeMetaResponse> | null = null;
  private resolvedMeta: RealtimeMetaResponse | null = null;
  private lastSnapshotMeta: RoomSubscriptionDebugState["lastSnapshotMeta"] = null;
  private lastStatsMeta: RoomSubscriptionDebugState["lastStatsMeta"] = null;
  private debugListeners = new Set<DebugListener>();

  constructor(private readonly config: PulseRealtimeConfig) {
    this.transport = new RealtimeTransport(config);
    this.transport.onMessage((message) => {
      if (message.type === "snapshot") return this.handleSnapshot(message);
      if (message.type === "stats") return this.handleStats(message);
      if (message.type === "stats_error") return this.handleStatsError(message.subscriptionId, message.message);
      if (message.type === "error") this.handleError(message.subscriptionId, message.message);
    });
    this.transport.onReady(() => {
      for (const subscription of this.subscriptions.values()) {
        if (subscription.mode === "ws") {
          this.transport.send({
            protocol: "realtime.ws.v1",
            type: "subscribe",
            subscriptions: [{ subscriptionId: subscription.subscriptionId, roomId: subscription.roomId }],
          });
        }
      }
      for (const subscription of this.statsSubscriptions.values()) {
        this.transport.send({
          protocol: "realtime.ws.v1",
          type: "subscribe_stats",
          subscriptions: [subscription.request],
        });
      }
      this.emitDebugState();
    });
    this.transport.onState(() => this.emitDebugState());
  }

  async subscribePresence(intent: PresenceSubscriptionIntent, onSnapshot: SnapshotListener, onError?: ErrorListener) {
    const key = presenceSubscriptionKey(intent);
    const roomId = resolveRoomId(intent);
    return this.subscribeRawRoomInternal(key, roomId, onSnapshot, onError);
  }

  async subscribeRawRoom(roomId: string, onSnapshot: SnapshotListener, onError?: ErrorListener) {
    return this.subscribeRawRoomInternal(`raw:${roomId}`, roomId, onSnapshot, onError);
  }

  async subscribeGlobalStats(day: string, onStats: (payload: StatsPayloadByTarget["global"]) => void, onError?: ErrorListener) {
    return this.subscribeStats<"global">({ target: "global", day }, onStats, onError);
  }

  async subscribeDeviceStats(day: string, deviceId: string, onStats: (payload: StatsPayloadByTarget["device"]) => void, onError?: ErrorListener) {
    return this.subscribeStats<"device">({ target: "device", day, deviceId }, onStats, onError);
  }

  async subscribePageStats(day: string, limit: number, onStats: (payload: StatsPayloadByTarget["pages"]) => void, onError?: ErrorListener) {
    return this.subscribeStats<"pages">({ target: "pages", day, limit }, onStats, onError);
  }

  async subscribeRoomStats(day: string, limit: number, onStats: (payload: StatsPayloadByTarget["rooms"]) => void, onError?: ErrorListener) {
    return this.subscribeStats<"rooms">({ target: "rooms", day, limit }, onStats, onError);
  }

  onDebugState(handler: DebugListener): () => void {
    this.debugListeners.add(handler);
    handler(this.currentDebugState());
    return () => this.debugListeners.delete(handler);
  }

  dispose() {
    this.transport.disconnect();
  }

  private async subscribeRawRoomInternal(
    key: string,
    roomId: string,
    onSnapshot: SnapshotListener,
    onError?: ErrorListener
  ): Promise<() => void> {
    const existing = this.subscriptions.get(key);
    if (existing) {
      existing.refCount += 1;
      existing.listeners.add(onSnapshot);
      if (onError) existing.errorListeners.add(onError);
      this.emitDebugState();
      return () => this.unsubscribe(key, onSnapshot, onError);
    }

    const subscription: ActiveRoomSubscription = {
      key,
      roomId,
      subscriptionId: `sub-${++this.subscriptionIdCounter}`,
      refCount: 1,
      mode: "sse",
      listeners: new Set([onSnapshot]),
      errorListeners: onError ? new Set([onError]) : new Set(),
    };
    this.subscriptions.set(key, subscription);

    try {
      const meta = await this.meta();
      const useWs = meta.streamProtocols.includes("realtime.ws.v1") && meta.capabilities.presence && meta.capabilities.multiRoom;
      if (useWs) {
        subscription.mode = "ws";
        this.transport.connect();
        if (this.transport.isReady) {
          this.transport.send({
            protocol: "realtime.ws.v1",
            type: "subscribe",
            subscriptions: [{ subscriptionId: subscription.subscriptionId, roomId }],
          });
        }
      } else {
        subscription.legacyUnsubscribe = subscribeRoomLegacy(
          this.config,
          roomId,
          (snapshot) => subscription.listeners.forEach((listener) => listener(snapshot)),
          (error) => subscription.errorListeners.forEach((listener) => listener(error instanceof Error ? error.message : "stream_error"))
        );
      }
    } catch (error) {
      subscription.mode = "sse";
      subscription.legacyUnsubscribe = subscribeRoomLegacy(
        this.config,
        roomId,
        (snapshot) => subscription.listeners.forEach((listener) => listener(snapshot)),
        (rawError) => subscription.errorListeners.forEach((listener) => listener(rawError instanceof Error ? rawError.message : "stream_error"))
      );
      subscription.errorListeners.forEach((listener) => listener(error instanceof Error ? error.message : "meta_error"));
    }

    this.emitDebugState();
    return () => this.unsubscribe(key, onSnapshot, onError);
  }

  private async subscribeStats<T extends keyof StatsPayloadByTarget>(
    request: Omit<RealtimeStatsSubscription, "subscriptionId"> & { target: T },
    onStats: (payload: StatsPayloadByTarget[T]) => void,
    onError?: ErrorListener
  ): Promise<() => void> {
    const key = statsSubscriptionKey(request);
    const existing = this.statsSubscriptions.get(key);
    if (existing) {
      existing.refCount += 1;
      existing.listeners.add(onStats as UntypedStatsListener);
      if (onError) existing.errorListeners.add(onError);
      this.emitDebugState();
      return () => this.unsubscribeStats(key, onStats as UntypedStatsListener, onError);
    }

    const subscription: ActiveStatsSubscription = {
      key,
      subscriptionId: `stats-${++this.subscriptionIdCounter}`,
      refCount: 1,
      request: { ...request, subscriptionId: `stats-${this.subscriptionIdCounter}` },
      listeners: new Set([onStats as UntypedStatsListener]),
      errorListeners: onError ? new Set([onError]) : new Set(),
    };
    this.statsSubscriptions.set(key, subscription);

    try {
      const meta = await this.meta();
      const useWs = meta.streamProtocols.includes("realtime.ws.v1") && meta.capabilities.presence && meta.capabilities.multiRoom && meta.capabilities.statsPush;
      if (!useWs) throw new Error("stats_push_not_supported");
      this.transport.connect();
      if (this.transport.isReady) {
        this.transport.send({
          protocol: "realtime.ws.v1",
          type: "subscribe_stats",
          subscriptions: [subscription.request],
        });
      }
    } catch (error) {
      this.statsSubscriptions.delete(key);
      subscription.errorListeners.forEach((listener) => listener(error instanceof Error ? error.message : "stats_meta_error"));
      if (this.subscriptions.size === 0 && this.statsSubscriptions.size === 0) {
        this.transport.disconnect();
      }
    }

    this.emitDebugState();
    return () => this.unsubscribeStats(key, onStats as UntypedStatsListener, onError);
  }

  private unsubscribe(key: string, onSnapshot: SnapshotListener, onError?: ErrorListener) {
    const subscription = this.subscriptions.get(key);
    if (!subscription) return;
    subscription.refCount -= 1;
    subscription.listeners.delete(onSnapshot);
    if (onError) subscription.errorListeners.delete(onError);
    if (subscription.refCount > 0) {
      this.emitDebugState();
      return;
    }
    if (subscription.legacyUnsubscribe) {
      subscription.legacyUnsubscribe();
    } else {
      this.transport.send({
        protocol: "realtime.ws.v1",
        type: "unsubscribe",
        subscriptionIds: [subscription.subscriptionId],
      });
    }
    this.subscriptions.delete(key);
    if (this.subscriptions.size === 0 && this.statsSubscriptions.size === 0) {
      this.transport.disconnect();
    }
    this.emitDebugState();
  }

  private unsubscribeStats(key: string, onStats: UntypedStatsListener, onError?: ErrorListener) {
    const subscription = this.statsSubscriptions.get(key);
    if (!subscription) return;
    subscription.refCount -= 1;
    subscription.listeners.delete(onStats);
    if (onError) subscription.errorListeners.delete(onError);
    if (subscription.refCount > 0) {
      this.emitDebugState();
      return;
    }
    this.transport.send({
      protocol: "realtime.ws.v1",
      type: "unsubscribe_stats",
      subscriptionIds: [subscription.subscriptionId],
    });
    this.statsSubscriptions.delete(key);
    if (this.subscriptions.size === 0 && this.statsSubscriptions.size === 0) {
      this.transport.disconnect();
    }
    this.emitDebugState();
  }

  private handleSnapshot(message: RealtimeSnapshotEnvelope) {
    const subscription = [...this.subscriptions.values()].find((item) => item.subscriptionId === message.subscriptionId);
    if (!subscription) return;
    this.lastSnapshotMeta = {
      roomId: message.roomId,
      subscriptionId: message.subscriptionId,
      revision: message.payload.revision,
      updatedAt: message.payload.updatedAt,
    };
    this.emitDebugState();
    subscription.listeners.forEach((listener) => listener(message.payload));
  }

  private handleStats(message: RealtimeStatsEnvelope) {
    const subscription = [...this.statsSubscriptions.values()].find((item) => item.subscriptionId === message.subscriptionId);
    if (!subscription) return;
    this.lastStatsMeta = {
      subscriptionId: message.subscriptionId,
      target: message.target,
      day: message.day,
    };
    this.emitDebugState();
    subscription.listeners.forEach((listener) => listener(message.payload));
  }

  private handleError(subscriptionId: string | undefined, error: string) {
    if (!subscriptionId) return;
    const subscription = [...this.subscriptions.values()].find((item) => item.subscriptionId === subscriptionId);
    subscription?.errorListeners.forEach((listener) => listener(error));
    this.emitDebugState();
  }

  private handleStatsError(subscriptionId: string | undefined, error: string) {
    if (!subscriptionId) return;
    const subscription = [...this.statsSubscriptions.values()].find((item) => item.subscriptionId === subscriptionId);
    subscription?.errorListeners.forEach((listener) => listener(error));
    this.emitDebugState();
  }

  private meta(): Promise<RealtimeMetaResponse> {
    if (!this.metaPromise) {
      this.metaPromise = fetchRealtimeMeta(this.config).then((parsed) => {
        this.resolvedMeta = RealtimeMetaResponseSchema.parse(parsed);
        this.emitDebugState();
        return this.resolvedMeta;
      });
    }
    return this.metaPromise;
  }

  private emitDebugState() {
    const state = this.currentDebugState();
    this.debugListeners.forEach((handler) => handler(state));
  }

  private currentDebugState(): RoomSubscriptionDebugState {
    const subscriptions = [...this.subscriptions.values()].map((subscription) => ({
      key: subscription.key,
      roomId: subscription.roomId,
      subscriptionId: subscription.subscriptionId,
      refCount: subscription.refCount,
      mode: subscription.mode,
    }));
    const statsSubscriptions = [...this.statsSubscriptions.values()].map((subscription) => ({
      key: subscription.key,
      subscriptionId: subscription.subscriptionId,
      target: subscription.request.target,
    }));

    return {
      transport: this.transport.snapshot,
      activeMode: subscriptions[0]?.mode ?? (statsSubscriptions.length > 0 ? "ws" : "unknown"),
      subscriptions,
      statsSubscriptions,
      lastSnapshotMeta: this.lastSnapshotMeta,
      lastStatsMeta: this.lastStatsMeta,
      meta: this.resolvedMeta,
    };
  }
}

function statsSubscriptionKey(request: Omit<RealtimeStatsSubscription, "subscriptionId">) {
  return ["stats", request.target, request.day, request.deviceId ?? "", String(request.limit ?? "")].join(":");
}

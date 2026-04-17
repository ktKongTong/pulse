import type {
  ChatEventEnvelope,
  ChatRoomSnapshot,
  RealtimeMetaResponse,
  RealtimeSnapshotEnvelope,
  RoomSnapshot,
} from "@pulse/realtime-protocol";
import { RealtimeMetaResponseSchema } from "@pulse/realtime-protocol";

import { createRealtimeLogger } from "./logger";
import type { PulseRealtimeConfig } from "./types";
import type { PresenceSubscriptionIntent } from "./room-resolver";
import { presenceSubscriptionKey, resolveRoomId } from "./room-resolver";
import { fetchRealtimeMeta } from "./realtime";
import type { RealtimeTransportState } from "./realtime-transport";
import { RealtimeTransport } from "./realtime-transport";

type SnapshotListener = (snapshot: RoomSnapshot) => void;
type ChatSnapshotListener = (snapshot: ChatRoomSnapshot) => void;
type ChatEventListener = (event: ChatEventEnvelope) => void;
type ErrorListener = (error: string) => void;
type DebugListener = (state: RoomSubscriptionDebugState) => void;
type PresenceContext = {
  sessionId: string;
  tabId: string;
  userId?: string;
  page: {
    title: string;
    url: string;
    canonicalUrl?: string;
  };
};

interface ActiveChatMembership {
  roomId: string;
  refCount: number;
  displayName: string;
  userId?: string;
  snapshotListeners: Set<ChatSnapshotListener>;
  eventListeners: Set<ChatEventListener>;
  errorListeners: Set<ErrorListener>;
  unsubscribeRoom: () => void;
}

interface ActiveRoomSubscription {
  key: string;
  roomId: string;
  subscriptionId: string;
  refCount: number;
  mode: "ws";
  listeners: Set<SnapshotListener>;
  errorListeners: Set<ErrorListener>;
}

export interface RoomSubscriptionDebugState {
  transport: RealtimeTransportState;
  activeMode: "ws" | "unknown";
  subscriptions: Array<{
    key: string;
    roomId: string;
    subscriptionId: string;
    refCount: number;
    mode: "ws";
  }>;
  lastSnapshotMeta: {
    roomId: string;
    subscriptionId: string;
    revision: number;
    updatedAt: string;
  } | null;
  meta: RealtimeMetaResponse | null;
}

export class RoomSubscriptionManager {
  private transport: RealtimeTransport;
  private subscriptions = new Map<string, ActiveRoomSubscription>();
  private chatMemberships = new Map<string, ActiveChatMembership>();
  private subscriptionIdCounter = 0;
  private metaPromise: Promise<RealtimeMetaResponse> | null = null;
  private resolvedMeta: RealtimeMetaResponse | null = null;
  private lastSnapshotMeta: RoomSubscriptionDebugState["lastSnapshotMeta"] = null;
  private debugListeners = new Set<DebugListener>();
  private presenceContext: PresenceContext | null = null;
  private readonly logger;

  constructor(private readonly config: PulseRealtimeConfig) {
    this.logger = createRealtimeLogger(config.debug ?? false);
    this.transport = new RealtimeTransport(config);
    this.transport.onMessage((message) => {
      if (message.type === "snapshot") return this.handleSnapshot(message);
      if (message.type === "chat_event") return this.handleChatEvent(message);
      if (message.type === "error") this.handleError(message.subscriptionId, message.message);
    });
    this.transport.onReady(() => {
      for (const subscription of this.subscriptions.values()) {
        this.transport.send({
          protocol: "realtime.ws.v1",
          type: "subscribe",
          subscriptions: [{ subscriptionId: subscription.subscriptionId, roomId: subscription.roomId }],
        });
      }
      for (const membership of this.chatMemberships.values()) {
        this.transport.send({
          protocol: "realtime.ws.v1",
          type: "chat_join",
          roomId: membership.roomId,
          displayName: membership.displayName,
          userId: membership.userId,
        });
      }
      if (this.presenceContext) {
        this.transport.send({
          protocol: "realtime.ws.v1",
          type: "presence_context",
          ...this.presenceContext,
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

  async subscribeChatRoom(
    roomId: string,
    participant: { displayName: string; userId?: string },
    onSnapshot: ChatSnapshotListener,
    onEvent?: ChatEventListener,
    onError?: ErrorListener,
  ): Promise<() => void> {
    const key = `chat:${roomId}`;
    const snapshotKey = `raw:${roomId}`;
    const existing = this.chatMemberships.get(key);
    if (existing) {
      existing.refCount += 1;
      existing.snapshotListeners.add(onSnapshot);
      if (onEvent) existing.eventListeners.add(onEvent);
      if (onError) existing.errorListeners.add(onError);
      this.emitDebugState();
      return () => this.unsubscribeChatRoom(key, onSnapshot, onEvent, onError);
    }

    const unsubscribeRoom = await this.subscribeRawRoomInternal(
      snapshotKey,
      roomId,
      (snapshot) => {
        if (snapshot.roomKind !== "chat") {
          onError?.("unexpected_room_kind");
          return;
        }
        this.chatMemberships.get(key)?.snapshotListeners.forEach((listener) => listener(snapshot));
      },
      onError,
    );
    if (!this.subscriptions.has(snapshotKey)) {
      return () => {};
    }

    const membership: ActiveChatMembership = {
      roomId,
      refCount: 1,
      displayName: participant.displayName,
      userId: participant.userId,
      snapshotListeners: new Set([onSnapshot]),
      eventListeners: onEvent ? new Set([onEvent]) : new Set(),
      errorListeners: onError ? new Set([onError]) : new Set(),
      unsubscribeRoom,
    };
    this.chatMemberships.set(key, membership);

    if (this.transport.isReady) {
      this.transport.send({
        protocol: "realtime.ws.v1",
        type: "chat_join",
        roomId,
        displayName: participant.displayName,
        userId: participant.userId,
      });
    }

    this.emitDebugState();
    return () => this.unsubscribeChatRoom(key, onSnapshot, onEvent, onError);
  }

  sendChatMessage(roomId: string, content: string) {
    this.transport.send({
      protocol: "realtime.ws.v1",
      type: "chat_send",
      roomId,
      content,
    });
  }

  setPresenceContext(context: PresenceContext) {
    this.presenceContext = context;
    if (this.transport.isReady) {
      this.transport.send({
        protocol: "realtime.ws.v1",
        type: "presence_context",
        ...context,
      });
    }
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
      mode: "ws",
      listeners: new Set([onSnapshot]),
      errorListeners: onError ? new Set([onError]) : new Set(),
    };
    this.subscriptions.set(key, subscription);

    try {
      const meta = await this.meta();
      const useWs = meta.streamProtocols.includes("realtime.ws.v1") && meta.capabilities.presence && meta.capabilities.multiRoom;
      if (!useWs) {
        throw new Error("room_ws_not_supported");
      }
      this.transport.connect();
      if (this.transport.isReady) {
        this.transport.send({
          protocol: "realtime.ws.v1",
          type: "subscribe",
          subscriptions: [{ subscriptionId: subscription.subscriptionId, roomId }],
        });
      }
    } catch (error) {
      this.subscriptions.delete(key);
      subscription.errorListeners.forEach((listener) =>
        listener(error instanceof Error ? error.message : "meta_error")
      );
      this.emitDebugState();
      if (this.subscriptions.size === 0) {
        this.transport.disconnect();
      }
      return () => {};
    }

    this.emitDebugState();
    return () => this.unsubscribe(key, onSnapshot, onError);
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
    this.transport.send({
      protocol: "realtime.ws.v1",
      type: "unsubscribe",
      subscriptionIds: [subscription.subscriptionId],
    });
    this.subscriptions.delete(key);
    if (this.subscriptions.size === 0) {
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

  private handleChatEvent(message: ChatEventEnvelope) {
    const membership = this.chatMemberships.get(`chat:${message.roomId}`);
    if (!membership) return;
    membership.eventListeners.forEach((listener) => listener(message));
  }

  private handleError(subscriptionId: string | undefined, error: string) {
    if (!subscriptionId) return;
    const subscription = [...this.subscriptions.values()].find((item) => item.subscriptionId === subscriptionId);
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

    return {
      transport: this.transport.snapshot,
      activeMode: subscriptions[0]?.mode ?? "unknown",
      subscriptions,
      lastSnapshotMeta: this.lastSnapshotMeta,
      meta: this.resolvedMeta,
    };
  }

  private debug(event: string, payload?: unknown) {
    this.logger.debug("[room.subscriptions]", event, payload ?? "");
  }

  private unsubscribeChatRoom(
    key: string,
    onSnapshot: ChatSnapshotListener,
    onEvent?: ChatEventListener,
    onError?: ErrorListener,
  ) {
    const membership = this.chatMemberships.get(key);
    if (!membership) return;
    membership.refCount -= 1;
    membership.snapshotListeners.delete(onSnapshot);
    if (onEvent) membership.eventListeners.delete(onEvent);
    if (onError) membership.errorListeners.delete(onError);
    if (membership.refCount > 0) {
      this.emitDebugState();
      return;
    }
    this.transport.send({
      protocol: "realtime.ws.v1",
      type: "chat_leave",
      roomId: membership.roomId,
    });
    membership.unsubscribeRoom();
    this.chatMemberships.delete(key);
    this.emitDebugState();
  }
}

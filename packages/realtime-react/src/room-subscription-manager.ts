import type {
  ChatEventEnvelope,
  ChatRoomSnapshot,
  RealtimeMetaResponse,
  RealtimeServerMessage,
  RoomSnapshot,
} from "@pulse/realtime-protocol";
import {
  REALTIME_WS_PROTOCOL_V2,
  RealtimeMetaResponseSchema,
} from "@pulse/realtime-protocol";

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

interface RoomTransportEntry {
  roomId: string;
  refCount: number;
  transport: RealtimeTransport;
  lastSnapshot: RoomSnapshot | null;
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
  transports: Array<{
    roomId: string;
    refCount: number;
    status: RealtimeTransportState["status"];
    selectedProtocol: string | null;
    capabilities: RealtimeTransportState["capabilities"];
    lastError: string | null;
    lastMessageType: RealtimeTransportState["lastMessageType"];
  }>;
}

export class RoomSubscriptionManager {
  private readonly transports = new Map<string, RoomTransportEntry>();
  private readonly subscriptions = new Map<string, ActiveRoomSubscription>();
  private readonly chatMemberships = new Map<string, ActiveChatMembership>();
  private subscriptionIdCounter = 0;
  private metaPromise: Promise<RealtimeMetaResponse> | null = null;
  private resolvedMeta: RealtimeMetaResponse | null = null;
  private lastSnapshotMeta: RoomSubscriptionDebugState["lastSnapshotMeta"] = null;
  private readonly debugListeners = new Set<DebugListener>();
  private presenceContext: PresenceContext | null = null;
  private readonly logger;

  constructor(private readonly config: PulseRealtimeConfig) {
    this.logger = createRealtimeLogger(config.debug ?? false);
  }

  async subscribePresence(
    intent: PresenceSubscriptionIntent,
    onSnapshot: SnapshotListener,
    onError?: ErrorListener,
  ) {
    const key = presenceSubscriptionKey(intent);
    const roomId = resolveRoomId(intent);
    return this.subscribeRawRoomInternal(key, roomId, onSnapshot, onError);
  }

  async subscribeRawRoom(
    roomId: string,
    onSnapshot: SnapshotListener,
    onError?: ErrorListener,
  ) {
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
      const lastSnapshot = this.transports.get(roomId)?.lastSnapshot;
      if (lastSnapshot?.roomKind === "chat") {
        onSnapshot(lastSnapshot);
      }
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

    const roomTransport = this.transports.get(roomId);
    if (roomTransport?.transport.isReady) {
      this.sendChatJoin(roomTransport, membership);
    }

    this.emitDebugState();
    return () => this.unsubscribeChatRoom(key, onSnapshot, onEvent, onError);
  }

  sendChatMessage(roomId: string, content: string) {
    this.transports.get(roomId)?.transport.send({
      protocol: REALTIME_WS_PROTOCOL_V2,
      type: "chat_send",
      roomId,
      content,
    });
  }

  setPresenceContext(context: PresenceContext) {
    this.presenceContext = context;
    this.sendPresenceContextToRoom("global");
    this.sendPresenceContextToRoom(resolveRoomId({
      capability: "presence",
      scope: "page",
      canonicalUrl: context.page.canonicalUrl ?? context.page.url,
    }));
    this.emitDebugState();
  }

  onDebugState(handler: DebugListener): () => void {
    this.debugListeners.add(handler);
    handler(this.currentDebugState());
    return () => this.debugListeners.delete(handler);
  }

  dispose() {
    for (const membership of this.chatMemberships.values()) {
      this.sendChatLeave(membership.roomId);
    }
    for (const entry of this.transports.values()) {
      entry.transport.disconnect();
    }
    this.chatMemberships.clear();
    this.subscriptions.clear();
    this.transports.clear();
  }

  private async subscribeRawRoomInternal(
    key: string,
    roomId: string,
    onSnapshot: SnapshotListener,
    onError?: ErrorListener,
  ): Promise<() => void> {
    const existing = this.subscriptions.get(key);
    if (existing) {
      existing.refCount += 1;
      existing.listeners.add(onSnapshot);
      if (onError) existing.errorListeners.add(onError);
      const lastSnapshot = this.transports.get(roomId)?.lastSnapshot;
      if (lastSnapshot) {
        onSnapshot(lastSnapshot);
      }
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
      const useWs =
        meta.streamProtocols.includes(REALTIME_WS_PROTOCOL_V2) &&
        meta.capabilities.multiRoom &&
        (roomId.startsWith("chat:")
          ? meta.capabilities.chat
          : meta.capabilities.presence);
      if (!useWs) {
        throw new Error("room_ws_not_supported");
      }

      const transportEntry = this.acquireTransport(roomId);
      if (transportEntry.lastSnapshot) {
        onSnapshot(transportEntry.lastSnapshot);
      }
    } catch (error) {
      this.subscriptions.delete(key);
      subscription.errorListeners.forEach((listener) =>
        listener(error instanceof Error ? error.message : "meta_error"),
      );
      this.emitDebugState();
      return () => {};
    }

    this.emitDebugState();
    return () => this.unsubscribe(key, onSnapshot, onError);
  }

  private unsubscribe(
    key: string,
    onSnapshot: SnapshotListener,
    onError?: ErrorListener,
  ) {
    const subscription = this.subscriptions.get(key);
    if (!subscription) return;
    subscription.refCount -= 1;
    subscription.listeners.delete(onSnapshot);
    if (onError) subscription.errorListeners.delete(onError);
    if (subscription.refCount > 0) {
      this.emitDebugState();
      return;
    }
    this.subscriptions.delete(key);
    this.releaseTransport(subscription.roomId);
    this.emitDebugState();
  }

  private acquireTransport(roomId: string) {
    const existing = this.transports.get(roomId);
    if (existing) {
      existing.refCount += 1;
      return existing;
    }

    const transport = new RealtimeTransport(this.config, roomId);
    const entry: RoomTransportEntry = {
      roomId,
      refCount: 1,
      transport,
      lastSnapshot: null,
    };
    transport.onMessage((message) => this.handleTransportMessage(entry, message));
    transport.onReady(() => this.handleTransportReady(entry));
    transport.onState(() => this.emitDebugState());
    transport.connect();
    this.transports.set(roomId, entry);
    return entry;
  }

  private releaseTransport(roomId: string) {
    const entry = this.transports.get(roomId);
    if (!entry) return;
    entry.refCount -= 1;
    if (entry.refCount > 0) {
      return;
    }
    entry.transport.disconnect();
    this.transports.delete(roomId);
  }

  private handleTransportMessage(
    entry: RoomTransportEntry,
    message: RealtimeServerMessage,
  ) {
    if (message.type === "snapshot") {
      entry.lastSnapshot = message.payload;
      this.lastSnapshotMeta = {
        roomId: message.roomId,
        subscriptionId: this.resolvePrimarySubscriptionId(entry.roomId),
        revision: message.payload.revision,
        updatedAt: message.payload.updatedAt,
      };
      this.subscriptionsForRoom(entry.roomId).forEach((subscription) => {
        subscription.listeners.forEach((listener) => listener(message.payload));
      });
      this.emitDebugState();
      return;
    }

    if (message.type === "chat_event") {
      const membership = this.chatMemberships.get(`chat:${entry.roomId}`);
      membership?.eventListeners.forEach((listener) => listener(message));
      return;
    }

    if (message.type === "error") {
      this.handleRoomError(message.roomId, message.message);
    }
  }

  private handleTransportReady(entry: RoomTransportEntry) {
    const membership = this.chatMemberships.get(`chat:${entry.roomId}`);
    if (membership) {
      this.sendChatJoin(entry, membership);
    }
    this.sendPresenceContextToRoom(entry.roomId);
    this.emitDebugState();
  }

  private sendChatJoin(
    entry: RoomTransportEntry,
    membership: Pick<ActiveChatMembership, "roomId" | "displayName" | "userId">,
  ) {
    entry.transport.send({
      protocol: REALTIME_WS_PROTOCOL_V2,
      type: "chat_join",
      roomId: membership.roomId,
      displayName: membership.displayName,
      userId: membership.userId,
    });
  }

  private sendChatLeave(roomId: string) {
    this.transports.get(roomId)?.transport.send({
      protocol: REALTIME_WS_PROTOCOL_V2,
      type: "chat_leave",
      roomId,
    });
  }

  private sendPresenceContextToRoom(roomId: string) {
    const context = this.presenceContext;
    const entry = this.transports.get(roomId);
    if (!context || !entry?.transport.isReady) return;
    if (roomId === "global") {
      entry.transport.send({
        protocol: REALTIME_WS_PROTOCOL_V2,
        type: "presence_context",
        ...context,
      });
      return;
    }
    const currentPageRoomId = resolveRoomId({
      capability: "presence",
      scope: "page",
      canonicalUrl: context.page.canonicalUrl ?? context.page.url,
    });
    if (roomId !== currentPageRoomId) return;
    entry.transport.send({
      protocol: REALTIME_WS_PROTOCOL_V2,
      type: "presence_context",
      ...context,
    });
  }

  private subscriptionsForRoom(roomId: string) {
    return [...this.subscriptions.values()].filter(
      (subscription) => subscription.roomId === roomId,
    );
  }

  private resolvePrimarySubscriptionId(roomId: string) {
    return this.subscriptionsForRoom(roomId)[0]?.subscriptionId ?? roomId;
  }

  private handleRoomError(roomId: string, error: string) {
    this.subscriptionsForRoom(roomId).forEach((subscription) => {
      subscription.errorListeners.forEach((listener) => listener(error));
    });
    this.chatMemberships.get(`chat:${roomId}`)?.errorListeners.forEach((listener) => {
      listener(error);
    });
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
    const transports = [...this.transports.values()].map((entry) => ({
      roomId: entry.roomId,
      refCount: entry.refCount,
      status: entry.transport.snapshot.status,
      selectedProtocol: entry.transport.snapshot.selectedProtocol,
      capabilities: entry.transport.snapshot.capabilities,
      lastError: entry.transport.snapshot.lastError,
      lastMessageType: entry.transport.snapshot.lastMessageType,
    }));
    const transport = aggregateTransportState(transports);

    return {
      transport,
      activeMode: transports.length > 0 ? "ws" : "unknown",
      subscriptions,
      lastSnapshotMeta: this.lastSnapshotMeta,
      meta: this.resolvedMeta,
      transports,
    };
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
    this.sendChatLeave(membership.roomId);
    membership.unsubscribeRoom();
    this.chatMemberships.delete(key);
    this.emitDebugState();
  }
}

function aggregateTransportState(
  transports: RoomSubscriptionDebugState["transports"],
): RealtimeTransportState {
  if (transports.length === 0) {
    return {
      status: "idle",
      selectedProtocol: null,
      capabilities: null,
      lastError: null,
      lastMessageType: null,
    };
  }

  const priority: RealtimeTransportState["status"][] = [
    "error",
    "reconnecting",
    "connecting",
    "ready",
    "closed",
    "idle",
  ];
  const status =
    priority.find((candidate) =>
      transports.some((transport) => transport.status === candidate),
    ) ?? "idle";

  return {
    status,
    selectedProtocol:
      transports.find((transport) => transport.selectedProtocol)?.selectedProtocol ??
      null,
    capabilities:
      transports.find((transport) => transport.capabilities)?.capabilities ?? null,
    lastError: transports.find((transport) => transport.lastError)?.lastError ?? null,
    lastMessageType:
      transports.find((transport) => transport.lastMessageType)?.lastMessageType ??
      null,
  };
}

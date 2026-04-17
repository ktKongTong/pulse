import { z } from "zod";
import {
  DeviceAggregateSchema,
  PageAggregateSchema,
  RoomAggregateSchema,
  StatsSummarySchema,
} from "./stats-v1";

export const REALTIME_STREAM_PROTOCOL_V1 = "realtime.v1-stream";
export const REALTIME_WS_PROTOCOL_V1 = "realtime.ws.v1";

export const RoomKindSchema = z.enum(["global", "page", "chat"]);
export const RoomStreamKindSchema = z.enum([
  "snapshot.updated",
  "sync.reset",
  "error",
]);

export const RoomReaderSourceSchema = z.enum(["device", "web"]);
export const ReaderPresenceStateSchema = z.enum([
  "active",
  "idle",
  "locked",
  "sleeping",
  "offline",
  "hidden",
]);

export const RoomReaderPageSchema = z
  .object({
    title: z.string().optional(),
    url: z.string().url().optional(),
    canonicalUrl: z.string().url().optional(),
  })
  .optional();

export const RoomReaderReadingSchema = z
  .object({
    progressPercent: z.number().min(0).max(100).optional(),
    scrollY: z.number().nonnegative().optional(),
  })
  .optional();

export const RoomReaderDeviceSchema = z
  .object({
    deviceId: z.string().optional(),
    sessionId: z.string(),
    platform: z.string().optional(),
    name: z.string().optional(),
  })
  .optional();

export const RoomReaderAppSchema = z
  .object({
    name: z.string().optional(),
    id: z.string().optional(),
    category: z.string().optional(),
  })
  .optional();

export const RoomReaderMediaSchema = z
  .object({
    providerId: z.string().optional(),
    source: z.string().optional(),
    itemType: z.string().optional(),
    trackId: z.string().optional(),
    title: z.string().optional(),
    artist: z.string().optional(),
    album: z.string().optional(),
    albumArtist: z.string().optional(),
    artworkUrl: z.string().optional(),
    linkUrl: z.string().optional(),
    progressSeconds: z.number().nonnegative().optional(),
    durationSeconds: z.number().int().nonnegative().optional(),
    playbackState: z.string().optional(),
    trackNumber: z.number().int().nonnegative().optional(),
    discNumber: z.number().int().nonnegative().optional(),
    collectionId: z.string().optional(),
    collectionTitle: z.string().optional(),
    collectionLinkUrl: z.string().url().optional(),
  })
  .optional();

export const RoomReaderSchema = z.object({
  readerId: z.string(),
  sessionId: z.string(),
  userId: z.string().optional(),
  source: RoomReaderSourceSchema,
  displayName: z.string(),
  presenceState: ReaderPresenceStateSchema,
  page: RoomReaderPageSchema,
  reading: RoomReaderReadingSchema,
  device: RoomReaderDeviceSchema,
  app: RoomReaderAppSchema,
  media: RoomReaderMediaSchema,
  updatedAt: z.string(),
});

export const PageReadingStatsSchema = z.object({
  avgProgress: z.number().nonnegative(),
  maxProgress: z.number().nonnegative(),
  sampleCount: z.number().int().nonnegative(),
});

export const ChatParticipantSchema = z.object({
  readerId: z.string(),
  displayName: z.string(),
  presenceState: ReaderPresenceStateSchema,
  updatedAt: z.string(),
});

export const ChatMessageSchema = z.object({
  msgId: z.string(),
  senderId: z.string(),
  senderDisplayName: z.string(),
  content: z.string(),
  createdAt: z.string(),
});

const BaseRoomSnapshotFields = {
  workspaceId: z.string(),
  roomId: z.string(),
  revision: z.number().int().nonnegative(),
  updatedAt: z.string(),
};

export const GlobalRoomSnapshotSchema = z.object({
  ...BaseRoomSnapshotFields,
  roomKind: z.literal("global"),
  onlineCount: z.number().int().nonnegative(),
  activeReaders: z.array(RoomReaderSchema),
});

export const PageRoomSnapshotSchema = z.object({
  ...BaseRoomSnapshotFields,
  roomKind: z.literal("page"),
  onlineCount: z.number().int().nonnegative(),
  activeReaders: z.array(RoomReaderSchema),
  readingStats: PageReadingStatsSchema,
});

export const ChatRoomSnapshotSchema = z.object({
  ...BaseRoomSnapshotFields,
  roomKind: z.literal("chat"),
  participantCount: z.number().int().nonnegative(),
  participants: z.array(ChatParticipantSchema),
  messages: z.array(ChatMessageSchema).default([]),
  messageCount: z.number().int().nonnegative().default(0),
  typingUsers: z.array(z.string()).default([]),
});

export const RoomSnapshotSchema = z.discriminatedUnion("roomKind", [
  GlobalRoomSnapshotSchema,
  PageRoomSnapshotSchema,
  ChatRoomSnapshotSchema,
]);

export const RoomStreamEnvelopeSchema = z.object({
  protocol: z
    .literal(REALTIME_STREAM_PROTOCOL_V1)
    .default(REALTIME_STREAM_PROTOCOL_V1),
  kind: RoomStreamKindSchema,
  workspaceId: z.string(),
  roomId: z.string(),
  revision: z.number().int().nonnegative(),
  payload: RoomSnapshotSchema.optional(),
  error: z.string().optional(),
});

export const RealtimeCapabilitiesSchema = z.object({
  presence: z.boolean(),
  multiRoom: z.boolean(),
  chat: z.boolean(),
  richMedia: z.boolean(),
  interaction: z.boolean(),
  statsPush: z.boolean(),
});

export const RealtimeMetaResponseSchema = z.object({
  serverVersion: z.string(),
  ingestProtocols: z.object({
    presence: z.array(z.string()),
    web: z.array(z.string()),
  }),
  streamProtocols: z.array(z.string()),
  capabilities: RealtimeCapabilitiesSchema,
  interactionProtocols: z.array(z.string()).default([]),
  supportedInteractionCommands: z.array(z.string()).default([]),
});

export const RealtimeSubscriptionSchema = z.object({
  subscriptionId: z.string(),
  roomId: z.string(),
});

export const RealtimeStatsTargetSchema = z.enum([
  "global",
  "device",
  "pages",
  "rooms",
]);

export const RealtimeStatsSubscriptionSchema = z.object({
  subscriptionId: z.string(),
  target: RealtimeStatsTargetSchema,
  day: z.string(),
  deviceId: z.string().optional(),
  limit: z.number().int().positive().max(100).optional(),
});

export const RealtimeHelloSchema = z.object({
  type: z.literal("hello"),
  supportedProtocols: z.array(z.string()).min(1),
  sdkVersion: z.string(),
});

export const RealtimeHelloAckSchema = z.object({
  protocol: z.literal(REALTIME_WS_PROTOCOL_V1).default(REALTIME_WS_PROTOCOL_V1),
  type: z.literal("hello_ack"),
  selectedProtocol: z.string(),
  capabilities: RealtimeCapabilitiesSchema,
});

export const RealtimeSubscribeSchema = z.object({
  protocol: z.literal(REALTIME_WS_PROTOCOL_V1).default(REALTIME_WS_PROTOCOL_V1),
  type: z.literal("subscribe"),
  subscriptions: z.array(RealtimeSubscriptionSchema).min(1),
});

export const RealtimeUnsubscribeSchema = z.object({
  protocol: z.literal(REALTIME_WS_PROTOCOL_V1).default(REALTIME_WS_PROTOCOL_V1),
  type: z.literal("unsubscribe"),
  subscriptionIds: z.array(z.string()).min(1),
});

export const RealtimeSubscribeStatsSchema = z.object({
  protocol: z.literal(REALTIME_WS_PROTOCOL_V1).default(REALTIME_WS_PROTOCOL_V1),
  type: z.literal("subscribe_stats"),
  subscriptions: z.array(RealtimeStatsSubscriptionSchema).min(1),
});

export const RealtimeUnsubscribeStatsSchema = z.object({
  protocol: z.literal(REALTIME_WS_PROTOCOL_V1).default(REALTIME_WS_PROTOCOL_V1),
  type: z.literal("unsubscribe_stats"),
  subscriptionIds: z.array(z.string()).min(1),
});

export const RealtimeChatJoinSchema = z.object({
  protocol: z.literal(REALTIME_WS_PROTOCOL_V1).default(REALTIME_WS_PROTOCOL_V1),
  type: z.literal("chat_join"),
  roomId: z.string(),
  displayName: z.string().min(1),
  userId: z.string().min(1).optional(),
});

export const RealtimeChatLeaveSchema = z.object({
  protocol: z.literal(REALTIME_WS_PROTOCOL_V1).default(REALTIME_WS_PROTOCOL_V1),
  type: z.literal("chat_leave"),
  roomId: z.string(),
});

export const RealtimeChatSendSchema = z.object({
  protocol: z.literal(REALTIME_WS_PROTOCOL_V1).default(REALTIME_WS_PROTOCOL_V1),
  type: z.literal("chat_send"),
  roomId: z.string(),
  content: z.string().min(1).max(4000),
});

export const RealtimeSnapshotEnvelopeSchema = z.object({
  protocol: z.literal(REALTIME_WS_PROTOCOL_V1).default(REALTIME_WS_PROTOCOL_V1),
  type: z.literal("snapshot"),
  subscriptionId: z.string(),
  roomId: z.string(),
  payload: RoomSnapshotSchema,
});

export const ChatEventKindSchema = z.enum([
  "message_posted",
  "message_edited",
  "message_deleted",
  "typing_started",
  "typing_stopped",
  "member_joined",
  "member_left",
]);

export const ChatEventEnvelopeSchema = z.object({
  protocol: z.literal(REALTIME_WS_PROTOCOL_V1).default(REALTIME_WS_PROTOCOL_V1),
  type: z.literal("chat_event"),
  roomId: z.string(),
  roomKind: z.literal("chat"),
  revision: z.number().int().nonnegative(),
  event: z.object({
    kind: ChatEventKindSchema,
    participant: ChatParticipantSchema.optional(),
    message: ChatMessageSchema.optional(),
    targetMessageId: z.string().optional(),
    typingUserId: z.string().optional(),
  }),
});

export const RealtimeErrorEnvelopeSchema = z.object({
  protocol: z.literal(REALTIME_WS_PROTOCOL_V1).default(REALTIME_WS_PROTOCOL_V1),
  type: z.literal("error"),
  code: z.string(),
  message: z.string(),
  subscriptionId: z.string().optional(),
});

const RealtimeGlobalStatsEnvelopeSchema = z.object({
  protocol: z.literal(REALTIME_WS_PROTOCOL_V1).default(REALTIME_WS_PROTOCOL_V1),
  type: z.literal("stats"),
  subscriptionId: z.string(),
  target: z.literal("global"),
  day: z.string(),
  payload: StatsSummarySchema,
});

const RealtimeDeviceStatsEnvelopeSchema = z.object({
  protocol: z.literal(REALTIME_WS_PROTOCOL_V1).default(REALTIME_WS_PROTOCOL_V1),
  type: z.literal("stats"),
  subscriptionId: z.string(),
  target: z.literal("device"),
  day: z.string(),
  payload: DeviceAggregateSchema.nullable(),
});

const RealtimePagesStatsEnvelopeSchema = z.object({
  protocol: z.literal(REALTIME_WS_PROTOCOL_V1).default(REALTIME_WS_PROTOCOL_V1),
  type: z.literal("stats"),
  subscriptionId: z.string(),
  target: z.literal("pages"),
  day: z.string(),
  payload: z.array(PageAggregateSchema),
});

const RealtimeRoomsStatsEnvelopeSchema = z.object({
  protocol: z.literal(REALTIME_WS_PROTOCOL_V1).default(REALTIME_WS_PROTOCOL_V1),
  type: z.literal("stats"),
  subscriptionId: z.string(),
  target: z.literal("rooms"),
  day: z.string(),
  payload: z.array(RoomAggregateSchema),
});

export const RealtimeStatsEnvelopeSchema = z.discriminatedUnion("target", [
  RealtimeGlobalStatsEnvelopeSchema,
  RealtimeDeviceStatsEnvelopeSchema,
  RealtimePagesStatsEnvelopeSchema,
  RealtimeRoomsStatsEnvelopeSchema,
]);

export const RealtimeStatsErrorEnvelopeSchema = z.object({
  protocol: z.literal(REALTIME_WS_PROTOCOL_V1).default(REALTIME_WS_PROTOCOL_V1),
  type: z.literal("stats_error"),
  code: z.string(),
  message: z.string(),
  subscriptionId: z.string().optional(),
});

export const RealtimeClientMessageSchema = z.discriminatedUnion("type", [
  RealtimeHelloSchema,
  RealtimeSubscribeSchema,
  RealtimeUnsubscribeSchema,
  RealtimeSubscribeStatsSchema,
  RealtimeUnsubscribeStatsSchema,
  RealtimeChatJoinSchema,
  RealtimeChatLeaveSchema,
  RealtimeChatSendSchema,
]);

export const RealtimeServerMessageSchema = z.discriminatedUnion("type", [
  RealtimeHelloAckSchema,
  RealtimeSnapshotEnvelopeSchema,
  ChatEventEnvelopeSchema,
  RealtimeErrorEnvelopeSchema,
  RealtimeStatsEnvelopeSchema,
  RealtimeStatsErrorEnvelopeSchema,
]);

export type RoomSnapshot = z.infer<typeof RoomSnapshotSchema>;
export type GlobalRoomSnapshot = z.infer<typeof GlobalRoomSnapshotSchema>;
export type PageRoomSnapshot = z.infer<typeof PageRoomSnapshotSchema>;
export type ChatRoomSnapshot = z.infer<typeof ChatRoomSnapshotSchema>;
export type RoomReader = z.infer<typeof RoomReaderSchema>;
export type PageReadingStats = z.infer<typeof PageReadingStatsSchema>;
export type ChatParticipant = z.infer<typeof ChatParticipantSchema>;
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type RoomStreamEnvelope = z.infer<typeof RoomStreamEnvelopeSchema>;
export type RealtimeMetaResponse = z.infer<typeof RealtimeMetaResponseSchema>;
export type RealtimeCapabilities = z.infer<typeof RealtimeCapabilitiesSchema>;
export type RealtimeSubscription = z.infer<typeof RealtimeSubscriptionSchema>;
export type RealtimeStatsTarget = z.infer<typeof RealtimeStatsTargetSchema>;
export type RealtimeStatsSubscription = z.infer<
  typeof RealtimeStatsSubscriptionSchema
>;
export type RealtimeHello = z.infer<typeof RealtimeHelloSchema>;
export type RealtimeHelloAck = z.infer<typeof RealtimeHelloAckSchema>;
export type RealtimeSubscribe = z.infer<typeof RealtimeSubscribeSchema>;
export type RealtimeUnsubscribe = z.infer<typeof RealtimeUnsubscribeSchema>;
export type RealtimeSubscribeStats = z.infer<
  typeof RealtimeSubscribeStatsSchema
>;
export type RealtimeUnsubscribeStats = z.infer<
  typeof RealtimeUnsubscribeStatsSchema
>;
export type RealtimeChatJoin = z.infer<typeof RealtimeChatJoinSchema>;
export type RealtimeChatLeave = z.infer<typeof RealtimeChatLeaveSchema>;
export type RealtimeChatSend = z.infer<typeof RealtimeChatSendSchema>;
export type RealtimeSnapshotEnvelope = z.infer<
  typeof RealtimeSnapshotEnvelopeSchema
>;
export type ChatEventEnvelope = z.infer<typeof ChatEventEnvelopeSchema>;
export type RealtimeErrorEnvelope = z.infer<typeof RealtimeErrorEnvelopeSchema>;
export type RealtimeStatsEnvelope = z.infer<typeof RealtimeStatsEnvelopeSchema>;
export type RealtimeStatsErrorEnvelope = z.infer<
  typeof RealtimeStatsErrorEnvelopeSchema
>;
export type RealtimeClientMessage = z.infer<typeof RealtimeClientMessageSchema>;
export type RealtimeServerMessage = z.infer<typeof RealtimeServerMessageSchema>;

export function isGlobalRoomSnapshot(
  snapshot: RoomSnapshot | null | undefined,
): snapshot is GlobalRoomSnapshot {
  return snapshot?.roomKind === "global";
}

export function isPageRoomSnapshot(
  snapshot: RoomSnapshot | null | undefined,
): snapshot is PageRoomSnapshot {
  return snapshot?.roomKind === "page";
}

export function isChatRoomSnapshot(
  snapshot: RoomSnapshot | null | undefined,
): snapshot is ChatRoomSnapshot {
  return snapshot?.roomKind === "chat";
}

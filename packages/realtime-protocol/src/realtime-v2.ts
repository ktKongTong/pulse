import { z } from "zod";

export const REALTIME_STREAM_PROTOCOL_V1 = "realtime.v1-stream";
export const REALTIME_WS_PROTOCOL_V2 = "realtime.ws.v2";

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

export const SessionUserSchema = z.object({
  id: z.string(),
  userId: z.string().optional(),
  userName: z.string().optional(),
  userAvatar: z.string().optional(),
});

export const PageSessionSchema = SessionUserSchema.extend({
  progress: z
    .object({
      percent: z.number().min(0).max(100).optional(),
      scrollY: z.number().nonnegative().optional(),
    })
    .optional(),
});

export const ActivePageSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  canonicalUrl: z.string().url().optional(),
  sessionCount: z.number().int().nonnegative(),
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
  sessionCount: z.number().int().nonnegative(),
  sessions: z.array(SessionUserSchema).default([]),
  activePageCount: z.number().int().nonnegative(),
  activePages: z.array(ActivePageSchema).default([]),
  ownerCurrent: z
    .object({
      deviceId: z.string().optional(),
      displayName: z.string().optional(),
      currentApp: RoomReaderAppSchema,
      currentMedia: RoomReaderMediaSchema,
      lastActiveAt: z.string().optional(),
    })
    .nullable()
    .optional(),
});

export const PageRoomSnapshotSchema = z.object({
  ...BaseRoomSnapshotFields,
  roomKind: z.literal("page"),
  sessionCount: z.number().int().nonnegative(),
  sessions: z.array(PageSessionSchema).default([]),
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

export const RealtimeHelloSchema = z.object({
  type: z.literal("hello"),
  supportedProtocols: z.array(z.string()).min(1),
  sdkVersion: z.string(),
});

export const RealtimeHelloAckSchema = z.object({
  protocol: z.literal(REALTIME_WS_PROTOCOL_V2).default(REALTIME_WS_PROTOCOL_V2),
  type: z.literal("hello_ack"),
  selectedProtocol: z.string(),
  capabilities: RealtimeCapabilitiesSchema,
});

export const RealtimeChatJoinSchema = z.object({
  protocol: z.literal(REALTIME_WS_PROTOCOL_V2).default(REALTIME_WS_PROTOCOL_V2),
  type: z.literal("chat_join"),
  roomId: z.string(),
  displayName: z.string().min(1),
  userId: z.string().min(1).optional(),
});

export const RealtimeChatLeaveSchema = z.object({
  protocol: z.literal(REALTIME_WS_PROTOCOL_V2).default(REALTIME_WS_PROTOCOL_V2),
  type: z.literal("chat_leave"),
  roomId: z.string(),
});

export const RealtimeChatSendSchema = z.object({
  protocol: z.literal(REALTIME_WS_PROTOCOL_V2).default(REALTIME_WS_PROTOCOL_V2),
  type: z.literal("chat_send"),
  roomId: z.string(),
  content: z.string().min(1).max(4000),
});

export const RealtimePresenceContextSchema = z.object({
  protocol: z.literal(REALTIME_WS_PROTOCOL_V2).default(REALTIME_WS_PROTOCOL_V2),
  type: z.literal("presence_context"),
  sessionId: z.string().min(1),
  tabId: z.string().min(1),
  userId: z.string().min(1).optional(),
  page: z.object({
    title: z.string().min(1),
    url: z.string().url(),
    canonicalUrl: z.string().url().optional(),
  }),
});

export const RealtimeSnapshotEnvelopeSchema = z.object({
  protocol: z.literal(REALTIME_WS_PROTOCOL_V2).default(REALTIME_WS_PROTOCOL_V2),
  type: z.literal("snapshot"),
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
  protocol: z.literal(REALTIME_WS_PROTOCOL_V2).default(REALTIME_WS_PROTOCOL_V2),
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
  protocol: z.literal(REALTIME_WS_PROTOCOL_V2).default(REALTIME_WS_PROTOCOL_V2),
  type: z.literal("error"),
  roomId: z.string(),
  code: z.string(),
  message: z.string(),
});

export const RealtimeClientMessageSchema = z.discriminatedUnion("type", [
  RealtimeHelloSchema,
  RealtimeChatJoinSchema,
  RealtimeChatLeaveSchema,
  RealtimeChatSendSchema,
  RealtimePresenceContextSchema,
]);

export const RealtimeServerMessageSchema = z.discriminatedUnion("type", [
  RealtimeHelloAckSchema,
  RealtimeSnapshotEnvelopeSchema,
  ChatEventEnvelopeSchema,
  RealtimeErrorEnvelopeSchema,
]);

export type RoomSnapshot = z.infer<typeof RoomSnapshotSchema>;
export type GlobalRoomSnapshot = z.infer<typeof GlobalRoomSnapshotSchema>;
export type PageRoomSnapshot = z.infer<typeof PageRoomSnapshotSchema>;
export type ChatRoomSnapshot = z.infer<typeof ChatRoomSnapshotSchema>;
export type RoomReader = z.infer<typeof RoomReaderSchema>;
export type PageReadingStats = z.infer<typeof PageReadingStatsSchema>;
export type SessionUser = z.infer<typeof SessionUserSchema>;
export type PageSession = z.infer<typeof PageSessionSchema>;
export type ActivePage = z.infer<typeof ActivePageSchema>;
export type ChatParticipant = z.infer<typeof ChatParticipantSchema>;
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type RoomStreamEnvelope = z.infer<typeof RoomStreamEnvelopeSchema>;
export type RealtimeMetaResponse = z.infer<typeof RealtimeMetaResponseSchema>;
export type RealtimeCapabilities = z.infer<typeof RealtimeCapabilitiesSchema>;
export type RealtimeHello = z.infer<typeof RealtimeHelloSchema>;
export type RealtimeHelloAck = z.infer<typeof RealtimeHelloAckSchema>;
export type RealtimeChatJoin = z.infer<typeof RealtimeChatJoinSchema>;
export type RealtimeChatLeave = z.infer<typeof RealtimeChatLeaveSchema>;
export type RealtimeChatSend = z.infer<typeof RealtimeChatSendSchema>;
export type RealtimePresenceContext = z.infer<typeof RealtimePresenceContextSchema>;
export type RealtimeSnapshotEnvelope = z.infer<
  typeof RealtimeSnapshotEnvelopeSchema
>;
export type ChatEventEnvelope = z.infer<typeof ChatEventEnvelopeSchema>;
export type RealtimeErrorEnvelope = z.infer<typeof RealtimeErrorEnvelopeSchema>;
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

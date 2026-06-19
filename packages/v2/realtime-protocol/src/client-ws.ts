import { z } from "zod";
import {
  ClientUserSchema,
  IsoDateTimeSchema,
  MediaClockSchema,
  MediaItemSchema,
  MediaPlaybackSchema,
  OwnerFocusSchema,
  StreamCodecSchema,
} from "./shared";

export const CLIENT_WS_PROTOCOL = "client.ws.v2";

export const ClientSessionClaimRequestSchema = z.object({
  protocol: z.literal(CLIENT_WS_PROTOCOL),
  sdkVersion: z.string().min(1),
});

export const ClientSessionClaimResponseSchema = z.object({
  protocol: z.literal(CLIENT_WS_PROTOCOL),
  sessionId: z.string().min(1),
  user: ClientUserSchema.optional(),
});

export const ClientWsHelloFrameSchema = z.object({
  protocol: z.literal(CLIENT_WS_PROTOCOL),
  type: z.literal("hello"),
  supportedProtocols: z.tuple([z.literal(CLIENT_WS_PROTOCOL)]),
  sdkVersion: z.string().min(1),
  sessionId: z.string().min(1),
  tabId: z.string().min(1),
});

export const ClientWsStreamRequestFrameSchema = z.object({
  protocol: z.literal(CLIENT_WS_PROTOCOL),
  type: z.literal("stream.request"),
  requestId: z.string().min(1),
});

export const ClientWsStreamStopFrameSchema = z.object({
  protocol: z.literal(CLIENT_WS_PROTOCOL),
  type: z.literal("stream.stop"),
});

export const ClientWsAckFrameSchema = z.object({
  protocol: z.literal(CLIENT_WS_PROTOCOL),
  type: z.literal("ack"),
  streamId: z.string().min(1),
  generation: z.number().int().nonnegative(),
  seq: z.number().int().nonnegative(),
});

export const ClientWsClientFrameSchema = z.discriminatedUnion("type", [
  ClientWsHelloFrameSchema,
  ClientWsStreamRequestFrameSchema,
  ClientWsStreamStopFrameSchema,
  ClientWsAckFrameSchema,
]);

export const ClientWsHelloAckFrameSchema = z.object({
  protocol: z.literal(CLIENT_WS_PROTOCOL),
  type: z.literal("hello_ack"),
  selectedProtocol: z.literal(CLIENT_WS_PROTOCOL),
  connectionId: z.string().min(1),
  session: z.object({
    sessionId: z.string().min(1),
    tabId: z.string().min(1),
    user: ClientUserSchema.optional(),
  }),
});

export const ClientCommonSessionPageSchema = z.object({
  canonicalUrl: z.string().min(1),
  title: z.string().min(1).optional(),
  url: z.string().min(1).optional(),
  tabCount: z.number().int().nonnegative(),
  lastSeenAt: IsoDateTimeSchema,
});

export const ClientCommonSessionDetailSchema = z.object({
  sessionId: z.string().min(1),
  tabCount: z.number().int().nonnegative(),
  user: ClientUserSchema.optional(),
  pages: z.array(ClientCommonSessionPageSchema),
  lastSeenAt: IsoDateTimeSchema,
});

export const ClientCommonActivePageDetailSchema = z.object({
  canonicalUrl: z.string().min(1),
  title: z.string().min(1).optional(),
  url: z.string().min(1).optional(),
  sessionCount: z.number().int().nonnegative(),
  lastSeenAt: IsoDateTimeSchema,
});

export const ClientCommonGlobalSnapshotSchema = z.object({
  revision: z.number().int().nonnegative(),
  updatedAt: IsoDateTimeSchema,
  sessions: z.object({
    totalCount: z.number().int().nonnegative(),
    recent: z.array(ClientCommonSessionDetailSchema),
  }),
  activePages: z.object({
    totalCount: z.number().int().nonnegative(),
    top: z.array(ClientCommonActivePageDetailSchema),
  }),
  owner: z.object({
    focus: OwnerFocusSchema.nullable(),
  }),
});

export const ClientWsSnapshotFrameSchema = z.object({
  protocol: z.literal(CLIENT_WS_PROTOCOL),
  type: z.literal("snapshot"),
  snapshot: ClientCommonGlobalSnapshotSchema,
});

export const ClientMediaStreamSourceSchema = z.object({
  state: z.enum(["ready", "disabled", "offline", "idle"]),
});

export const ClientMediaNowPlayingSchema = z.object({
  current: MediaItemSchema,
  clock: MediaClockSchema.optional(),
  playback: MediaPlaybackSchema,
  updatedAt: IsoDateTimeSchema,
});

export const ClientWsStateFrameSchema = z.object({
  protocol: z.literal(CLIENT_WS_PROTOCOL),
  type: z.literal("state"),
  revision: z.number().int().nonnegative(),
  updatedAt: IsoDateTimeSchema,
  media: ClientMediaNowPlayingSchema.nullable(),
  stream: z.object({
    source: ClientMediaStreamSourceSchema,
  }),
});

export const ClientWsStreamAcceptedFrameSchema = z.object({
  protocol: z.literal(CLIENT_WS_PROTOCOL),
  type: z.literal("stream.accepted"),
  requestId: z.string().min(1),
  stream: z.object({
    streamId: z.string().min(1),
    generation: z.number().int().nonnegative(),
    replay: z
      .object({
        fromSeq: z.number().int().nonnegative(),
        availableFromSeq: z.number().int().nonnegative(),
        latestSeq: z.number().int().nonnegative(),
      })
      .optional(),
  }),
});

export const ClientWsStreamRejectedFrameSchema = z.object({
  protocol: z.literal(CLIENT_WS_PROTOCOL),
  type: z.literal("stream.rejected"),
  requestId: z.string().min(1),
  source: ClientMediaStreamSourceSchema,
});

export const ClientWsStreamStoppedFrameSchema = z.object({
  protocol: z.literal(CLIENT_WS_PROTOCOL),
  type: z.literal("stream.stopped"),
});

export const ClientWsAudioChunkFrameSchema = z.object({
  protocol: z.literal(CLIENT_WS_PROTOCOL),
  type: z.literal("audio.chunk"),
  streamId: z.string().min(1),
  generation: z.number().int().nonnegative(),
  seq: z.number().int().nonnegative(),
  sentAt: IsoDateTimeSchema,
  durationMs: z.number().int().positive(),
  codec: StreamCodecSchema,
  byteLength: z.number().int().nonnegative(),
  mediaStartPositionMs: z.number().int().nonnegative(),
  replayed: z.boolean(),
});

export const ClientWsStreamTransitionFrameSchema = z.object({
  protocol: z.literal(CLIENT_WS_PROTOCOL),
  type: z.literal("stream.transition"),
  streamId: z.string().min(1),
  fromGeneration: z.number().int().nonnegative(),
  toGeneration: z.number().int().nonnegative(),
  firstSeq: z.number().int().nonnegative(),
});

export const ClientWsStreamEndedFrameSchema = z.object({
  protocol: z.literal(CLIENT_WS_PROTOCOL),
  type: z.literal("stream.ended"),
  streamId: z.string().min(1),
  generation: z.number().int().nonnegative(),
});

export const ClientWsStreamErrorFrameSchema = z.object({
  protocol: z.literal(CLIENT_WS_PROTOCOL),
  type: z.literal("stream.error"),
  streamId: z.string().min(1).optional(),
  generation: z.number().int().nonnegative().optional(),
});

export const ClientWsErrorFrameSchema = z.object({
  protocol: z.literal(CLIENT_WS_PROTOCOL),
  type: z.literal("error"),
  code: z.enum([
    "invalid_frame",
    "hello_required",
    "unsupported_protocol",
    "invalid_session",
    "connection_superseded",
    "internal_error",
  ]),
  message: z.string(),
  fatal: z.literal(true),
});

export const ClientWsServerFrameSchema = z.discriminatedUnion("type", [
  ClientWsHelloAckFrameSchema,
  ClientWsSnapshotFrameSchema,
  ClientWsStateFrameSchema,
  ClientWsStreamAcceptedFrameSchema,
  ClientWsStreamRejectedFrameSchema,
  ClientWsStreamStoppedFrameSchema,
  ClientWsAudioChunkFrameSchema,
  ClientWsStreamTransitionFrameSchema,
  ClientWsStreamEndedFrameSchema,
  ClientWsStreamErrorFrameSchema,
  ClientWsErrorFrameSchema,
]);

export type ClientSessionClaimRequest = z.infer<
  typeof ClientSessionClaimRequestSchema
>;
export type ClientSessionClaimResponse = z.infer<
  typeof ClientSessionClaimResponseSchema
>;
export type ClientWsHelloFrame = z.infer<typeof ClientWsHelloFrameSchema>;
export type ClientWsStreamRequestFrame = z.infer<
  typeof ClientWsStreamRequestFrameSchema
>;
export type ClientWsStreamStopFrame = z.infer<
  typeof ClientWsStreamStopFrameSchema
>;
export type ClientWsAckFrame = z.infer<typeof ClientWsAckFrameSchema>;
export type ClientWsClientFrame = z.infer<typeof ClientWsClientFrameSchema>;
export type ClientWsHelloAckFrame = z.infer<typeof ClientWsHelloAckFrameSchema>;
export type ClientCommonSessionPage = z.infer<
  typeof ClientCommonSessionPageSchema
>;
export type ClientCommonSessionDetail = z.infer<
  typeof ClientCommonSessionDetailSchema
>;
export type ClientCommonActivePageDetail = z.infer<
  typeof ClientCommonActivePageDetailSchema
>;
export type ClientCommonGlobalSnapshot = z.infer<
  typeof ClientCommonGlobalSnapshotSchema
>;
export type ClientWsSnapshotFrame = z.infer<typeof ClientWsSnapshotFrameSchema>;
export type ClientMediaStreamSource = z.infer<
  typeof ClientMediaStreamSourceSchema
>;
export type ClientMediaNowPlaying = z.infer<typeof ClientMediaNowPlayingSchema>;
export type ClientWsStateFrame = z.infer<typeof ClientWsStateFrameSchema>;
export type ClientWsStreamAcceptedFrame = z.infer<
  typeof ClientWsStreamAcceptedFrameSchema
>;
export type ClientWsStreamRejectedFrame = z.infer<
  typeof ClientWsStreamRejectedFrameSchema
>;
export type ClientWsStreamStoppedFrame = z.infer<
  typeof ClientWsStreamStoppedFrameSchema
>;
export type ClientWsAudioChunkFrame = z.infer<
  typeof ClientWsAudioChunkFrameSchema
>;
export type ClientWsStreamTransitionFrame = z.infer<
  typeof ClientWsStreamTransitionFrameSchema
>;
export type ClientWsStreamEndedFrame = z.infer<
  typeof ClientWsStreamEndedFrameSchema
>;
export type ClientWsStreamErrorFrame = z.infer<
  typeof ClientWsStreamErrorFrameSchema
>;
export type ClientWsErrorFrame = z.infer<typeof ClientWsErrorFrameSchema>;
export type ClientWsServerFrame = z.infer<typeof ClientWsServerFrameSchema>;

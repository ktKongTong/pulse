import { z } from "zod";
import {
  IsoDateTimeSchema,
  MediaClockSchema,
  MediaItemSchema,
  MediaPlaybackSchema,
  StreamCodecSchema,
} from "./shared";

export const CLIENT_MEDIA_WS_PROTOCOL = "client.media.ws.v1";

export const ClientMediaHelloFrameSchema = z.object({
  protocol: z.literal(CLIENT_MEDIA_WS_PROTOCOL),
  type: z.literal("hello"),
  supportedProtocols: z.tuple([z.literal(CLIENT_MEDIA_WS_PROTOCOL)]),
  sdkVersion: z.string().min(1),
  sessionId: z.string().min(1),
  tabId: z.string().min(1),
});

export const ClientMediaStreamRequestFrameSchema = z.object({
  protocol: z.literal(CLIENT_MEDIA_WS_PROTOCOL),
  type: z.literal("stream.request"),
  requestId: z.string().min(1),
});

export const ClientMediaStreamStopFrameSchema = z.object({
  protocol: z.literal(CLIENT_MEDIA_WS_PROTOCOL),
  type: z.literal("stream.stop"),
});

export const ClientMediaAckFrameSchema = z.object({
  protocol: z.literal(CLIENT_MEDIA_WS_PROTOCOL),
  type: z.literal("ack"),
  streamId: z.string().min(1),
  generation: z.number().int().nonnegative(),
  seq: z.number().int().nonnegative(),
});

export const ClientMediaHelloAckFrameSchema = z.object({
  protocol: z.literal(CLIENT_MEDIA_WS_PROTOCOL),
  type: z.literal("hello_ack"),
  selectedProtocol: z.literal(CLIENT_MEDIA_WS_PROTOCOL),
  connectionId: z.string().min(1),
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

export const ClientMediaStateFrameSchema = z.object({
  protocol: z.literal(CLIENT_MEDIA_WS_PROTOCOL),
  type: z.literal("state"),
  revision: z.number().int().nonnegative(),
  updatedAt: IsoDateTimeSchema,
  media: ClientMediaNowPlayingSchema.nullable(),
  stream: z.object({
    source: ClientMediaStreamSourceSchema,
  }),
});

export const ClientMediaStreamAcceptedFrameSchema = z.object({
  protocol: z.literal(CLIENT_MEDIA_WS_PROTOCOL),
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

export const ClientMediaStreamRejectedFrameSchema = z.object({
  protocol: z.literal(CLIENT_MEDIA_WS_PROTOCOL),
  type: z.literal("stream.rejected"),
  requestId: z.string().min(1),
  source: ClientMediaStreamSourceSchema,
});

export const ClientMediaStreamStoppedFrameSchema = z.object({
  protocol: z.literal(CLIENT_MEDIA_WS_PROTOCOL),
  type: z.literal("stream.stopped"),
});

export const ClientMediaAudioChunkFrameSchema = z.object({
  protocol: z.literal(CLIENT_MEDIA_WS_PROTOCOL),
  type: z.literal("audio.chunk"),
  streamId: z.string().min(1),
  generation: z.number().int().nonnegative(),
  seq: z.number().int().nonnegative(),
  sentAt: IsoDateTimeSchema,
  durationMs: z.number().int().positive(),
  codec: StreamCodecSchema,
  byteLength: z.number().int().nonnegative(),
  replayed: z.boolean(),
});

export const ClientMediaStreamTransitionFrameSchema = z.object({
  protocol: z.literal(CLIENT_MEDIA_WS_PROTOCOL),
  type: z.literal("stream.transition"),
  streamId: z.string().min(1),
  fromGeneration: z.number().int().nonnegative(),
  toGeneration: z.number().int().nonnegative(),
  firstSeq: z.number().int().nonnegative(),
});

export const ClientMediaStreamEndedFrameSchema = z.object({
  protocol: z.literal(CLIENT_MEDIA_WS_PROTOCOL),
  type: z.literal("stream.ended"),
  streamId: z.string().min(1),
  generation: z.number().int().nonnegative(),
});

export const ClientMediaStreamErrorFrameSchema = z.object({
  protocol: z.literal(CLIENT_MEDIA_WS_PROTOCOL),
  type: z.literal("stream.error"),
  streamId: z.string().min(1).optional(),
  generation: z.number().int().nonnegative().optional(),
});

export const ClientMediaErrorFrameSchema = z.object({
  protocol: z.literal(CLIENT_MEDIA_WS_PROTOCOL),
  type: z.literal("error"),
  code: z.enum([
    "invalid_frame",
    "hello_required",
    "unsupported_protocol",
    "invalid_session",
    "internal_error",
  ]),
  message: z.string(),
  fatal: z.literal(true),
});

export const ClientMediaClientFrameSchema = z.discriminatedUnion("type", [
  ClientMediaHelloFrameSchema,
  ClientMediaStreamRequestFrameSchema,
  ClientMediaStreamStopFrameSchema,
  ClientMediaAckFrameSchema,
]);

export const ClientMediaServerFrameSchema = z.discriminatedUnion("type", [
  ClientMediaHelloAckFrameSchema,
  ClientMediaStateFrameSchema,
  ClientMediaStreamAcceptedFrameSchema,
  ClientMediaStreamRejectedFrameSchema,
  ClientMediaStreamStoppedFrameSchema,
  ClientMediaAudioChunkFrameSchema,
  ClientMediaStreamTransitionFrameSchema,
  ClientMediaStreamEndedFrameSchema,
  ClientMediaStreamErrorFrameSchema,
  ClientMediaErrorFrameSchema,
]);

export type ClientMediaHelloFrame = z.infer<typeof ClientMediaHelloFrameSchema>;
export type ClientMediaStreamRequestFrame = z.infer<
  typeof ClientMediaStreamRequestFrameSchema
>;
export type ClientMediaStreamStopFrame = z.infer<
  typeof ClientMediaStreamStopFrameSchema
>;
export type ClientMediaAckFrame = z.infer<typeof ClientMediaAckFrameSchema>;
export type ClientMediaHelloAckFrame = z.infer<
  typeof ClientMediaHelloAckFrameSchema
>;
export type ClientMediaStreamSource = z.infer<
  typeof ClientMediaStreamSourceSchema
>;
export type ClientMediaNowPlaying = z.infer<
  typeof ClientMediaNowPlayingSchema
>;
export type ClientMediaStateFrame = z.infer<typeof ClientMediaStateFrameSchema>;
export type ClientMediaStreamAcceptedFrame = z.infer<
  typeof ClientMediaStreamAcceptedFrameSchema
>;
export type ClientMediaStreamRejectedFrame = z.infer<
  typeof ClientMediaStreamRejectedFrameSchema
>;
export type ClientMediaStreamStoppedFrame = z.infer<
  typeof ClientMediaStreamStoppedFrameSchema
>;
export type ClientMediaAudioChunkFrame = z.infer<
  typeof ClientMediaAudioChunkFrameSchema
>;
export type ClientMediaStreamTransitionFrame = z.infer<
  typeof ClientMediaStreamTransitionFrameSchema
>;
export type ClientMediaStreamEndedFrame = z.infer<
  typeof ClientMediaStreamEndedFrameSchema
>;
export type ClientMediaStreamErrorFrame = z.infer<
  typeof ClientMediaStreamErrorFrameSchema
>;
export type ClientMediaErrorFrame = z.infer<typeof ClientMediaErrorFrameSchema>;
export type ClientMediaClientFrame = z.infer<
  typeof ClientMediaClientFrameSchema
>;
export type ClientMediaServerFrame = z.infer<
  typeof ClientMediaServerFrameSchema
>;

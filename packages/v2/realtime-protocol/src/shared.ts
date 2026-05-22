import { z } from "zod";

export const IsoDateTimeSchema = z.string().min(1);

export const ClientUserSchema = z.object({
  userId: z.string().min(1),
  username: z.string().min(1).optional(),
  userAvatar: z.string().min(1).optional(),
});

export const OwnerFocusSchema = z.object({
  app: z
    .object({
      id: z.string().min(1).optional(),
      name: z.string().min(1).optional(),
      category: z.string().min(1).optional(),
      icon: z.string().min(1).optional(),
    })
    .optional(),
  window: z
    .object({
      title: z.string().min(1).optional(),
    })
    .optional(),
  updatedAt: IsoDateTimeSchema,
});

export const StreamCodecSchema = z.enum(["pcm16-wav", "opus", "aac", "mp3"]);

export const StreamFormatSchema = z.object({
  codec: StreamCodecSchema,
  sampleRate: z.number().int().positive(),
  channels: z.number().int().positive(),
  bitDepth: z.number().int().positive().optional(),
});

export const MediaPlaybackSchema = z.enum(["playing", "paused"]);

export const MediaItemSchema = z.object({
  provider: z.string().min(1).optional(),
  providerId: z.string().min(1).optional(),
  source: z.string().min(1).optional(),
  itemType: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
  trackId: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  artist: z.string().min(1).optional(),
  album: z.string().min(1).optional(),
  albumArtist: z.string().min(1).optional(),
  artworkUrl: z.string().min(1).optional(),
  linkUrl: z.string().min(1).optional(),
  progressSeconds: z.number().nonnegative().optional(),
  durationSeconds: z.number().nonnegative().optional(),
  playbackState: MediaPlaybackSchema.optional(),
  trackNumber: z.number().int().nonnegative().optional(),
  discNumber: z.number().int().nonnegative().optional(),
  collectionId: z.string().min(1).optional(),
  collectionTitle: z.string().min(1).optional(),
  collectionLinkUrl: z.string().min(1).optional(),
});

export const MediaClockSchema = z.object({
  mediaProgressSeconds: z.number().nonnegative().optional(),
  durationSeconds: z.number().nonnegative().optional(),
  updatedAt: IsoDateTimeSchema.optional(),
});

export const CaptureInfoSchema = z.object({
  provider: z.string().min(1).optional(),
  displayName: z.string().min(1).optional(),
  appId: z.string().min(1).optional(),
});

export const StreamBlockedReasonSchema = z.enum([
  "no_playable_media",
  "capture_permission_missing",
  "capture_permission_revoked",
  "capture_source_unavailable",
  "capture_source_lost",
  "unsupported_app",
  "native_error",
]);

export const DeviceStreamStoppedReasonSchema = z.union([
  StreamBlockedReasonSchema,
  z.enum(["native_shutdown", "manual_stop"]),
]);

export type ClientUser = z.infer<typeof ClientUserSchema>;
export type OwnerFocus = z.infer<typeof OwnerFocusSchema>;
export type StreamCodec = z.infer<typeof StreamCodecSchema>;
export type StreamFormat = z.infer<typeof StreamFormatSchema>;
export type MediaPlayback = z.infer<typeof MediaPlaybackSchema>;
export type MediaItem = z.infer<typeof MediaItemSchema>;
export type MediaClock = z.infer<typeof MediaClockSchema>;
export type CaptureInfo = z.infer<typeof CaptureInfoSchema>;
export type StreamBlockedReason = z.infer<typeof StreamBlockedReasonSchema>;
export type DeviceStreamStoppedReason = z.infer<
  typeof DeviceStreamStoppedReasonSchema
>;

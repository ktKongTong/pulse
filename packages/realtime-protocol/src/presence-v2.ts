import { z } from "zod";

export const PRESENCE_PROTOCOL_V2 = "presence.v2";
export const PRESENCE_STREAM_PROTOCOL_V2 = "presence.v2-stream";
export const PRESENCE_ACK_PROTOCOL_V2 = "presence.v2-ack";

export const PresencePlatformSchema = z.enum(["macos", "windows", "linux", "other"]);
export const PresenceAvailabilityStateSchema = z.enum(["active", "idle", "locked", "sleeping", "offline"]);
export const PresenceFocusStateSchema = z.enum(["foreground", "background", "none"]);
export const PresenceKindSchema = z.enum(["interactive", "passive", "media"]);
export const PresenceEventKindSchema = z.enum(["snapshot", "heartbeat", "session_end"]);
export const MediaProviderKindSchema = z.enum(["music", "video", "other"]);
export const MediaItemTypeSchema = z.enum(["track", "album", "playlist", "episode", "stream", "unknown"]);
export const MediaPlaybackStateSchema = z.enum(["playing", "paused", "stopped"]);
export const MediaPlaybackScopeSchema = z.enum(["local", "remote"]);
export const PresenceStreamKindSchema = z.enum([
  "snapshot.updated",
  "stats.updated",
  "sync.reset",
  "error"
]);

export const PresenceAppSchema = z.object({
  name: z.string().optional(),
  id: z.string().optional(),
  category: z.string().optional()
});

export const PresenceWindowSchema = z.object({
  title: z.string().optional()
});

export const PresencePageSchema = z.object({
  title: z.string().optional(),
  url: z.string().optional()
});

export const PresenceAvailabilitySchema = z.object({
  state: PresenceAvailabilityStateSchema,
  idleSeconds: z.number().int().nonnegative().optional()
});

export const PresenceFocusSchema = z.object({
  state: PresenceFocusStateSchema,
  app: PresenceAppSchema.optional(),
  window: PresenceWindowSchema.optional(),
  page: PresencePageSchema.optional()
});

export const MediaProviderSchema = z.object({
  id: z.string(),
  kind: MediaProviderKindSchema
});

export const MediaItemSchema = z.object({
  type: MediaItemTypeSchema,
  id: z.string().optional(),
  uri: z.string().optional(),
  title: z.string().optional(),
  artist: z.string().optional(),
  album: z.string().optional(),
  artworkUrl: z.string().url().optional(),
  linkUrl: z.string().url().optional(),
  linkUri: z.string().optional()
}).transform((value) => {
  if (value.linkUrl) return value;
  const { linkUri, ...rest } = value;
  return { ...rest, linkUrl: linkUri };
});

export const MediaPlaybackSchema = z.object({
  state: MediaPlaybackStateSchema,
  progressSeconds: z.number().nonnegative().optional(),
  durationSeconds: z.number().int().nonnegative().optional(),
  scope: MediaPlaybackScopeSchema
});

export const PresenceExtensionsSchema = z.object({
  values: z.record(z.string(), z.unknown()).optional()
}).optional();

export const PresenceMediaSessionSchema = z.object({
  provider: MediaProviderSchema,
  item: MediaItemSchema,
  playback: MediaPlaybackSchema,
  extensions: PresenceExtensionsSchema
});

export const PresenceDeviceSchema = z.object({
  name: z.string(),
  platform: PresencePlatformSchema,
  appVersion: z.string().optional(),
  mode: z.string().optional(),
  userName: z.string().optional()
});

export const PresenceCapabilitiesSchema = z.object({
  pageTitle: z.boolean().default(false),
  pageUrl: z.boolean().default(false),
  media: z.boolean().default(false),
  localPlayback: z.boolean().default(false),
  remotePlayback: z.boolean().default(false)
});

export const PresenceStatePayloadSchema = z.object({
  availability: PresenceAvailabilitySchema,
  focus: PresenceFocusSchema,
  presenceKind: PresenceKindSchema,
  mediaSessions: z.array(PresenceMediaSessionSchema).default([]),
  device: PresenceDeviceSchema,
  capabilities: PresenceCapabilitiesSchema,
  extensions: PresenceExtensionsSchema
});

export const PresenceEventSchema = z.object({
  eventId: z.string(),
  seq: z.number().int().nonnegative(),
  kind: PresenceEventKindSchema,
  observedAt: z.string(),
  sentAt: z.string(),
  state: PresenceStatePayloadSchema.nullable().optional()
});

export const PresenceIngestRequestSchema = z.object({
  protocol: z.literal(PRESENCE_PROTOCOL_V2).default(PRESENCE_PROTOCOL_V2),
  workspaceId: z.string().min(1),
  deviceId: z.string().min(1),
  sessionId: z.string().min(1),
  events: z.array(PresenceEventSchema).min(1)
});

export const PresenceRejectedEventSchema = z.object({
  eventId: z.string(),
  reason: z.string()
});

export const PresenceIngestAckSchema = z.object({
  protocol: z.literal(PRESENCE_ACK_PROTOCOL_V2).default(PRESENCE_ACK_PROTOCOL_V2),
  workspaceId: z.string(),
  deviceId: z.string(),
  acceptedSeqMax: z.number().int().nonnegative(),
  dedupedEventIds: z.array(z.string()).default([]),
  rejected: z.array(PresenceRejectedEventSchema).default([]),
  workspaceRevision: z.number().int().nonnegative()
});

export const PresenceStreamEnvelopeSchema = z.object({
  protocol: z.literal(PRESENCE_STREAM_PROTOCOL_V2).default(PRESENCE_STREAM_PROTOCOL_V2),
  kind: PresenceStreamKindSchema,
  revision: z.number().int().nonnegative(),
  workspaceId: z.string(),
  deviceId: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional()
});

export type PresenceIngestRequest = z.infer<typeof PresenceIngestRequestSchema>;
export type PresenceIngestAck = z.infer<typeof PresenceIngestAckSchema>;
export type PresenceEvent = z.infer<typeof PresenceEventSchema>;
export type PresenceStatePayload = z.infer<typeof PresenceStatePayloadSchema>;
export type PresenceStreamEnvelope = z.infer<typeof PresenceStreamEnvelopeSchema>;
export type PresenceFocus = z.infer<typeof PresenceFocusSchema>;
export type PresencePage = z.infer<typeof PresencePageSchema>;
export type PresenceApp = z.infer<typeof PresenceAppSchema>;
export type PresenceMediaSession = z.infer<typeof PresenceMediaSessionSchema>;

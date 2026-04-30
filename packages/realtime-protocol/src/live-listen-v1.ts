import { z } from "zod";

export const LIVE_LISTEN_PROTOCOL_V1 = "live-listen.v1";
export const LIVE_LISTEN_STREAM_PROTOCOL_V1 = "live-listen.stream.v1";

export const LiveListenRoomStateSchema = z.enum([
  "offline",
  "starting",
  "live",
  "ended",
  "error",
]);

export const LiveListenParticipantRoleSchema = z.enum(["host", "listener"]);
export const LiveListenAudioTransportSchema = z.enum(["cloudflare-realtime"]);
export const LiveListenProviderSchema = z.enum([
  "spotify",
  "apple-music",
  "netease-music",
  "qq-music",
  "local",
  "other",
]);
export const LiveListenPlaybackStateSchema = z.enum([
  "playing",
  "paused",
  "stopped",
]);
export const LiveListenStreamEventKindSchema = z.enum([
  "snapshot.updated",
  "token.issued",
  "participant.joined",
  "participant.left",
  "error",
]);

export const LiveListenMediaSchema = z.object({
  providerId: z.string().optional(),
  provider: LiveListenProviderSchema.optional(),
  itemType: z.string().optional(),
  trackId: z.string().optional(),
  uri: z.string().optional(),
  linkUrl: z.string().url().optional(),
  title: z.string().optional(),
  artist: z.string().optional(),
  album: z.string().optional(),
  artworkUrl: z.string().url().optional(),
  durationSeconds: z.number().nonnegative().optional(),
  playbackState: LiveListenPlaybackStateSchema.optional(),
});

export const LiveListenClockSchema = z.object({
  mediaProgressSeconds: z.number().nonnegative(),
  observedAt: z.string(),
  streamLatencyMs: z.number().int().nonnegative().optional(),
  sequence: z.number().int().nonnegative(),
});

export const LiveListenAudioSessionSchema = z.object({
  transport: LiveListenAudioTransportSchema,
  sessionId: z.string().min(1),
  roomName: z.string().min(1).optional(),
  publishTrackName: z.string().min(1).optional(),
  partyTracksPrefix: z.string().min(1).optional(),
  track: z.object({
    location: z.enum(["local", "remote"]).optional(),
    trackName: z.string().min(1).optional(),
    sessionId: z.string().min(1).optional(),
    mid: z.string().nullable().optional(),
  }).optional(),
  mockToken: z.boolean().optional(),
});

export const LiveListenErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
});

export const LiveListenSnapshotSchema = z.object({
  protocol: z.literal(LIVE_LISTEN_PROTOCOL_V1).default(LIVE_LISTEN_PROTOCOL_V1),
  roomId: z.string().min(1),
  workspaceId: z.string().min(1),
  state: LiveListenRoomStateSchema,
  listenerCount: z.number().int().nonnegative(),
  hostDeviceId: z.string().min(1).optional(),
  startedAt: z.string().optional(),
  updatedAt: z.string(),
  audio: LiveListenAudioSessionSchema.optional(),
  media: LiveListenMediaSchema.optional(),
  clock: LiveListenClockSchema.optional(),
  error: LiveListenErrorSchema.optional(),
});

export const LiveListenHostStartRequestSchema = z.object({
  protocol: z.literal(LIVE_LISTEN_PROTOCOL_V1).default(LIVE_LISTEN_PROTOCOL_V1),
  workspaceId: z.string().min(1),
  roomId: z.string().min(1),
  hostDeviceId: z.string().min(1),
  requestedAt: z.string(),
  audio: LiveListenAudioSessionSchema.optional(),
});

export const LiveListenHostHeartbeatRequestSchema = z.object({
  protocol: z.literal(LIVE_LISTEN_PROTOCOL_V1).default(LIVE_LISTEN_PROTOCOL_V1),
  workspaceId: z.string().min(1),
  roomId: z.string().min(1),
  hostDeviceId: z.string().min(1),
  sentAt: z.string(),
  audio: LiveListenAudioSessionSchema.optional(),
  media: LiveListenMediaSchema.optional(),
  clock: LiveListenClockSchema.optional(),
});

export const LiveListenHostStopRequestSchema = z.object({
  protocol: z.literal(LIVE_LISTEN_PROTOCOL_V1).default(LIVE_LISTEN_PROTOCOL_V1),
  workspaceId: z.string().min(1),
  roomId: z.string().min(1),
  hostDeviceId: z.string().min(1),
  stoppedAt: z.string(),
  reason: z.string().optional(),
});

export const LiveListenTokenSchema = z.object({
  transport: LiveListenAudioTransportSchema,
  sessionId: z.string().min(1),
  participantId: z.string().min(1),
  role: LiveListenParticipantRoleSchema,
  token: z.string().min(1),
  expiresAt: z.string(),
});

export const LiveListenTokenResponseSchema = z.object({
  protocol: z.literal(LIVE_LISTEN_PROTOCOL_V1).default(LIVE_LISTEN_PROTOCOL_V1),
  roomId: z.string().min(1),
  workspaceId: z.string().min(1),
  snapshot: LiveListenSnapshotSchema,
  token: LiveListenTokenSchema,
});

export const LiveListenListenerJoinRequestSchema = z.object({
  protocol: z.literal(LIVE_LISTEN_PROTOCOL_V1).default(LIVE_LISTEN_PROTOCOL_V1),
  workspaceId: z.string().min(1),
  roomId: z.string().min(1),
  participantId: z.string().min(1),
  joinedAt: z.string(),
});

export const LiveListenListenerLeaveRequestSchema = z.object({
  protocol: z.literal(LIVE_LISTEN_PROTOCOL_V1).default(LIVE_LISTEN_PROTOCOL_V1),
  workspaceId: z.string().min(1),
  roomId: z.string().min(1),
  participantId: z.string().min(1),
  leftAt: z.string(),
});

export const LiveListenStreamEnvelopeSchema = z.object({
  protocol: z
    .literal(LIVE_LISTEN_STREAM_PROTOCOL_V1)
    .default(LIVE_LISTEN_STREAM_PROTOCOL_V1),
  kind: LiveListenStreamEventKindSchema,
  workspaceId: z.string().min(1),
  roomId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  snapshot: LiveListenSnapshotSchema.optional(),
  token: LiveListenTokenSchema.optional(),
  participantId: z.string().min(1).optional(),
  error: LiveListenErrorSchema.optional(),
});

export type LiveListenRoomState = z.infer<typeof LiveListenRoomStateSchema>;
export type LiveListenParticipantRole = z.infer<
  typeof LiveListenParticipantRoleSchema
>;
export type LiveListenAudioTransport = z.infer<
  typeof LiveListenAudioTransportSchema
>;
export type LiveListenProvider = z.infer<typeof LiveListenProviderSchema>;
export type LiveListenPlaybackState = z.infer<
  typeof LiveListenPlaybackStateSchema
>;
export type LiveListenStreamEventKind = z.infer<
  typeof LiveListenStreamEventKindSchema
>;
export type LiveListenMedia = z.infer<typeof LiveListenMediaSchema>;
export type LiveListenClock = z.infer<typeof LiveListenClockSchema>;
export type LiveListenAudioSession = z.infer<
  typeof LiveListenAudioSessionSchema
>;
export type LiveListenError = z.infer<typeof LiveListenErrorSchema>;
export type LiveListenSnapshot = z.infer<typeof LiveListenSnapshotSchema>;
export type LiveListenHostStartRequest = z.input<
  typeof LiveListenHostStartRequestSchema
>;
export type LiveListenHostHeartbeatRequest = z.input<
  typeof LiveListenHostHeartbeatRequestSchema
>;
export type LiveListenHostStopRequest = z.input<
  typeof LiveListenHostStopRequestSchema
>;
export type LiveListenToken = z.infer<typeof LiveListenTokenSchema>;
export type LiveListenTokenResponse = z.infer<
  typeof LiveListenTokenResponseSchema
>;
export type LiveListenListenerJoinRequest = z.input<
  typeof LiveListenListenerJoinRequestSchema
>;
export type LiveListenListenerLeaveRequest = z.input<
  typeof LiveListenListenerLeaveRequestSchema
>;
export type LiveListenStreamEnvelope = z.infer<
  typeof LiveListenStreamEnvelopeSchema
>;

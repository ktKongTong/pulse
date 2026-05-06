import { z } from "zod";

export const LIVE_LISTEN_PROTOCOL_V1 = "live-listen.server.v1";
export const LIVE_LISTEN_DEVICE_PROTOCOL_V1 = "live-listen.device.v1";
export const LIVE_LISTEN_OBSERVE_PROTOCOL_V1 = "live-listen.observe.v1";
export const LIVE_LISTEN_MEDIA_SESSION_PROTOCOL_V1 = "live-listen.media-session.v1";
export const LIVE_LISTEN_STREAM_PROTOCOL_V1 = LIVE_LISTEN_MEDIA_SESSION_PROTOCOL_V1;

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
]);

const OptionalLiveListenWebUrlSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return trimmed;
  } catch {
    return undefined;
  }
}, z.string().url().optional());

export const LiveListenMediaSchema = z.object({
  providerId: z.string().optional(),
  provider: LiveListenProviderSchema.optional(),
  itemType: z.string().optional(),
  trackId: z.string().optional(),
  uri: z.string().optional(),
  linkUrl: OptionalLiveListenWebUrlSchema,
  title: z.string().optional(),
  artist: z.string().optional(),
  album: z.string().optional(),
  artworkUrl: OptionalLiveListenWebUrlSchema,
  durationSeconds: z.number().nonnegative().optional(),
  playbackState: LiveListenPlaybackStateSchema.optional(),
});

export const LiveListenPlayableMediaSchema = LiveListenMediaSchema.extend({
  playbackState: z.literal("playing"),
});

export const LiveListenClockSchema = z.object({
  mediaProgressSeconds: z.number().nonnegative(),
  observedAt: z.string(),
  streamLatencyMs: z.number().int().nonnegative().optional(),
  sequence: z.number().int().nonnegative(),
});

export const LiveListenErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
});

export const LiveListenAdmissionBlockedReasonSchema = z.enum([
  "device_offline",
  "live_listen_disabled",
  "no_playable_media",
  "capture_permission_missing",
  "capture_permission_revoked",
  "capture_source_unavailable",
  "capture_source_lost",
  "unsupported_app",
  "native_error",
  "connection_lost",
  "snapshot_unavailable",
  "auth_failed",
  "protocol_error",
  "session_rejected",
]);

export const LiveListenMediaPermissionSchema = z.enum(["allow", "disallow"]);
export const LiveListenCaptureRuntimeSchema = z.enum(["capturing", "no-capture"]);

export const LiveListenNativeMediaStateSchema = z.object({
  permission: LiveListenMediaPermissionSchema,
  playback: LiveListenPlaybackStateSchema,
  capture: LiveListenCaptureRuntimeSchema,
  reason: LiveListenAdmissionBlockedReasonSchema.optional(),
  message: z.string().optional(),
  media: LiveListenMediaSchema.optional(),
});

export const LiveListenListenerPresenceSchema = z.object({
  activeCount: z.number().int().nonnegative(),
  graceCount: z.number().int().nonnegative(),
  demand: z.enum(["wanted", "not-wanted"]),
});

export const LiveListenNativeLinkSchema = z.object({
  state: z.enum(["connected", "disconnected", "error"]),
  deviceId: z.string().min(1).optional(),
  connectedAt: z.string().optional(),
  disconnectedAt: z.string().optional(),
  graceDeadlineAt: z.string().optional(),
  lastError: LiveListenErrorSchema.optional(),
});

export const LiveListenAdmissionSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("open"),
  }),
  z.object({
    state: z.literal("blocked"),
    reason: LiveListenAdmissionBlockedReasonSchema,
    message: z.string().optional(),
  }),
]);

export const LiveListenRecentMediaSchema = LiveListenMediaSchema.extend({
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  lastProgressSeconds: z.number().nonnegative().optional(),
  sourceDeviceId: z.string().optional(),
});

export const LiveListenRoomMediaStateSchema = z.object({
  current: LiveListenMediaSchema.nullish(),
  recent: z.array(LiveListenRecentMediaSchema),
  playback: LiveListenPlaybackStateSchema,
  clock: LiveListenClockSchema.optional(),
  sourceDeviceId: z.string().optional(),
  updatedAt: z.string().optional(),
});

export const LiveListenStreamDemandSchema = z.object({
  state: z.enum(["wanted", "not-wanted"]),
  reason: z.enum(["listener-demand", "no-listeners", "manual-stop"]),
  updatedAt: z.string(),
});

export const LiveListenAudioFlowSchema = z.object({
  state: z.enum(["none", "starting", "flowing", "stalled", "failed"]),
  streamId: z.string().optional(),
  generation: z.number().int().positive().optional(),
  latestSeq: z.number().int().nonnegative(),
  availableFromSeq: z.number().int().nonnegative(),
  lastChunkAt: z.string().optional(),
  failure: LiveListenErrorSchema.optional(),
});

export const LiveListenMediaSessionSnapshotSchema = z.object({
  protocol: z
    .literal(LIVE_LISTEN_MEDIA_SESSION_PROTOCOL_V1)
    .default(LIVE_LISTEN_MEDIA_SESSION_PROTOCOL_V1),
  workspaceId: z.string().min(1),
  roomId: z.string().min(1),
  listeners: LiveListenListenerPresenceSchema,
  nativeLink: LiveListenNativeLinkSchema,
  nativeMediaState: LiveListenNativeMediaStateSchema,
  admission: LiveListenAdmissionSchema,
  streamDemand: LiveListenStreamDemandSchema,
  audioFlow: LiveListenAudioFlowSchema,
  media: LiveListenRoomMediaStateSchema,
  updatedAt: z.string(),
});

export const LiveListenSnapshotSchema = z.object({
  protocol: z.literal(LIVE_LISTEN_PROTOCOL_V1).default(LIVE_LISTEN_PROTOCOL_V1),
  workspaceId: z.string().min(1),
  roomId: z.string().min(1),
  listeners: LiveListenListenerPresenceSchema,
  nativeLink: LiveListenNativeLinkSchema,
  admission: LiveListenAdmissionSchema,
  streamDemand: LiveListenStreamDemandSchema,
  audioFlow: LiveListenAudioFlowSchema,
  media: LiveListenRoomMediaStateSchema,
  updatedAt: z.string(),
});

export const LiveListenSessionEventTypeSchema = z.enum([
  "session.accepted",
  "session.rejected",
  "session.resumed",
  "snapshot.updated",
  "audio.chunk",
  "replay.miss",
  "stream.gap",
  "stream.transition",
  "stream.ended",
  "stream.error",
]);

export const LiveListenSessionEnvelopeSchema = z.object({
  protocol: z
    .literal(LIVE_LISTEN_MEDIA_SESSION_PROTOCOL_V1)
    .default(LIVE_LISTEN_MEDIA_SESSION_PROTOCOL_V1),
  type: LiveListenSessionEventTypeSchema,
  workspaceId: z.string().min(1).optional(),
  roomId: z.string().min(1).optional(),
  participantId: z.string().min(1).optional(),
  resumeToken: z.string().min(1).optional(),
  serverTime: z.string().optional(),
  reason: z.string().optional(),
  message: z.string().optional(),
  snapshot: LiveListenSnapshotSchema.optional(),
  streamId: z.string().optional(),
  generation: z.number().int().positive().optional(),
  requestedFromSeq: z.number().int().nonnegative().optional(),
  availableFromSeq: z.number().int().nonnegative().optional(),
  latestSeq: z.number().int().nonnegative().optional(),
  seq: z.number().int().nonnegative().optional(),
  sentAt: z.string().optional(),
  durationMs: z.number().int().positive().optional(),
  codec: z.literal("pcm16-wav").optional(),
  byteLength: z.number().int().nonnegative().optional(),
  data: z.string().optional(),
  replayed: z.boolean().optional(),
  missingUntilSeq: z.number().int().nonnegative().optional(),
  nextGeneration: z.number().int().positive().optional(),
  fromGeneration: z.number().int().positive().optional(),
  toGeneration: z.number().int().positive().optional(),
});

export const LiveListenDeviceCapabilitiesSchema = z.object({
  binaryAudio: z.boolean().optional(),
  localRingBuffer: z.boolean().optional(),
  localRingBufferSeconds: z.number().int().nonnegative().optional(),
});

export const LiveListenDeviceFrameSchema = z.discriminatedUnion("type", [
  z.object({
    protocol: z.literal(LIVE_LISTEN_DEVICE_PROTOCOL_V1),
    type: z.literal("device.hello"),
    deviceId: z.string().min(1),
    sentAt: z.string(),
    lastStreamId: z.string().optional(),
    lastGeneration: z.number().int().positive().optional(),
    lastSeq: z.number().int().nonnegative().optional(),
    capabilities: LiveListenDeviceCapabilitiesSchema.optional(),
    mediaState: LiveListenNativeMediaStateSchema,
  }),
  z.object({
    protocol: z.literal(LIVE_LISTEN_DEVICE_PROTOCOL_V1),
    type: z.literal("media.state.updated"),
    deviceId: z.string().min(1),
    sentAt: z.string(),
    mediaState: LiveListenNativeMediaStateSchema,
  }),
  z.object({
    protocol: z.literal(LIVE_LISTEN_DEVICE_PROTOCOL_V1),
    type: z.literal("media.updated"),
    deviceId: z.string().min(1),
    sentAt: z.string(),
    media: LiveListenMediaSchema,
    clock: LiveListenClockSchema.optional(),
  }),
  z.object({
    protocol: z.literal(LIVE_LISTEN_DEVICE_PROTOCOL_V1),
    type: z.literal("stream.heartbeat"),
    deviceId: z.string().min(1),
    streamId: z.string(),
    generation: z.number().int().positive(),
    sentAt: z.string(),
    lastSeq: z.number().int().nonnegative(),
    clock: LiveListenClockSchema.optional(),
    capture: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    protocol: z.literal(LIVE_LISTEN_DEVICE_PROTOCOL_V1),
    type: z.literal("ack"),
    commandId: z.string(),
    status: z.enum(["started", "resumed", "resumed_with_gap", "stopped", "rejected", "restarted"]),
    streamId: z.string().optional(),
    generation: z.number().int().positive().optional(),
    firstSeq: z.number().int().nonnegative().optional(),
    missingBeforeSeq: z.number().int().nonnegative().optional(),
    sentAt: z.string(),
  }),
  z.object({
    protocol: z.literal(LIVE_LISTEN_DEVICE_PROTOCOL_V1),
    type: z.literal("stream.stopped"),
    streamId: z.string(),
    generation: z.number().int().positive(),
    reason: z.enum([
      "last_listener_disconnected",
      "live_listen_disabled",
      "capture_permission_revoked",
      "capture_source_lost",
      "native_shutdown",
      "manual_stop",
      "no_playable_media",
      "capture_permission_missing",
      "capture_source_unavailable",
      "unsupported_app",
    ]),
    sentAt: z.string(),
  }),
  z.object({
    protocol: z.literal(LIVE_LISTEN_DEVICE_PROTOCOL_V1),
    type: z.literal("error"),
    deviceId: z.string().min(1).optional(),
    sentAt: z.string(),
    error: LiveListenErrorSchema,
  }),
]);

export const LiveListenDeviceCommandEnvelopeSchema = z.object({
  protocol: z.literal(LIVE_LISTEN_DEVICE_PROTOCOL_V1),
  type: z.literal("command"),
  commandId: z.string(),
  sentAt: z.string(),
  expiresAt: z.string(),
  command: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("stream.start"),
      streamId: z.string(),
      generation: z.number().int().positive(),
      capture: z.object({
        mode: z.string(),
        preferredProvider: z.string().optional(),
        fallback: z.string().optional(),
      }),
      audio: z.object({
        codec: z.literal("pcm16-wav"),
        chunkDurationMs: z.number().int().positive(),
        targetLatencyMs: z.number().int().nonnegative(),
      }),
    }),
    z.object({
      type: z.literal("stream.resume"),
      streamId: z.string(),
      generation: z.number().int().positive(),
      fromSeq: z.number().int().nonnegative(),
      audio: z.object({
        codec: z.literal("pcm16-wav"),
        chunkDurationMs: z.number().int().positive(),
        targetLatencyMs: z.number().int().nonnegative(),
      }),
    }),
    z.object({
      type: z.literal("stream.stop"),
      streamId: z.string().optional(),
      reason: z.string(),
    }),
  ]),
});

export const LiveListenObserveEnvelopeSchema = z.object({
  protocol: z.literal(LIVE_LISTEN_OBSERVE_PROTOCOL_V1),
  type: z.literal("telemetry"),
  snapshot: z.record(z.string(), z.unknown()),
});

export const LiveListenMediaSessionSnapshotEnvelopeSchema = z.object({
  protocol: z.literal(LIVE_LISTEN_MEDIA_SESSION_PROTOCOL_V1),
  type: z.literal("media.snapshot.updated"),
  snapshot: LiveListenMediaSessionSnapshotSchema,
});

export const LiveListenMediaSessionListenEnvelopeSchema = LiveListenSessionEnvelopeSchema.extend({
  protocol: z.literal(LIVE_LISTEN_MEDIA_SESSION_PROTOCOL_V1),
});

export const LiveListenMediaSessionEnvelopeSchema = z.union([
  LiveListenMediaSessionSnapshotEnvelopeSchema,
  LiveListenMediaSessionListenEnvelopeSchema,
]);

export const LiveListenMediaSessionClientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    protocol: z.literal(LIVE_LISTEN_MEDIA_SESSION_PROTOCOL_V1),
    type: z.literal("listen.request"),
    participantId: z.string().min(1),
    resumeToken: z.string().min(1).optional(),
    streamId: z.string().min(1).optional(),
    sourceGeneration: z.number().int().positive().optional(),
    fromSeq: z.number().int().nonnegative().optional(),
  }),
  z.object({
    protocol: z.literal(LIVE_LISTEN_MEDIA_SESSION_PROTOCOL_V1),
    type: z.literal("listen.stop"),
    participantId: z.string().min(1).optional(),
  }),
  z.object({
    protocol: z.literal(LIVE_LISTEN_MEDIA_SESSION_PROTOCOL_V1),
    type: z.literal("ack"),
    seq: z.number().int().nonnegative(),
  }),
]);

export const LiveListenAudioTransportSchema = z.enum(["cloudflare-realtime"]);
export const LiveListenParticipantRoleSchema = z.enum(["host", "listener"]);
export const LiveListenAudioSessionSchema = z.object({
  transport: LiveListenAudioTransportSchema,
  sessionId: z.string().min(1),
  roomName: z.string().min(1).optional(),
  publishTrackName: z.string().min(1).optional(),
  partyTracksPrefix: z.string().min(1).optional(),
  track: z
    .object({
      location: z.enum(["local", "remote"]).optional(),
      trackName: z.string().min(1).optional(),
      sessionId: z.string().min(1).optional(),
      mid: z.string().nullable().optional(),
    })
    .optional(),
  mockToken: z.boolean().optional(),
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

export const LiveListenStreamEnvelopeSchema = LiveListenSessionEnvelopeSchema;

export type LiveListenProvider = z.infer<typeof LiveListenProviderSchema>;
export type LiveListenPlaybackState = z.infer<typeof LiveListenPlaybackStateSchema>;
export type LiveListenMedia = z.infer<typeof LiveListenMediaSchema>;
export type LiveListenPlayableMedia = z.infer<typeof LiveListenPlayableMediaSchema>;
export type LiveListenClock = z.infer<typeof LiveListenClockSchema>;
export type LiveListenError = z.infer<typeof LiveListenErrorSchema>;
export type LiveListenAdmissionBlockedReason = z.infer<typeof LiveListenAdmissionBlockedReasonSchema>;
export type LiveListenMediaPermission = z.infer<typeof LiveListenMediaPermissionSchema>;
export type LiveListenCaptureRuntime = z.infer<typeof LiveListenCaptureRuntimeSchema>;
export type LiveListenNativeMediaState = z.infer<typeof LiveListenNativeMediaStateSchema>;
export type LiveListenListenerPresence = z.infer<typeof LiveListenListenerPresenceSchema>;
export type LiveListenNativeLink = z.infer<typeof LiveListenNativeLinkSchema>;
export type LiveListenAdmission = z.infer<typeof LiveListenAdmissionSchema>;
export type LiveListenRecentMedia = z.infer<typeof LiveListenRecentMediaSchema>;
export type LiveListenRoomMediaState = z.infer<typeof LiveListenRoomMediaStateSchema>;
export type LiveListenMediaSessionSnapshot = z.infer<typeof LiveListenMediaSessionSnapshotSchema>;
export type LiveListenStreamDemand = z.infer<typeof LiveListenStreamDemandSchema>;
export type LiveListenAudioFlow = z.infer<typeof LiveListenAudioFlowSchema>;
export type LiveListenSnapshot = z.infer<typeof LiveListenSnapshotSchema>;
export type LiveListenSessionEnvelope = z.infer<typeof LiveListenSessionEnvelopeSchema>;
export type LiveListenStreamEnvelope = LiveListenSessionEnvelope;
export type LiveListenDeviceFrame = z.infer<typeof LiveListenDeviceFrameSchema>;
export type LiveListenDeviceCommandEnvelope = z.infer<typeof LiveListenDeviceCommandEnvelopeSchema>;
export type LiveListenObserveEnvelope = z.infer<typeof LiveListenObserveEnvelopeSchema>;
export type LiveListenMediaSessionEnvelope = z.infer<typeof LiveListenMediaSessionEnvelopeSchema>;
export type LiveListenMediaSessionClientMessage = z.infer<typeof LiveListenMediaSessionClientMessageSchema>;
export type LiveListenAudioTransport = z.infer<typeof LiveListenAudioTransportSchema>;
export type LiveListenParticipantRole = z.infer<typeof LiveListenParticipantRoleSchema>;
export type LiveListenAudioSession = z.infer<typeof LiveListenAudioSessionSchema>;
export type LiveListenHostStartRequest = z.input<typeof LiveListenHostStartRequestSchema>;
export type LiveListenHostHeartbeatRequest = z.input<typeof LiveListenHostHeartbeatRequestSchema>;
export type LiveListenHostStopRequest = z.input<typeof LiveListenHostStopRequestSchema>;
export type LiveListenToken = z.infer<typeof LiveListenTokenSchema>;
export type LiveListenTokenResponse = z.infer<typeof LiveListenTokenResponseSchema>;
export type LiveListenListenerJoinRequest = z.input<typeof LiveListenListenerJoinRequestSchema>;
export type LiveListenListenerLeaveRequest = z.input<typeof LiveListenListenerLeaveRequestSchema>;

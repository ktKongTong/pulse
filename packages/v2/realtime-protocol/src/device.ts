import { z } from "zod";
import {
  CaptureInfoSchema,
  DeviceStreamStoppedReasonSchema,
  IsoDateTimeSchema,
  MediaClockSchema,
  MediaItemSchema,
  StreamBlockedReasonSchema,
  StreamCodecSchema,
  StreamFormatSchema,
} from "./shared";

export const DEVICE_CONNECTION_PROTOCOL = "device.connection.v1";
export const DEVICE_MEDIA_CONNECTION_PROTOCOL = "device.media.connection.v1";
export const DEVICE_MEDIA_PROTOCOL = "device.media.v1";
export const PRESENCE_PROTOCOL = "presence.v2";

export const DeviceCommonConnectionHelloFrameSchema = z.object({
  protocol: z.literal(DEVICE_CONNECTION_PROTOCOL),
  type: z.literal("hello"),
  payload: z.object({
    device: z.object({
      name: z.string().min(1),
      platform: z.enum(["macos", "windows", "linux", "other"]),
      appVersion: z.string().min(1).optional(),
      mode: z.string().min(1).optional(),
      displayName: z.string().min(1).optional(),
    }),
    capabilities: z.object({
      focusApp: z.boolean(),
      windowTitle: z.boolean(),
      pageTitle: z.boolean(),
      pageUrl: z.boolean(),
    }),
    supportedProtocols: z.array(z.string().min(1)).min(1),
  }),
});

export const DeviceCommonConnectionHelloAckFrameSchema = z.object({
  protocol: z.literal(DEVICE_CONNECTION_PROTOCOL),
  type: z.literal("hello_ack"),
  payload: z.discriminatedUnion("accepted", [
    z.object({
      accepted: z.literal(true),
      serverTime: IsoDateTimeSchema,
      connectionId: z.string().min(1),
      deviceSessionId: z.string().min(1),
      selectedProtocols: z.array(z.string().min(1)),
    }),
    z.object({
      accepted: z.literal(false),
      serverTime: IsoDateTimeSchema,
      error: z.object({
        code: z.string().min(1),
        message: z.string(),
      }),
    }),
  ]),
});

export const CommonPresenceStateSchema = z.object({
  availability: z.object({
    state: z.enum(["active", "idle"]),
    idleSeconds: z.number().nonnegative().optional(),
  }),
  focus: z.object({
    app: z
      .object({
        name: z.string().min(1).optional(),
        id: z.string().min(1).optional(),
        category: z.string().min(1).optional(),
        window: z
          .object({
            title: z.string().min(1).optional(),
          })
          .optional(),
        page: z
          .object({
            title: z.string().min(1).optional(),
            url: z.string().min(1).optional(),
          })
          .optional(),
      })
      .optional(),
  }),
});

const PresenceEventPayloadBaseSchema = z.object({
  eventId: z.string().min(1),
  seq: z.number().int().nonnegative(),
  observedAt: IsoDateTimeSchema,
  sentAt: IsoDateTimeSchema,
});

export const PresenceSnapshotFrameSchema = z.object({
  protocol: z.literal(PRESENCE_PROTOCOL),
  type: z.literal("snapshot"),
  payload: PresenceEventPayloadBaseSchema.extend({
    state: CommonPresenceStateSchema,
  }),
});

export const PresenceHeartbeatFrameSchema = z.object({
  protocol: z.literal(PRESENCE_PROTOCOL),
  type: z.literal("heartbeat"),
  payload: PresenceEventPayloadBaseSchema,
});

export const PresenceSessionEndFrameSchema = z.object({
  protocol: z.literal(PRESENCE_PROTOCOL),
  type: z.literal("session_end"),
  payload: PresenceEventPayloadBaseSchema.extend({
    reason: z
      .enum(["app_shutdown", "logout", "sleep", "network_change", "unknown"])
      .optional(),
  }),
});

export const DeviceMediaConnectionHelloFrameSchema = z.object({
  protocol: z.literal(DEVICE_MEDIA_CONNECTION_PROTOCOL),
  type: z.literal("hello"),
  payload: z.object({
    capabilities: z.object({
      media: z.boolean(),
      localPlayback: z.boolean(),
      remotePlayback: z.boolean(),
      binaryAudio: z.boolean().optional(),
      localRingBuffer: z.boolean().optional(),
      localRingBufferSeconds: z.number().int().positive().optional(),
    }),
    audio: z.object({
      codecs: z.array(StreamCodecSchema).min(1),
      chunkDurationMs: z.number().int().positive().optional(),
    }),
    supportedProtocols: z.array(z.string().min(1)).min(1),
  }),
});

export const DeviceMediaConnectionHelloAckFrameSchema = z.object({
  protocol: z.literal(DEVICE_MEDIA_CONNECTION_PROTOCOL),
  type: z.literal("hello_ack"),
  payload: z.discriminatedUnion("accepted", [
    z.object({
      accepted: z.literal(true),
      serverTime: IsoDateTimeSchema,
      connectionId: z.string().min(1),
      selectedProtocols: z.array(z.string().min(1)),
      capabilities: z.object({
        streaming: z.boolean(),
      }),
    }),
    z.object({
      accepted: z.literal(false),
      serverTime: IsoDateTimeSchema,
      error: z.object({
        code: z.string().min(1),
        message: z.string(),
      }),
    }),
  ]),
});

export const DeviceStreamStateSchema = z.object({
  permission: z.enum(["allow", "disallow"]),
  playback: z.enum(["playing", "paused"]),
  capture: z.enum(["capturing", "no-capture"]),
  streamFormat: StreamFormatSchema.optional(),
  reason: StreamBlockedReasonSchema.optional(),
  message: z.string().optional(),
});

export const DeviceStreamStateUpdatedFrameSchema = z.object({
  protocol: z.literal(DEVICE_MEDIA_PROTOCOL),
  type: z.literal("stream.state.updated"),
  payload: z.object({
    sentAt: IsoDateTimeSchema,
    state: DeviceStreamStateSchema,
  }),
});

export const DeviceMediaUpdatedFrameSchema = z.object({
  protocol: z.literal(DEVICE_MEDIA_PROTOCOL),
  type: z.literal("media.updated"),
  payload: z.object({
    sentAt: IsoDateTimeSchema,
    media: MediaItemSchema,
    clock: MediaClockSchema.optional(),
  }),
});

export const DeviceMediaCommandFrameSchema = z.object({
  protocol: z.literal(DEVICE_MEDIA_PROTOCOL),
  type: z.literal("command"),
  payload: z.object({
    commandId: z.string().min(1),
    sentAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema,
    command: z.discriminatedUnion("type", [
      z.object({
        type: z.literal("stream.requested"),
        streamId: z.string().min(1),
        generation: z.number().int().nonnegative(),
      }),
      z.object({
        type: z.literal("stream.resume"),
        streamId: z.string().min(1),
        generation: z.number().int().nonnegative(),
        fromSeq: z.number().int().nonnegative(),
      }),
      z.object({
        type: z.literal("stream.stop"),
        reason: z.string().min(1),
      }),
    ]),
  }),
});

export const DeviceMediaCommandAckFrameSchema = z.object({
  protocol: z.literal(DEVICE_MEDIA_PROTOCOL),
  type: z.literal("ack"),
  payload: z.union([
    z.object({
      commandId: z.string().min(1),
      commandType: z.literal("stream.requested"),
      status: z.literal("accepted"),
      streamId: z.string().min(1),
      generation: z.number().int().nonnegative(),
      firstSeq: z.number().int().nonnegative(),
      capture: CaptureInfoSchema.optional(),
      streamFormat: StreamFormatSchema,
      sentAt: IsoDateTimeSchema,
    }),
    z.object({
      commandId: z.string().min(1),
      commandType: z.literal("stream.resume"),
      status: z.literal("accepted"),
      streamId: z.string().min(1),
      generation: z.number().int().nonnegative(),
      firstSeq: z.number().int().nonnegative(),
      unavailableBeforeSeq: z.number().int().nonnegative().optional(),
      capture: CaptureInfoSchema.optional(),
      streamFormat: StreamFormatSchema.optional(),
      sentAt: IsoDateTimeSchema,
    }),
    z.object({
      commandId: z.string().min(1),
      commandType: z.enum(["stream.requested", "stream.resume"]),
      status: z.literal("rejected"),
      rejectedReason: StreamBlockedReasonSchema,
      sentAt: IsoDateTimeSchema,
    }),
    z.object({
      commandId: z.string().min(1),
      commandType: z.literal("stream.stop"),
      status: z.literal("stopped"),
      streamId: z.string().min(1),
      generation: z.number().int().nonnegative(),
      sentAt: IsoDateTimeSchema,
    }),
  ]),
});

export const DeviceMediaAudioChunkFrameSchema = z.object({
  protocol: z.literal(DEVICE_MEDIA_PROTOCOL),
  type: z.literal("audio.chunk"),
  payload: z.object({
    streamId: z.string().min(1),
    generation: z.number().int().nonnegative(),
    seq: z.number().int().nonnegative(),
    sentAt: IsoDateTimeSchema,
    durationMs: z.number().int().positive(),
    byteLength: z.number().int().nonnegative(),
    clock: MediaClockSchema.optional(),
  }),
});

export const DeviceMediaStreamHeartbeatFrameSchema = z.object({
  protocol: z.literal(DEVICE_MEDIA_PROTOCOL),
  type: z.literal("stream.heartbeat"),
  payload: z.object({
    streamId: z.string().min(1),
    generation: z.number().int().nonnegative(),
    sentAt: IsoDateTimeSchema,
    lastSeq: z.number().int().nonnegative(),
    clock: MediaClockSchema.optional(),
    capture: CaptureInfoSchema.optional(),
  }),
});

export const DeviceMediaStreamStoppedFrameSchema = z.object({
  protocol: z.literal(DEVICE_MEDIA_PROTOCOL),
  type: z.literal("stream.stopped"),
  payload: z.object({
    streamId: z.string().min(1),
    generation: z.number().int().nonnegative(),
    reason: DeviceStreamStoppedReasonSchema,
    sentAt: IsoDateTimeSchema,
  }),
});

export const DeviceMediaErrorFrameSchema = z.object({
  protocol: z.literal(DEVICE_MEDIA_PROTOCOL),
  type: z.literal("error"),
  payload: z.object({
    sentAt: IsoDateTimeSchema,
    error: z.object({
      code: z.string().min(1),
      message: z.string(),
    }),
  }),
});

export const DeviceCommonClientFrameSchema = z.discriminatedUnion("type", [
  DeviceCommonConnectionHelloFrameSchema,
  PresenceSnapshotFrameSchema,
  PresenceHeartbeatFrameSchema,
  PresenceSessionEndFrameSchema,
]);

export const DeviceCommonServerFrameSchema =
  DeviceCommonConnectionHelloAckFrameSchema;

export const DeviceMediaClientFrameSchema = z.discriminatedUnion("type", [
  DeviceMediaConnectionHelloFrameSchema,
  DeviceStreamStateUpdatedFrameSchema,
  DeviceMediaUpdatedFrameSchema,
  DeviceMediaCommandAckFrameSchema,
  DeviceMediaAudioChunkFrameSchema,
  DeviceMediaStreamHeartbeatFrameSchema,
  DeviceMediaStreamStoppedFrameSchema,
  DeviceMediaErrorFrameSchema,
]);

export const DeviceMediaServerFrameSchema = z.discriminatedUnion("type", [
  DeviceMediaConnectionHelloAckFrameSchema,
  DeviceMediaCommandFrameSchema,
]);

export type DeviceCommonConnectionHelloFrame = z.infer<
  typeof DeviceCommonConnectionHelloFrameSchema
>;
export type DeviceCommonConnectionHelloAckFrame = z.infer<
  typeof DeviceCommonConnectionHelloAckFrameSchema
>;
export type CommonPresenceState = z.infer<typeof CommonPresenceStateSchema>;
export type PresenceSnapshotFrame = z.infer<typeof PresenceSnapshotFrameSchema>;
export type PresenceHeartbeatFrame = z.infer<
  typeof PresenceHeartbeatFrameSchema
>;
export type PresenceSessionEndFrame = z.infer<
  typeof PresenceSessionEndFrameSchema
>;
export type DeviceMediaConnectionHelloFrame = z.infer<
  typeof DeviceMediaConnectionHelloFrameSchema
>;
export type DeviceMediaConnectionHelloAckFrame = z.infer<
  typeof DeviceMediaConnectionHelloAckFrameSchema
>;
export type DeviceStreamState = z.infer<typeof DeviceStreamStateSchema>;
export type DeviceStreamStateUpdatedFrame = z.infer<
  typeof DeviceStreamStateUpdatedFrameSchema
>;
export type DeviceMediaUpdatedFrame = z.infer<
  typeof DeviceMediaUpdatedFrameSchema
>;
export type DeviceMediaCommandFrame = z.infer<
  typeof DeviceMediaCommandFrameSchema
>;
export type DeviceMediaCommandAckFrame = z.infer<
  typeof DeviceMediaCommandAckFrameSchema
>;
export type DeviceMediaAudioChunkFrame = z.infer<
  typeof DeviceMediaAudioChunkFrameSchema
>;
export type DeviceMediaStreamHeartbeatFrame = z.infer<
  typeof DeviceMediaStreamHeartbeatFrameSchema
>;
export type DeviceMediaStreamStoppedFrame = z.infer<
  typeof DeviceMediaStreamStoppedFrameSchema
>;
export type DeviceMediaErrorFrame = z.infer<
  typeof DeviceMediaErrorFrameSchema
>;
export type DeviceCommonClientFrame = z.infer<
  typeof DeviceCommonClientFrameSchema
>;
export type DeviceCommonServerFrame = z.infer<
  typeof DeviceCommonServerFrameSchema
>;
export type DeviceMediaClientFrame = z.infer<
  typeof DeviceMediaClientFrameSchema
>;
export type DeviceMediaServerFrame = z.infer<
  typeof DeviceMediaServerFrameSchema
>;

import { z } from "zod";

export const INTERACTION_PROTOCOL_V1 = "interaction.v1";
export const INTERACTION_WS_PROTOCOL_V1 = "interaction.ws.v1";
export const INTERACTION_STREAM_PROTOCOL_V1 = "interaction.stream.v1";

export const InteractionStatusSchema = z.enum([
  "queued",
  "delivered",
  "acknowledged",
  "awaiting_confirmation",
  "executing",
  "succeeded",
  "rejected",
  "failed",
  "expired"
]);

export const InteractionExecutionModeSchema = z.enum(["confirm", "auto_enqueue"]);

export const InteractionActorSchema = z.object({
  kind: z.enum(["owner", "admin", "system"]),
  userId: z.string().optional()
});

export const InteractionTargetSchema = z.object({
  type: z.enum(["device"]),
  deviceId: z.string().optional()
});

export const InteractionConstraintSchema = z.object({
  expiresInSeconds: z.number().int().positive().default(30),
  requireForeground: z.boolean().default(false),
  requireCapability: z.string().default("media.recommend.track")
});

export const InteractionCommandSchema = z
  .object({
    type: z.literal("media.recommend.track"),
    provider: z.enum(["spotify", "apple-music"]),
    uri: z.string().min(1),
    intent: z.literal("enqueue"),
    title: z.string().min(1).optional(),
    artist: z.string().min(1).optional(),
    album: z.string().min(1).optional()
  })
  .superRefine((value, ctx) => {
    if (value.provider === "spotify" && !value.uri.startsWith("spotify:track:")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Spotify recommendations require a spotify:track: URI.",
        path: ["uri"]
      });
    }
    if (value.provider === "apple-music" && !value.title) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Apple Music recommendations require at least a track title.",
        path: ["title"]
      });
    }
  });

export const InteractionRequestSchema = z.object({
  protocol: z.literal(INTERACTION_PROTOCOL_V1).default(INTERACTION_PROTOCOL_V1),
  workspaceId: z.string().min(1),
  requestId: z.string().min(1),
  issuedAt: z.string(),
  actor: InteractionActorSchema,
  target: InteractionTargetSchema,
  command: InteractionCommandSchema,
  constraints: InteractionConstraintSchema
});

export const InteractionErrorSchema = z.object({
  code: z.string(),
  message: z.string()
});

export const InteractionStateSchema = z.object({
  protocol: z.literal(INTERACTION_PROTOCOL_V1).default(INTERACTION_PROTOCOL_V1),
  requestId: z.string(),
  workspaceId: z.string(),
  targetDeviceId: z.string().optional(),
  status: InteractionStatusSchema,
  issuedAt: z.string(),
  updatedAt: z.string(),
  actor: InteractionActorSchema,
  command: InteractionCommandSchema,
  constraints: InteractionConstraintSchema,
  error: InteractionErrorSchema.optional()
});

export const InteractionAckSchema = z.object({
  protocol: z.literal(INTERACTION_WS_PROTOCOL_V1).default(INTERACTION_WS_PROTOCOL_V1),
  type: z.literal("command.ack"),
  requestId: z.string(),
  deviceId: z.string(),
  accepted: z.boolean(),
  status: InteractionStatusSchema
});

export const InteractionResultSchema = z.object({
  protocol: z.literal(INTERACTION_WS_PROTOCOL_V1).default(INTERACTION_WS_PROTOCOL_V1),
  type: z.literal("command.result"),
  requestId: z.string(),
  deviceId: z.string(),
  status: InteractionStatusSchema,
  error: InteractionErrorSchema.optional()
});

export const DeviceInteractionCapabilitiesSchema = z.object({
  mediaRecommendTrack: z.boolean(),
  providersSpotify: z.boolean(),
  providersAppleMusic: z.boolean(),
  autoEnqueue: z.boolean()
});

export const DeviceInteractionHelloSchema = z.object({
  protocol: z.literal(INTERACTION_WS_PROTOCOL_V1).default(INTERACTION_WS_PROTOCOL_V1),
  type: z.literal("hello"),
  workspaceId: z.string(),
  deviceId: z.string(),
  supportedProtocols: z.array(z.string()).min(1),
  capabilities: DeviceInteractionCapabilitiesSchema
});

export const DeviceInteractionHelloAckSchema = z.object({
  protocol: z.literal(INTERACTION_WS_PROTOCOL_V1).default(INTERACTION_WS_PROTOCOL_V1),
  type: z.literal("hello_ack"),
  selectedProtocol: z.literal(INTERACTION_WS_PROTOCOL_V1)
});

export const DeviceInteractionDeliverySchema = z.object({
  protocol: z.literal(INTERACTION_WS_PROTOCOL_V1).default(INTERACTION_WS_PROTOCOL_V1),
  type: z.literal("command.request"),
  request: InteractionStateSchema
});

export const DeviceInteractionServerMessageSchema = z.discriminatedUnion("type", [
  DeviceInteractionHelloAckSchema,
  DeviceInteractionDeliverySchema
]);

export const DeviceInteractionClientMessageSchema = z.discriminatedUnion("type", [
  DeviceInteractionHelloSchema,
  InteractionAckSchema,
  InteractionResultSchema
]);

export const InteractionStreamEnvelopeSchema = z.object({
  protocol: z.literal(INTERACTION_STREAM_PROTOCOL_V1).default(INTERACTION_STREAM_PROTOCOL_V1),
  kind: z.literal("interaction.updated"),
  workspaceId: z.string(),
  payload: InteractionStateSchema
});

export type InteractionRequest = z.infer<typeof InteractionRequestSchema>;
export type InteractionState = z.infer<typeof InteractionStateSchema>;
export type InteractionCommand = z.infer<typeof InteractionCommandSchema>;
export type InteractionAck = z.infer<typeof InteractionAckSchema>;
export type InteractionResult = z.infer<typeof InteractionResultSchema>;
export type InteractionError = z.infer<typeof InteractionErrorSchema>;
export type InteractionStatus = z.infer<typeof InteractionStatusSchema>;
export type DeviceInteractionHello = z.infer<typeof DeviceInteractionHelloSchema>;
export type DeviceInteractionHelloAck = z.infer<typeof DeviceInteractionHelloAckSchema>;
export type DeviceInteractionDelivery = z.infer<typeof DeviceInteractionDeliverySchema>;
export type DeviceInteractionServerMessage = z.infer<typeof DeviceInteractionServerMessageSchema>;
export type DeviceInteractionClientMessage = z.infer<typeof DeviceInteractionClientMessageSchema>;
export type InteractionStreamEnvelope = z.infer<typeof InteractionStreamEnvelopeSchema>;

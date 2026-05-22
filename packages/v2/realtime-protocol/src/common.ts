import { z } from "zod";
import {
  ClientUserSchema,
  IsoDateTimeSchema,
  OwnerFocusSchema,
} from "./shared";

export const CLIENT_COMMON_WS_PROTOCOL = "client.common.ws.v1";

export const ClientSessionClaimRequestSchema = z.object({
  protocol: z.literal(CLIENT_COMMON_WS_PROTOCOL),
  sdkVersion: z.string().min(1),
});

export const ClientSessionClaimResponseSchema = z.object({
  protocol: z.literal(CLIENT_COMMON_WS_PROTOCOL),
  sessionId: z.string().min(1),
  user: ClientUserSchema.optional(),
});

export const ClientCommonHelloFrameSchema = z.object({
  protocol: z.literal(CLIENT_COMMON_WS_PROTOCOL),
  type: z.literal("hello"),
  supportedProtocols: z.tuple([z.literal(CLIENT_COMMON_WS_PROTOCOL)]),
  sdkVersion: z.string().min(1),
  sessionId: z.string().min(1),
  tabId: z.string().min(1),
});

export const ClientCommonHelloAckFrameSchema = z.object({
  protocol: z.literal(CLIENT_COMMON_WS_PROTOCOL),
  type: z.literal("hello_ack"),
  selectedProtocol: z.literal(CLIENT_COMMON_WS_PROTOCOL),
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

export const ClientCommonSnapshotFrameSchema = z.object({
  protocol: z.literal(CLIENT_COMMON_WS_PROTOCOL),
  type: z.literal("snapshot"),
  snapshot: ClientCommonGlobalSnapshotSchema,
});

export const ClientCommonErrorFrameSchema = z.object({
  protocol: z.literal(CLIENT_COMMON_WS_PROTOCOL),
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

export const ClientCommonClientFrameSchema = ClientCommonHelloFrameSchema;

export const ClientCommonServerFrameSchema = z.discriminatedUnion("type", [
  ClientCommonHelloAckFrameSchema,
  ClientCommonSnapshotFrameSchema,
  ClientCommonErrorFrameSchema,
]);

export type ClientSessionClaimRequest = z.infer<
  typeof ClientSessionClaimRequestSchema
>;
export type ClientSessionClaimResponse = z.infer<
  typeof ClientSessionClaimResponseSchema
>;
export type ClientCommonHelloFrame = z.infer<
  typeof ClientCommonHelloFrameSchema
>;
export type ClientCommonHelloAckFrame = z.infer<
  typeof ClientCommonHelloAckFrameSchema
>;
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
export type ClientCommonSnapshotFrame = z.infer<
  typeof ClientCommonSnapshotFrameSchema
>;
export type ClientCommonErrorFrame = z.infer<
  typeof ClientCommonErrorFrameSchema
>;
export type ClientCommonClientFrame = z.infer<
  typeof ClientCommonClientFrameSchema
>;
export type ClientCommonServerFrame = z.infer<
  typeof ClientCommonServerFrameSchema
>;

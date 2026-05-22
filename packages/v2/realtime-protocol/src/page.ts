import { z } from "zod";
import { IsoDateTimeSchema } from "./shared";

export const CLIENT_PAGE_WS_PROTOCOL = "client.page.ws.v1";

export const ClientPageTransitionFromSchema = z.object({
  fromCanonicalUrl: z.string().min(1),
  navigationId: z.string().min(1),
  startedAt: IsoDateTimeSchema,
});

export const ClientPageTransitionToSchema = z.object({
  toCanonicalUrl: z.string().min(1),
  navigationId: z.string().min(1),
  startedAt: IsoDateTimeSchema,
});

export const ClientPageMetadataSchema = z.object({
  title: z.string().min(1).optional(),
  url: z.string().min(1).optional(),
});

export const ClientPageHelloFrameSchema = z.object({
  protocol: z.literal(CLIENT_PAGE_WS_PROTOCOL),
  type: z.literal("hello"),
  supportedProtocols: z.tuple([z.literal(CLIENT_PAGE_WS_PROTOCOL)]),
  sdkVersion: z.string().min(1),
  sessionId: z.string().min(1),
  tabId: z.string().min(1),
  page: ClientPageMetadataSchema.optional(),
  transition: ClientPageTransitionFromSchema.optional(),
});

export const ClientPageUpdateFrameSchema = z.object({
  protocol: z.literal(CLIENT_PAGE_WS_PROTOCOL),
  type: z.literal("page.update"),
  seq: z.number().int().nonnegative(),
  observedAt: IsoDateTimeSchema,
  reading: z
    .object({
      percent: z.number().min(0).max(100).optional(),
      scrollY: z.number().nonnegative().optional(),
    })
    .optional(),
  page: ClientPageMetadataSchema.optional(),
});

export const ClientPageLeaveFrameSchema = z.object({
  protocol: z.literal(CLIENT_PAGE_WS_PROTOCOL),
  type: z.literal("leave"),
  seq: z.number().int().nonnegative(),
  observedAt: IsoDateTimeSchema,
  transition: ClientPageTransitionToSchema.optional(),
});

export const ClientPageHelloAckFrameSchema = z.object({
  protocol: z.literal(CLIENT_PAGE_WS_PROTOCOL),
  type: z.literal("hello_ack"),
  selectedProtocol: z.literal(CLIENT_PAGE_WS_PROTOCOL),
  connectionId: z.string().min(1),
});

export const ClientPageSessionDetailSchema = z.object({
  sessionId: z.string().min(1),
  tabCount: z.number().int().nonnegative(),
  progress: z
    .object({
      percent: z.number().min(0).max(100).optional(),
      scrollY: z.number().nonnegative().optional(),
    })
    .optional(),
  lastSeenAt: IsoDateTimeSchema,
});

export const ClientPageSnapshotSchema = z.object({
  revision: z.number().int().nonnegative(),
  updatedAt: IsoDateTimeSchema,
  page: z.object({
    canonicalUrl: z.string().min(1),
    url: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
  }),
  sessions: z.object({
    totalCount: z.number().int().nonnegative(),
    recent: z.array(ClientPageSessionDetailSchema),
  }),
});

export const ClientPageSnapshotFrameSchema = z.object({
  protocol: z.literal(CLIENT_PAGE_WS_PROTOCOL),
  type: z.literal("snapshot"),
  snapshot: ClientPageSnapshotSchema,
});

export const ClientPageErrorFrameSchema = z.object({
  protocol: z.literal(CLIENT_PAGE_WS_PROTOCOL),
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

export const ClientPageClientFrameSchema = z.discriminatedUnion("type", [
  ClientPageHelloFrameSchema,
  ClientPageUpdateFrameSchema,
  ClientPageLeaveFrameSchema,
]);

export const ClientPageServerFrameSchema = z.discriminatedUnion("type", [
  ClientPageHelloAckFrameSchema,
  ClientPageSnapshotFrameSchema,
  ClientPageErrorFrameSchema,
]);

export type ClientPageTransitionFrom = z.infer<
  typeof ClientPageTransitionFromSchema
>;
export type ClientPageTransitionTo = z.infer<
  typeof ClientPageTransitionToSchema
>;
export type ClientPageMetadata = z.infer<typeof ClientPageMetadataSchema>;
export type ClientPageHelloFrame = z.infer<typeof ClientPageHelloFrameSchema>;
export type ClientPageUpdateFrame = z.infer<typeof ClientPageUpdateFrameSchema>;
export type ClientPageLeaveFrame = z.infer<typeof ClientPageLeaveFrameSchema>;
export type ClientPageHelloAckFrame = z.infer<
  typeof ClientPageHelloAckFrameSchema
>;
export type ClientPageSessionDetail = z.infer<
  typeof ClientPageSessionDetailSchema
>;
export type ClientPageSnapshot = z.infer<typeof ClientPageSnapshotSchema>;
export type ClientPageSnapshotFrame = z.infer<
  typeof ClientPageSnapshotFrameSchema
>;
export type ClientPageErrorFrame = z.infer<typeof ClientPageErrorFrameSchema>;
export type ClientPageClientFrame = z.infer<typeof ClientPageClientFrameSchema>;
export type ClientPageServerFrame = z.infer<typeof ClientPageServerFrameSchema>;

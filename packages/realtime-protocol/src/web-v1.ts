import { z } from "zod";

export const WEB_PROTOCOL_V1 = "web.v1";
export const WEB_ACK_PROTOCOL_V1 = "web.v1-ack";

export const WebEventKindSchema = z.enum([
  "page_view",
  "reading_progress",
  "heartbeat",
  "session_end"
]);

export const WebPresenceStateSchema = z.enum(["active", "hidden", "idle", "offline"]);
export const WebVisibilityStateSchema = z.enum(["visible", "hidden"]);

export const WebPageSchema = z.object({
  url: z.string().url(),
  title: z.string().min(1),
  canonicalUrl: z.string().url().optional()
});

export const WebReadingSchema = z.object({
  progressPercent: z.number().min(0).max(100),
  scrollY: z.number().nonnegative().optional()
});

export const WebPresenceSchema = z.object({
  state: WebPresenceStateSchema,
  visibility: WebVisibilityStateSchema
});

export const WebEventSchema = z.object({
  eventId: z.string(),
  seq: z.number().int().nonnegative(),
  kind: WebEventKindSchema,
  observedAt: z.string(),
  sentAt: z.string(),
  page: WebPageSchema,
  reading: WebReadingSchema.optional(),
  presence: WebPresenceSchema
});

export const WebIngestRequestSchema = z.object({
  protocol: z.literal(WEB_PROTOCOL_V1).default(WEB_PROTOCOL_V1),
  workspaceId: z.string().min(1),
  siteId: z.string().min(1),
  sessionId: z.string().min(1),
  tabId: z.string().min(1),
  userId: z.string().min(1).optional(),
  events: z.array(WebEventSchema).min(1)
});

export const WebRejectedEventSchema = z.object({
  eventId: z.string(),
  reason: z.string()
});

export const WebIngestAckSchema = z.object({
  protocol: z.literal(WEB_ACK_PROTOCOL_V1).default(WEB_ACK_PROTOCOL_V1),
  workspaceId: z.string(),
  siteId: z.string(),
  sessionId: z.string(),
  acceptedSeqMax: z.number().int().nonnegative(),
  dedupedEventIds: z.array(z.string()).default([]),
  rejected: z.array(WebRejectedEventSchema).default([]),
  workspaceRevision: z.number().int().nonnegative()
});

export type WebIngestRequest = z.infer<typeof WebIngestRequestSchema>;
export type WebIngestAck = z.infer<typeof WebIngestAckSchema>;
export type WebEvent = z.infer<typeof WebEventSchema>;
export type WebPresence = z.infer<typeof WebPresenceSchema>;
export type WebPage = z.infer<typeof WebPageSchema>;
export type WebReading = z.infer<typeof WebReadingSchema>;

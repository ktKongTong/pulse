import { z } from "zod";

export const StatsPeriodSchema = z.enum(["day", "week", "month", "year"]);

export const StatsBucketSchema = z.object({
  period: StatsPeriodSchema,
  key: z.string(),
  label: z.string(),
  startDay: z.string(),
  endDay: z.string(),
});

export const StatsAggregateValueSchema = z.object({
  key: z.string(),
  label: z.string(),
  totalSeconds: z.number().int().nonnegative(),
  count: z.number().int().nonnegative().default(0),
});

export const ContentMetricsSchema = z.object({
  canonicalUrl: z.string().url(),
  title: z.string(),
  pv: z.number().int().nonnegative(),
  uv: z.number().int().nonnegative(),
  readTimeSeconds: z.number().int().nonnegative(),
});

export const SiteMetricsSchema = z.object({
  pv: z.number().int().nonnegative(),
  uv: z.number().int().nonnegative(),
  readTimeSeconds: z.number().int().nonnegative(),
});

export const OwnerMetricsSchema = z.object({
  appPresenceSecondsByApp: z.array(StatsAggregateValueSchema),
});

export const ContentHistoryPointSchema = z.object({
  bucket: StatsBucketSchema,
  value: ContentMetricsSchema.nullable(),
});

export const SiteHistoryPointSchema = z.object({
  bucket: StatsBucketSchema,
  value: SiteMetricsSchema,
});

export const OwnerHistoryPointSchema = z.object({
  bucket: StatsBucketSchema,
  value: OwnerMetricsSchema,
});

export const ContentLifetimeSchema = ContentMetricsSchema;
export const SiteLifetimeSchema = SiteMetricsSchema;
export const OwnerLifetimeSchema = OwnerMetricsSchema;

export type StatsAggregateValue = z.infer<typeof StatsAggregateValueSchema>;
export type StatsPeriod = z.infer<typeof StatsPeriodSchema>;
export type StatsBucket = z.infer<typeof StatsBucketSchema>;
export type ContentMetrics = z.infer<typeof ContentMetricsSchema>;
export type SiteMetrics = z.infer<typeof SiteMetricsSchema>;
export type OwnerMetrics = z.infer<typeof OwnerMetricsSchema>;
export type ContentHistoryPoint = z.infer<typeof ContentHistoryPointSchema>;
export type SiteHistoryPoint = z.infer<typeof SiteHistoryPointSchema>;
export type OwnerHistoryPoint = z.infer<typeof OwnerHistoryPointSchema>;
export type ContentLifetime = z.infer<typeof ContentLifetimeSchema>;
export type SiteLifetime = z.infer<typeof SiteLifetimeSchema>;
export type OwnerLifetime = z.infer<typeof OwnerLifetimeSchema>;

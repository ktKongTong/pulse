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

export const MediaAggregateSchema = z.object({
  providerId: z.string(),
  trackId: z.string().optional(),
  title: z.string().optional(),
  totalSeconds: z.number().int().nonnegative(),
  count: z.number().int().nonnegative().default(0),
});

export const StatsSummarySchema = z.object({
  day: z.string(),
  onlineCountPeak: z.number().int().nonnegative(),
  activeDeviceCountPeak: z.number().int().nonnegative(),
  activeWebReaderCountPeak: z.number().int().nonnegative(),
  avgOnlineCount: z.number().nonnegative(),
  avgActiveReaderCount: z.number().nonnegative(),
  mediaActiveSecondsByProvider: z.array(StatsAggregateValueSchema),
  devicePresenceSecondsByApp: z.array(StatsAggregateValueSchema),
  ops: z.object({
    dedupedEventCount: z.number().int().nonnegative(),
    rejectedEventCount: z.number().int().nonnegative(),
    expiredSessionCount: z.number().int().nonnegative(),
    roomRevisionBumpCount: z.number().int().nonnegative(),
    broadcastCount: z.number().int().nonnegative(),
    wsSubscriberCountPeak: z.number().int().nonnegative(),
    sseSubscriberCountPeak: z.number().int().nonnegative(),
  }),
});

export const PageAggregateSchema = z.object({
  day: z.string(),
  canonicalUrl: z.string(),
  title: z.string(),
  pageViewCount: z.number().int().nonnegative(),
  readerOnlineSeconds: z.number().int().nonnegative(),
  readerSessionCount: z.number().int().nonnegative(),
  avgProgressPercent: z.number().nonnegative(),
  maxProgressPercent: z.number().nonnegative(),
  completionBucketCounts: z.object({
    zeroToTwentyFive: z.number().int().nonnegative(),
    twentyFiveToFifty: z.number().int().nonnegative(),
    fiftyToSeventyFive: z.number().int().nonnegative(),
    seventyFiveToHundred: z.number().int().nonnegative(),
  }),
  visibleSeconds: z.number().int().nonnegative(),
  hiddenSeconds: z.number().int().nonnegative(),
  idleSeconds: z.number().int().nonnegative(),
  bounceCount: z.number().int().nonnegative(),
  engagedReaderCount: z.number().int().nonnegative(),
  pageTransitionOutCount: z.number().int().nonnegative(),
  pageTransitionInCount: z.number().int().nonnegative(),
  onlineCountPeak: z.number().int().nonnegative(),
  avgOnlineCount: z.number().nonnegative(),
});

export const RoomAggregateSchema = z.object({
  day: z.string(),
  roomId: z.string(),
  onlineCountPeak: z.number().int().nonnegative(),
  avgOnlineCount: z.number().nonnegative(),
  roomOnlineSecondsIntegral: z.number().int().nonnegative(),
  uniqueReaderSessions: z.number().int().nonnegative(),
  avgProgressPercent: z.number().nonnegative(),
  maxProgressPercent: z.number().nonnegative(),
  deviceReaderCount: z.number().int().nonnegative(),
  webReaderCount: z.number().int().nonnegative(),
  roomLifetimeSeconds: z.number().int().nonnegative(),
  entryCount: z.number().int().nonnegative(),
  exitCount: z.number().int().nonnegative(),
});

export const DeviceAggregateSchema = z.object({
  day: z.string(),
  deviceId: z.string(),
  focusSwitchCount: z.number().int().nonnegative(),
  mediaSwitchCount: z.number().int().nonnegative(),
  sessionCount: z.number().int().nonnegative(),
  appFocus: z.array(StatsAggregateValueSchema),
  mediaPlayback: z.array(MediaAggregateSchema),
});

export const StatsSummaryHistoryPointSchema = z.object({
  bucket: StatsBucketSchema,
  value: StatsSummarySchema,
});

export const PageAggregateHistoryPointSchema = z.object({
  bucket: StatsBucketSchema,
  items: z.array(PageAggregateSchema),
});

export const RoomAggregateHistoryPointSchema = z.object({
  bucket: StatsBucketSchema,
  items: z.array(RoomAggregateSchema),
});

export const DeviceAggregateHistoryPointSchema = z.object({
  bucket: StatsBucketSchema,
  value: DeviceAggregateSchema.nullable(),
});

export type StatsAggregateValue = z.infer<typeof StatsAggregateValueSchema>;
export type MediaAggregate = z.infer<typeof MediaAggregateSchema>;
export type StatsPeriod = z.infer<typeof StatsPeriodSchema>;
export type StatsBucket = z.infer<typeof StatsBucketSchema>;
export type StatsSummary = z.infer<typeof StatsSummarySchema>;
export type PageAggregate = z.infer<typeof PageAggregateSchema>;
export type RoomAggregate = z.infer<typeof RoomAggregateSchema>;
export type DeviceAggregate = z.infer<typeof DeviceAggregateSchema>;
export type StatsSummaryHistoryPoint = z.infer<typeof StatsSummaryHistoryPointSchema>;
export type PageAggregateHistoryPoint = z.infer<typeof PageAggregateHistoryPointSchema>;
export type RoomAggregateHistoryPoint = z.infer<typeof RoomAggregateHistoryPointSchema>;
export type DeviceAggregateHistoryPoint = z.infer<typeof DeviceAggregateHistoryPointSchema>;

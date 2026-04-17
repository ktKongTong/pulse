import type {
  ContentHistoryPoint,
  ContentLifetime,
  OwnerHistoryPoint,
  OwnerLifetime,
  SiteHistoryPoint,
  SiteLifetime,
  StatsPeriod,
} from "@pulse/realtime-protocol";

import * as schema from "./db/schema";
import {
  bucketForDay,
  coerceNonNegativeInt,
  compareBucketsDesc,
} from "./stats-utils";

type GlobalDailyStatsRow = typeof schema.globalDailyStats.$inferSelect;
type GlobalAppDailyStatsRow = typeof schema.globalAppDailyStats.$inferSelect;
type PageDailyStatsRow = typeof schema.pageDailyStats.$inferSelect;

function buildContentValue(
  canonicalUrl: string,
  title: string,
  rows: PageDailyStatsRow[],
): ContentLifetime {
  return {
    canonicalUrl,
    title,
    pv: rows.reduce((sum, row) => sum + coerceNonNegativeInt(row.pageViewCount), 0),
    uv: rows.reduce((sum, row) => sum + coerceNonNegativeInt(row.uniqueVisitorCount), 0),
    readTimeSeconds: rows.reduce((sum, row) => sum + Math.round(coerceNonNegativeInt(row.readTimeMs) / 1000), 0),
  };
}

function buildSiteValue(rows: GlobalDailyStatsRow[]): SiteLifetime {
  return {
    pv: rows.reduce((sum, row) => sum + coerceNonNegativeInt(row.pageViewCount), 0),
    uv: rows.reduce((sum, row) => sum + coerceNonNegativeInt(row.uniqueVisitorCount), 0),
    readTimeSeconds: rows.reduce(
      (sum, row) => sum + Math.round(coerceNonNegativeInt(row.onlineIntegralMs) / 1000),
      0,
    ),
  };
}

function buildOwnerValue(rows: GlobalAppDailyStatsRow[]): OwnerLifetime {
  const grouped = new Map<string, { key: string; label: string; totalSeconds: number; count: number }>();
  for (const row of rows) {
    const existing = grouped.get(row.appKey);
    if (existing) {
      existing.totalSeconds += Math.round(coerceNonNegativeInt(row.totalMs) / 1000);
      existing.count += coerceNonNegativeInt(row.sampleCount);
    } else {
      grouped.set(row.appKey, {
        key: row.appKey,
        label: row.label,
        totalSeconds: Math.round(coerceNonNegativeInt(row.totalMs) / 1000),
        count: coerceNonNegativeInt(row.sampleCount),
      });
    }
  }

  return {
    appPresenceSecondsByApp: [...grouped.values()].sort(
      (left, right) => right.totalSeconds - left.totalSeconds,
    ),
  };
}

export function buildContentHistory(
  canonicalUrl: string,
  rows: PageDailyStatsRow[],
  period: StatsPeriod,
  limit: number,
  anchorDay: string,
): ContentHistoryPoint[] {
  const filtered = rows.filter(
    (row) => row.canonicalUrl === canonicalUrl && row.day <= anchorDay,
  );
  const buckets = new Map<string, { bucket: ReturnType<typeof bucketForDay>; rows: PageDailyStatsRow[] }>();

  for (const row of filtered) {
    const bucket = bucketForDay(row.day, period);
    const entry = buckets.get(bucket.key) ?? { bucket, rows: [] };
    entry.rows.push(row);
    buckets.set(bucket.key, entry);
  }

  return [...buckets.values()]
    .sort((left, right) => compareBucketsDesc(left.bucket, right.bucket))
    .slice(0, limit)
    .map(({ bucket, rows: bucketRows }) => ({
      bucket,
      value:
        bucketRows.length > 0
          ? buildContentValue(
              canonicalUrl,
              bucketRows[0]?.title ?? canonicalUrl,
              bucketRows,
            )
          : null,
    }));
}

export function buildContentLifetime(
  canonicalUrl: string,
  rows: PageDailyStatsRow[],
): ContentLifetime | null {
  const filtered = rows.filter((row) => row.canonicalUrl === canonicalUrl);
  if (filtered.length === 0) return null;
  return buildContentValue(canonicalUrl, filtered[0]?.title ?? canonicalUrl, filtered);
}

export function buildSiteHistory(
  rows: GlobalDailyStatsRow[],
  period: StatsPeriod,
  limit: number,
  anchorDay: string,
): SiteHistoryPoint[] {
  const buckets = new Map<string, { bucket: ReturnType<typeof bucketForDay>; rows: GlobalDailyStatsRow[] }>();
  for (const row of rows.filter((row) => row.day <= anchorDay)) {
    const bucket = bucketForDay(row.day, period);
    const entry = buckets.get(bucket.key) ?? { bucket, rows: [] };
    entry.rows.push(row);
    buckets.set(bucket.key, entry);
  }

  return [...buckets.values()]
    .sort((left, right) => compareBucketsDesc(left.bucket, right.bucket))
    .slice(0, limit)
    .map(({ bucket, rows: bucketRows }) => ({
      bucket,
      value: buildSiteValue(bucketRows),
    }));
}

export function buildSiteLifetime(rows: GlobalDailyStatsRow[]): SiteLifetime {
  return buildSiteValue(rows);
}

export function buildOwnerHistory(
  rows: GlobalAppDailyStatsRow[],
  period: StatsPeriod,
  limit: number,
  anchorDay: string,
): OwnerHistoryPoint[] {
  const buckets = new Map<string, { bucket: ReturnType<typeof bucketForDay>; rows: GlobalAppDailyStatsRow[] }>();
  for (const row of rows.filter((row) => row.day <= anchorDay)) {
    const bucket = bucketForDay(row.day, period);
    const entry = buckets.get(bucket.key) ?? { bucket, rows: [] };
    entry.rows.push(row);
    buckets.set(bucket.key, entry);
  }

  return [...buckets.values()]
    .sort((left, right) => compareBucketsDesc(left.bucket, right.bucket))
    .slice(0, limit)
    .map(({ bucket, rows: bucketRows }) => ({
      bucket,
      value: buildOwnerValue(bucketRows),
    }));
}

export function buildOwnerLifetime(rows: GlobalAppDailyStatsRow[]): OwnerLifetime {
  return buildOwnerValue(rows);
}

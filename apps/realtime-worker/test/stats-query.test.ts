import { describe, expect, it } from "vitest";

import {
  buildContentHistory,
  buildContentLifetime,
  buildOwnerHistory,
  buildOwnerLifetime,
  buildSiteHistory,
} from "@/api/stats/query";

describe("stats-query", () => {
  it("groups site daily rows into monthly history buckets", () => {
    const history = buildSiteHistory(
      [
        {
          day: "2026-04-01",
          startedAtMs: Date.parse("2026-04-01T00:00:00.000Z"),
          lastUpdatedAtMs: Date.parse("2026-04-01T01:00:00.000Z"),
          pageViewCount: 5,
          uniqueVisitorCount: 3,
          onlineIntegralMs: 3_600_000,
          onlineCountPeak: 2,
          activeDeviceCountPeak: 1,
          activeWebReaderCountPeak: 1,
          dedupedEventCount: 1,
          rejectedEventCount: 0,
          broadcastCount: 4,
        },
        {
          day: "2026-04-02",
          startedAtMs: Date.parse("2026-04-02T00:00:00.000Z"),
          lastUpdatedAtMs: Date.parse("2026-04-02T02:00:00.000Z"),
          pageViewCount: 6,
          uniqueVisitorCount: 4,
          onlineIntegralMs: 7_200_000,
          onlineCountPeak: 3,
          activeDeviceCountPeak: 2,
          activeWebReaderCountPeak: 2,
          dedupedEventCount: 0,
          rejectedEventCount: 1,
          broadcastCount: 5,
        },
      ],
      "month",
      12,
      "2026-04-30",
    );

    expect(history).toHaveLength(1);
    expect(history[0]?.bucket.key).toBe("2026-04");
    expect(history[0]?.value.pv).toBe(11);
    expect(history[0]?.value.uv).toBe(7);
    expect(history[0]?.value.readTimeSeconds).toBe(10_800);
  });

  it("aggregates content rows into history and lifetime values", () => {
    const contentRows = [
      {
        id: "2026-04-16|https://example.com/a",
        day: "2026-04-16",
        canonicalUrl: "https://example.com/a",
        title: "Article A",
        startedAtMs: 0,
        lastUpdatedAtMs: 1_000,
        pageViewCount: 4,
        uniqueVisitorCount: 3,
        readTimeMs: 80_000,
        readerSessionCount: 0,
        progressSum: 0,
        progressSamples: 0,
        maxProgressPercent: 0,
        bounceCount: 0,
        engagedReaderCount: 0,
      },
      {
        id: "2026-04-17|https://example.com/a",
        day: "2026-04-17",
        canonicalUrl: "https://example.com/a",
        title: "Article A",
        startedAtMs: 0,
        lastUpdatedAtMs: 1_000,
        pageViewCount: 2,
        uniqueVisitorCount: 2,
        readTimeMs: 40_000,
        readerSessionCount: 0,
        progressSum: 0,
        progressSamples: 0,
        maxProgressPercent: 0,
        bounceCount: 0,
        engagedReaderCount: 0,
      },
    ];
    const history = buildContentHistory(
      "https://example.com/a",
      contentRows,
      "month",
      12,
      "2026-04-30",
    );
    const lifetime = buildContentLifetime("https://example.com/a", contentRows);

    expect(history).toHaveLength(1);
    expect(history[0]?.value?.pv).toBe(6);
    expect(history[0]?.value?.uv).toBe(5);
    expect(history[0]?.value?.readTimeSeconds).toBe(120);
    expect(lifetime?.title).toBe("Article A");
  });

  it("aggregates owner app presence into history and lifetime values", () => {
    const rows = [
      {
        id: "2026-04-16|com.google.Chrome",
        day: "2026-04-16",
        appKey: "com.google.Chrome",
        label: "Google Chrome",
        totalMs: 40_000,
        sampleCount: 1,
      },
      {
        id: "2026-04-17|com.google.Chrome",
        day: "2026-04-17",
        appKey: "com.google.Chrome",
        label: "Google Chrome",
        totalMs: 50_000,
        sampleCount: 2,
      },
      {
        id: "2026-04-17|dev.warp.Warp",
        day: "2026-04-17",
        appKey: "dev.warp.Warp",
        label: "Warp",
        totalMs: 120_000,
        sampleCount: 3,
      },
    ];

    const history = buildOwnerHistory(rows, "month", 12, "2026-04-30");
    const lifetime = buildOwnerLifetime(rows);

    expect(history).toHaveLength(1);
    expect(history[0]?.value.appPresenceSecondsByApp[0]?.label).toBe("Warp");
    expect(lifetime.appPresenceSecondsByApp[0]?.totalSeconds).toBe(120);
  });
});

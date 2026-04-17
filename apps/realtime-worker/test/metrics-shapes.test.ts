import { describe, expect, it } from "vitest";

import {
  ContentHistoryPointSchema,
  OwnerHistoryPointSchema,
  SiteHistoryPointSchema,
} from "@pulse/realtime-protocol";

import {
  buildContentHistory,
  buildOwnerHistory,
  buildSiteHistory,
} from "../src/stats-query";

describe("metrics api shapes", () => {
  it("produces protocol-compatible site history payloads", () => {
    const payload = buildSiteHistory(
      [
        {
          day: "2026-04-17",
          startedAtMs: 0,
          lastUpdatedAtMs: 60_000,
          pageViewCount: 8,
          uniqueVisitorCount: 3,
          onlineIntegralMs: 30_000,
          onlineCountPeak: 0,
          activeDeviceCountPeak: 0,
          activeWebReaderCountPeak: 0,
          dedupedEventCount: 0,
          rejectedEventCount: 0,
          broadcastCount: 2,
        },
      ],
      "day",
      10,
      "2026-04-30",
    );

    expect(() => SiteHistoryPointSchema.array().parse(payload)).not.toThrow();
    expect(payload[0]?.value.pv).toBe(8);
    expect(payload[0]?.value.uv).toBe(3);
    expect(payload[0]?.value.readTimeSeconds).toBe(30);
  });

  it("produces protocol-compatible content and owner history payloads", () => {
    const contentPayload = buildContentHistory(
      "https://example.com/status",
      [
        {
          id: "2026-04-17|https://example.com/status",
          day: "2026-04-17",
          canonicalUrl: "https://example.com/status",
          title: "Status",
          startedAtMs: 0,
          lastUpdatedAtMs: 1_000,
          pageViewCount: 3,
          uniqueVisitorCount: 2,
          readTimeMs: 90_000,
          readerSessionCount: 0,
          progressSum: 0,
          progressSamples: 0,
          maxProgressPercent: 0,
          bounceCount: 0,
          engagedReaderCount: 0,
        },
      ],
      "day",
      10,
      "2026-04-30",
    );
    const ownerPayload = buildOwnerHistory(
      [
        {
          id: "2026-04-17|com.google.Chrome",
          day: "2026-04-17",
          appKey: "com.google.Chrome",
          label: "Google Chrome",
          totalMs: 90_000,
          sampleCount: 2,
        },
      ],
      "day",
      10,
      "2026-04-30",
    );

    expect(() => ContentHistoryPointSchema.array().parse(contentPayload)).not.toThrow();
    expect(() => OwnerHistoryPointSchema.array().parse(ownerPayload)).not.toThrow();
    expect(contentPayload[0]?.value?.readTimeSeconds).toBe(90);
    expect(ownerPayload[0]?.value.appPresenceSecondsByApp[0]?.label).toBe("Google Chrome");
  });
});

import { describe, expect, it } from "vitest";

import {
  RealtimeClientMessageSchema,
  RealtimeServerMessageSchema,
} from "@pulse/realtime-protocol";

describe("realtime ws stats protocol", () => {
  it("parses subscribe_stats client messages", () => {
    const parsed = RealtimeClientMessageSchema.parse({
      protocol: "realtime.ws.v1",
      type: "subscribe_stats",
      subscriptions: [
        {
          subscriptionId: "stats-1",
          target: "device",
          day: "2026-04-12",
          deviceId: "macos-kt",
        },
      ],
    });

    expect(parsed.type).toBe("subscribe_stats");
    if (parsed.type === "subscribe_stats") {
      expect(parsed.subscriptions[0]?.target).toBe("device");
    }
  });

  it("parses stats server envelopes", () => {
    const parsed = RealtimeServerMessageSchema.parse({
      protocol: "realtime.ws.v1",
      type: "stats",
      subscriptionId: "stats-2",
      target: "pages",
      day: "2026-04-12",
      payload: [
        {
          day: "2026-04-12",
          canonicalUrl: "https://example.com/status",
          title: "Pulse Status",
          pageViewCount: 2,
          readerOnlineSeconds: 154,
          readerSessionCount: 2,
          avgProgressPercent: 12,
          maxProgressPercent: 18,
          completionBucketCounts: {
            zeroToTwentyFive: 2,
            twentyFiveToFifty: 0,
            fiftyToSeventyFive: 0,
            seventyFiveToHundred: 0,
          },
          visibleSeconds: 154,
          hiddenSeconds: 0,
          idleSeconds: 0,
          bounceCount: 0,
          engagedReaderCount: 0,
          pageTransitionOutCount: 0,
          pageTransitionInCount: 2,
          onlineCountPeak: 1,
          avgOnlineCount: 1,
        },
      ],
    });

    expect(parsed.type).toBe("stats");
    if (parsed.type === "stats") {
      expect(parsed.target).toBe("pages");
      expect(Array.isArray(parsed.payload)).toBe(true);
    }
  });
});

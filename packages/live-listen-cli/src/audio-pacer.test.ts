import { describe, expect, it } from "vitest";

import { planAudioPacerTick } from "./audio-pacer.ts";

describe("planAudioPacerTick", () => {
  it("sends one frame when on time", () => {
    const tick = planAudioPacerTick({
      frameNs: 10_000_000n,
      maxBurstFrames: 2,
      nextTickNs: 100_000_000n,
      nowNs: 100_000_000n,
    });

    expect(tick.framesDue).toBe(1);
    expect(tick.droppedFrames).toBe(0);
    expect(tick.lateFrames).toBe(0);
    expect(tick.lateMs).toBe(0);
    expect(tick.nextTickNs).toBe(110_000_000n);
  });

  it("allows a small catch-up burst", () => {
    const tick = planAudioPacerTick({
      frameNs: 10_000_000n,
      maxBurstFrames: 2,
      nextTickNs: 100_000_000n,
      nowNs: 119_000_000n,
    });

    expect(tick.framesDue).toBe(2);
    expect(tick.droppedFrames).toBe(0);
    expect(tick.lateFrames).toBe(1);
    expect(tick.lateMs).toBe(19);
    expect(tick.nextTickNs).toBe(120_000_000n);
  });

  it("drops stale frames when too far behind", () => {
    const tick = planAudioPacerTick({
      frameNs: 10_000_000n,
      maxBurstFrames: 2,
      nextTickNs: 100_000_000n,
      nowNs: 125_000_000n,
    });

    expect(tick.framesDue).toBe(2);
    expect(tick.droppedFrames).toBe(1);
    expect(tick.lateFrames).toBe(2);
    expect(tick.lateMs).toBe(25);
    expect(tick.nextTickNs).toBe(130_000_000n);
  });
});

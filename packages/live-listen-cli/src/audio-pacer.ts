import process from "node:process";

export type AudioPacerTick = {
  droppedFrames: number;
  framesDue: number;
  lateFrames: number;
  lateMs: number;
};

export type AudioPacer = {
  stop(): void;
};

export function planAudioPacerTick(args: {
  frameNs: bigint;
  maxBurstFrames: number;
  nextTickNs: bigint;
  nowNs: bigint;
}) {
  const lateNs = args.nowNs > args.nextTickNs ? args.nowNs - args.nextTickNs : 0n;
  const lateFrames = lateNs > 0n ? Number(lateNs / args.frameNs) : 0;
  const totalDueFrames = 1 + lateFrames;
  const framesDue = Math.min(totalDueFrames, args.maxBurstFrames);
  const droppedFrames = totalDueFrames - framesDue;
  return {
    droppedFrames,
    framesDue,
    lateFrames,
    lateMs: Number(lateNs) / 1_000_000,
    nextTickNs: args.nextTickNs + args.frameNs * BigInt(totalDueFrames),
  };
}

export function startAudioPacer(args: {
  frameMs: number;
  maxBurstFrames?: number;
  onTick: (tick: AudioPacerTick) => void;
}): AudioPacer {
  if (!Number.isFinite(args.frameMs) || args.frameMs <= 0) {
    throw new Error(`Invalid frameMs: ${args.frameMs}`);
  }

  const frameNs = BigInt(Math.round(args.frameMs * 1_000_000));
  const maxBurstFrames = Math.max(1, Math.floor(args.maxBurstFrames ?? 2));
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  let nextTickNs = process.hrtime.bigint();

  const clearTimer = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
  };

  const schedule = () => {
    if (stopped) return;
    const nowNs = process.hrtime.bigint();
    const delayNs = nextTickNs > nowNs ? nextTickNs - nowNs : 0n;
    const delayMs = Number(delayNs) / 1_000_000;
    timer = setTimeout(run, delayMs);
    timer.unref?.();
  };

  const run = () => {
    if (stopped) return;
    timer = null;
    const tick = planAudioPacerTick({
      frameNs,
      maxBurstFrames,
      nextTickNs,
      nowNs: process.hrtime.bigint(),
    });
    nextTickNs = tick.nextTickNs;
    args.onTick({
      droppedFrames: tick.droppedFrames,
      framesDue: tick.framesDue,
      lateFrames: tick.lateFrames,
      lateMs: tick.lateMs,
    });
    schedule();
  };

  schedule();

  return {
    stop() {
      stopped = true;
      clearTimer();
    },
  };
}

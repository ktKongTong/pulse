import { useEffect, useState } from "react";
import type { RoomReader } from "@pulse/realtime-protocol";
import type { MediaStatus } from "./user-api";

type RoomReaderMedia = NonNullable<RoomReader["media"]>;
type PlaybackProgressSource = {
  progressSeconds?: number;
  durationSeconds?: number;
  playbackState?: string;
};

export function useNowTick(intervalMs = 250) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);

  return now;
}

export function resolveDisplayedProgressSeconds(
  media: PlaybackProgressSource | null | undefined,
  updatedAt: string | undefined,
  nowMs: number,
) {
  if (!media) return 0;

  const baseline = media.progressSeconds ?? 0;
  const durationSeconds = media.durationSeconds ?? 0;
  if (media.playbackState !== "playing") return baseline;

  const updatedAtMs = Date.parse(updatedAt ?? "");
  if (!Number.isFinite(updatedAtMs)) return baseline;

  const elapsedSeconds = Math.max(0, (nowMs - updatedAtMs) / 1000);
  const progressed = baseline + elapsedSeconds;
  return durationSeconds > 0 ? Math.min(durationSeconds, progressed) : progressed;
}

export function useMediaProgress(media?: MediaStatus | null): number {
  const now = useNowTick(800);

  if (!media) return 0;

  return resolveDisplayedProgressSeconds(
    media,
    media.updatedAt,
    now,
  );
}

export function resolveProgressPercent(
  progressSeconds: number,
  durationSeconds: number,
) {
  if (!durationSeconds || durationSeconds <= 0) return 0;
  return Math.max(0, Math.min(100, (progressSeconds / durationSeconds) * 100));
}

export function formatClock(rawSeconds: number): string {
  const total = Math.max(0, Math.round(rawSeconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

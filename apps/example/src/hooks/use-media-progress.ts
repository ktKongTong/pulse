import { useEffect, useMemo, useState } from "react";
import type { MediaStatus } from "./media-model";

export interface MediaProgressSnapshot {
  progressSeconds: number;
  progressPercent: number;
  progressLabel: string;
  durationSeconds: number;
  durationLabel: string | null;
}

export function useMediaProgress(
  media?: MediaStatus | null,
  options: { intervalMs?: number } = {},
): MediaProgressSnapshot {
  const now = useNowTick(options.intervalMs ?? 800);
  return useMemo(() => resolveMediaProgressSnapshot(media, now), [media, now]);
}

function useNowTick(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function resolveMediaProgressSnapshot(
  media: MediaStatus | null | undefined,
  nowMs: number,
): MediaProgressSnapshot {
  const progressSeconds = media
    ? resolveDisplayedProgressSeconds(media, media.updatedAt, nowMs)
    : 0;
  const durationSeconds = media?.durationSeconds ?? 0;
  return {
    progressSeconds,
    progressPercent: resolveProgressPercent(progressSeconds, durationSeconds),
    progressLabel: formatClock(progressSeconds),
    durationSeconds,
    durationLabel: durationSeconds > 0 ? formatClock(durationSeconds) : null,
  };
}

export function resolveDisplayedProgressSeconds(
  media: MediaStatus,
  updatedAt: string | undefined,
  nowMs: number,
) {
  const baseline = media.progressSeconds ?? 0;
  const durationSeconds = media.durationSeconds ?? 0;
  if (media.playbackState !== "playing") return baseline;
  const updatedAtMs = Date.parse(updatedAt ?? "");
  if (!Number.isFinite(updatedAtMs)) return baseline;
  const progressed = baseline + Math.max(0, (nowMs - updatedAtMs) / 1000);
  return durationSeconds > 0 ? Math.min(durationSeconds, progressed) : progressed;
}

export function resolveProgressPercent(progressSeconds: number, durationSeconds: number) {
  if (!durationSeconds || durationSeconds <= 0) return 0;
  return Math.max(0, Math.min(100, (progressSeconds / durationSeconds) * 100));
}

export function formatClock(rawSeconds: number) {
  const total = Math.max(0, Math.round(rawSeconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

'use client'
import { useEffect, useMemo, useState } from "react";
import type { ClientMediaNowPlaying } from "@ktfun/pulse-protocol";

export type MediaStatus = {
  providerId?: string;
  title?: string;
  artist?: string;
  album?: string;
  artworkUrl?: string;
  linkUrl?: string;
  playbackState: "playing" | "paused";
  progressSeconds: number;
  durationSeconds: number;
  updatedAt?: string;
};

export type DisplayMedia = {
  kind: "current" | "recent";
  media: MediaStatus;
};

export interface MediaProgressSnapshot {
  progressSeconds: number;
  progressPercent: number;
  progressLabel: string;
  durationSeconds: number;
  durationLabel: string | null;
}

export function mapCurrentMedia(
  media: ClientMediaNowPlaying | null,
): MediaStatus | null {
  if (!media?.current || !hasRenderableMedia(media.current)) return null;
  const playbackState = media.playback;
  return {
    providerId: cleanText(media.current.providerId ?? media.current.provider),
    title: cleanText(media.current.title),
    artist: cleanText(media.current.artist),
    album: cleanText(media.current.album),
    artworkUrl: cleanText(media.current.artworkUrl),
    linkUrl: cleanText(media.current.linkUrl),
    playbackState,
    progressSeconds:
      media.clock?.mediaProgressSeconds ?? media.current.progressSeconds ?? 0,
    durationSeconds:
      media.clock?.durationSeconds ?? media.current.durationSeconds ?? 0,
    updatedAt: media.clock?.updatedAt ?? media.updatedAt,
  };
}

export function mapDisplayMedia(
  media: ClientMediaNowPlaying | null,
): DisplayMedia | null {
  const currentMedia = mapCurrentMedia(media);
  if (!currentMedia) return null;
  return {
    kind: currentMedia.playbackState === "playing" ? "current" : "recent",
    media: currentMedia,
  };
}

export function resolveHeading(displayMedia: DisplayMedia | null) {
  if (displayMedia?.kind === "recent") return "最近在听";
  return "正在听";
}

export function mediaTitle(media: MediaStatus | null) {
  return media?.title ?? media?.artist ?? media?.album ?? "媒体信息同步中";
}

export function useMediaProgress(
  media?: MediaStatus | null,
  options: { intervalMs?: number } = {},
): MediaProgressSnapshot {
  const now = useNowTick(options.intervalMs ?? 800);
  return useMemo(() => resolveMediaProgressSnapshot(media, now), [media, now]);
}

export function resolveMediaProgressSnapshot(
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
  return durationSeconds > 0
    ? Math.min(durationSeconds, progressed)
    : progressed;
}

export function resolveProgressPercent(
  progressSeconds: number,
  durationSeconds: number,
) {
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

function useNowTick(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function hasRenderableMedia(media: ClientMediaNowPlaying["current"]) {
  return Boolean(
    cleanText(media.title) ||
      cleanText(media.artist) ||
      cleanText(media.album) ||
      cleanText(media.artworkUrl),
  );
}

function cleanText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

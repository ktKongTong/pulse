import type { ClientMediaNowPlaying } from "@pulse/v2-realtime-protocol";

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

export function mapCurrentMedia(media: ClientMediaNowPlaying | null): MediaStatus | null {
  if (!media?.current || !hasRenderableMedia(media.current)) return null;
  const playbackState = media.current.playbackState ?? media.playback;
  return {
    providerId: cleanText(media.current.providerId ?? media.current.provider),
    title: cleanText(media.current.title),
    artist: cleanText(media.current.artist),
    album: cleanText(media.current.album),
    artworkUrl: cleanText(media.current.artworkUrl),
    linkUrl: cleanText(media.current.linkUrl),
    playbackState,
    progressSeconds: media.clock?.mediaProgressSeconds ?? media.current.progressSeconds ?? 0,
    durationSeconds: media.clock?.durationSeconds ?? media.current.durationSeconds ?? 0,
    updatedAt: media.clock?.updatedAt ?? media.updatedAt,
  };
}

export function resolveHeading(displayMedia: DisplayMedia | null) {
  if (displayMedia?.kind === "recent") return "最近在听";
  return "正在听";
}

export function mediaTitle(media: MediaStatus | null) {
  return media?.title ?? media?.artist ?? media?.album ?? "媒体信息同步中";
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

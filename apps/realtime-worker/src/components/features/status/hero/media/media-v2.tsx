import { MusicIcon } from "lucide-react";
import { useMemo, useSyncExternalStore, type ReactNode } from "react";
import type { LiveListenMedia, LiveListenMediaSessionSnapshot, LiveListenRecentMedia } from "@pulse/realtime-protocol";
import {
  buildDefaultMediaLyricsQuery,
  formatClock,
  resolveDisplayedProgressSeconds,
  resolveLyricCue,
  resolveProgressPercent,
  useMediaLyrics,
  useMediaProgress,
  type MediaStatus,
} from "@pulse/realtime-react";

import { Skeleton } from "@/components/ui/skeleton";
import {
  getLiveListenMediaSessionStoreSnapshot,
  subscribeLiveListenMediaSessionStore,
} from "@/lib/live-listen-media-session";
import { cn } from "@/lib/utils";

import { LiveListenControl } from "../../live-listen/live-listen-control";
import { AnimatedLyricStack } from "./animated-lyric";
import { ProviderBadge } from "./provider-badge";

type MediaStateProps = {
  className?: string;
};

type DisplayMedia = {
  kind: "current" | "recent";
  media: MediaStatus;
};

export function MediaState({ className }: MediaStateProps) {
  const mediaSession = useMediaSessionDisplayMedia();
  const displayMedia = mediaSession.data;
  const media = displayMedia?.media ?? null;
  const heading = resolveHeading(displayMedia);

  return (
    <div className={className}>
      <div className="flex items-center gap-2">
        {mediaSession.loading ? (
          <Skeleton className="h-5 w-20 rounded-full" />
        ) : (
          <div className="line-clamp-1 py-2 text-start text-sm font-medium uppercase leading-tight tracking-widest opacity-70">
            {heading}
          </div>
        )}
        <LiveListenControl className="mt-1" />
      </div>

      {mediaSession.loading ? (
        <MediaSkeleton />
      ) : displayMedia ? (
        <div className="flex w-full flex-row items-start gap-2 md:gap-4">
          <MediaArtwork media={media} dimmed={displayMedia.kind === "recent"} />
          <div className="flex w-full min-w-0 flex-col items-start gap-3">
            <h2 className="line-clamp-1 text-start font-medium leading-tight tracking-tight text-stone-950">
              {mediaTitle(media)}
            </h2>
            {displayMedia.kind === "current" ? (
              <Lyric media={media} fallback={<MediaByline media={media} />} />
            ) : (
              <MediaByline media={media} />
            )}
          </div>
        </div>
      ) : (
        <EmptyMedia />
      )}
    </div>
  );
}

function useMediaSessionDisplayMedia() {
  const mediaSession = useLiveListenMediaSessionStore();
  const currentMedia = mapCurrentMedia(mediaSession.snapshot);
  const recentMedia = currentMedia ? null : mapRecentMedia(mediaSession.snapshot);

  const data = currentMedia
    ? { kind: "current" as const, media: currentMedia }
    : recentMedia
      ? { kind: "recent" as const, media: recentMedia }
      : null;
  return { data, loading: mediaSession.loading };
}

function useLiveListenMediaSessionStore() {
  return useSyncExternalStore(
    subscribeLiveListenMediaSessionStore,
    getLiveListenMediaSessionStoreSnapshot,
    getLiveListenMediaSessionStoreSnapshot,
  );
}

function mapCurrentMedia(snapshot: LiveListenMediaSessionSnapshot | null) {
  const media = snapshot?.media.current;
  if (!media || !hasRenderableLiveListenMedia(media)) return null;
  return mapLiveListenMedia(media, {
    progressSeconds: snapshot?.media.clock?.mediaProgressSeconds,
    updatedAt: snapshot?.media.clock?.observedAt ?? snapshot?.media.updatedAt ?? snapshot?.updatedAt,
  });
}

function mapRecentMedia(snapshot: LiveListenMediaSessionSnapshot | null) {
  const media = snapshot?.media.recent.find(hasRenderableLiveListenMedia);
  if (!media) return null;
  return mapLiveListenMedia(media, {
    progressSeconds: media.lastProgressSeconds,
    updatedAt: media.lastSeenAt ?? snapshot?.updatedAt,
    playbackState: "paused",
  });
}

function mapLiveListenMedia(
  media: LiveListenMedia | LiveListenRecentMedia,
  options: {
    progressSeconds?: number;
    updatedAt?: string;
    playbackState?: string;
  },
): MediaStatus {
  const playbackState = options.playbackState ?? media.playbackState ?? "paused";
  const durationSeconds = media.durationSeconds ?? 0;
  const baselineProgressSeconds = options.progressSeconds ?? 0;
  const progressSeconds = resolveDisplayedProgressSeconds(
    {
      playbackState,
      progressSeconds: baselineProgressSeconds,
      durationSeconds,
    },
    options.updatedAt,
    Date.now(),
  );

  return {
    providerId: media.providerId ?? media.provider,
    title: cleanText(media.title),
    artist: cleanText(media.artist),
    album: cleanText(media.album),
    artworkUrl: cleanText(media.artworkUrl),
    linkUrl: cleanText(media.linkUrl),
    playbackState,
    progressSeconds: baselineProgressSeconds,
    durationSeconds,
    updatedAt: options.updatedAt,
    progressPercent: resolveProgressPercent(progressSeconds, durationSeconds),
    progressLabel: formatClock(progressSeconds),
    durationLabel: formatClock(durationSeconds),
  };
}

function hasRenderableMedia(media: MediaStatus | null | undefined) {
  return Boolean(
    cleanText(media?.title) ||
      cleanText(media?.artist) ||
      cleanText(media?.album) ||
      cleanText(media?.artworkUrl),
  );
}

function hasRenderableLiveListenMedia(media: LiveListenMedia | LiveListenRecentMedia) {
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

function resolveHeading(displayMedia: DisplayMedia | null) {
  if (!displayMedia) return "暂无媒体";
  if (displayMedia.kind === "recent") return "最近聆听";
  return displayMedia.media.playbackState === "paused" ? "暂停聆听" : "正在聆听";
}

function mediaTitle(media: MediaStatus | null) {
  return media?.title ?? media?.artist ?? media?.album ?? "媒体信息同步中";
}

function MediaArtwork(props: { media: MediaStatus | null; dimmed?: boolean }) {
  const providerId = props.media?.providerId;

  return (
    <div
      className={cn(
        "relative size-20 shrink-0 self-center overflow-hidden rounded-lg bg-accent",
        props.dimmed && "opacity-80",
      )}
    >
      {props.media?.artworkUrl ? (
        <img
          className="h-full w-full object-cover"
          src={props.media.artworkUrl}
          alt={props.media.title ?? "Media artwork"}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
          <MusicIcon className="size-6" />
        </div>
      )}
      {providerId ? (
        <div className="absolute bottom-2 right-2">
          <ProviderBadge
            providerId={providerId}
            classNames={{ img: "size-3" }}
            className="size-3 text-white"
          />
        </div>
      ) : null}
    </div>
  );
}

function MediaByline({ media }: { media: MediaStatus | null }) {
  const text = [media?.artist, media?.album].filter(Boolean).join(" · ");
  if (!text) return <div className="h-7" />;
  return (
    <p className="line-clamp-1 text-start text-sm font-medium leading-7 text-stone-700">
      {text}
    </p>
  );
}

function EmptyMedia() {
  return (
    <div className="flex w-full flex-row items-center gap-3 text-muted-foreground">
      <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-accent">
        <MusicIcon className="size-5" />
      </div>
      <p className="text-start text-sm font-medium">最近暂无媒体</p>
    </div>
  );
}

function MediaSkeleton() {
  return (
    <div className="flex w-full flex-row items-start gap-2 md:gap-4">
      <Skeleton className="size-20 shrink-0 rounded-lg" />
      <div className="flex w-full min-w-0 flex-col items-start gap-3 pt-1">
        <Skeleton className="h-7 w-56 max-w-full" />
        <Skeleton className="h-5 w-72 max-w-full" />
      </div>
    </div>
  );
}

function Lyric({ media, fallback }: { media: MediaStatus | null; fallback: ReactNode }) {
  const lyricsQuery = useMemo(() => buildDefaultMediaLyricsQuery(media), [media]);
  const lyrics = useMediaLyrics(lyricsQuery);
  const progress = useMediaProgress(media);
  const lyricCue = resolveLyricCue(lyrics.lines, progress.progressSeconds);

  if (!lyricsQuery) return fallback;
  if (lyrics.status === "loading") return <Skeleton className="h-7 w-72 max-w-full" />;
  if (lyrics.lines.length === 0) return fallback;
  if (!lyricCue.previous && !lyricCue.current && !lyricCue.next) return fallback;

  return <AnimatedLyricStack cue={lyricCue} />;
}

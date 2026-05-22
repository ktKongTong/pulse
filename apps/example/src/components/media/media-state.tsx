import { memo, useMemo, type ReactNode } from "react";
import { MusicIcon } from "lucide-react";
import { useClientMediaDisplayState } from "@pulse/v2-realtime-react";
import {
  mapCurrentMedia,
  mediaTitle,
  resolveHeading,
  type DisplayMedia,
  type MediaStatus,
} from "../../hooks/media-model";
import {
  buildDefaultMediaLyricsQuery,
  resolveLyricCue,
  useMediaLyrics,
} from "./lyric/lyrics";
import { useMediaProgress } from "@/hooks/use-media-progress";
import { cn } from "../../lib/utils";
import { StreamControl } from "./live-listen-control";
import { AnimatedLyricStack } from "./lyric/animated-lyric";
import { ProviderBadge } from "./provider-badge";

export function MediaState({ className }: { className?: string }) {
  const mediaSession = useMediaSessionDisplayMedia();
  const displayMedia = mediaSession.data;
  const media = displayMedia?.media ?? null;
  const heading = resolveHeading(displayMedia);
  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex items-center relative">
        {mediaSession.loading ? (
          <Skeleton className="h-7 w-20 rounded" />
        ) : (
          <>
            <div className="line-clamp-1 py-1 text-start text-sm font-medium uppercase leading-tight tracking-widest opacity-70">
              {heading}
            </div>
            <StreamControl />
          </>
        )}
      </div>

      {mediaSession.loading ? (
        <MediaSkeleton />
      ) : displayMedia ? (
        <div className="flex w-full flex-row items-start gap-2 md:gap-4">
          <MediaArtwork media={media} dimmed={displayMedia.kind === "recent"} />
          <div className="flex w-full min-w-0 flex-col shrink-0 items-start gap-3">
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
  const { loading, media } = useClientMediaDisplayState();
  const currentMedia = mapCurrentMedia(media);
  const data: DisplayMedia | null = currentMedia
    ? { kind: "current", media: currentMedia }
    : null;
  return { data, loading };
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
    <div>
      {media?.artist ? (
        <p className="line-clamp-1 text-start text-xs font-medium leading-3 text-stone-400">
          {media.artist}
        </p>
      ) : null}
      {media?.album ? (
        <p className="line-clamp-1 max-w-120 text-start text-sm font-medium leading-7 text-stone-700">
          {media.album}
        </p>
      ) : null}
    </div>
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
      <Skeleton className="size-20 shrink-0 rounded" />
      <div className="flex w-full min-w-0 flex-col items-start gap-2 pt-1">
        <Skeleton className="h-7 w-56 max-w-full" />
        <div className="flex gap-1 flex-col">
          <Skeleton className="h-3 w-24 max-w-full" />
          <Skeleton className="h-5 w-72 max-w-full" />
        </div>
      </div>
    </div>
  );
}

function Lyric({ media, fallback }: { media: MediaStatus | null; fallback: ReactNode }) {
  const lyricsQuery = useMemo(() => {

    return buildDefaultMediaLyricsQuery(media)
  }, [media]);
  const lyrics = useMediaLyrics(lyricsQuery);

  const progress = useMediaProgress(media);

  const lyricCue = resolveLyricCue(lyrics.lines, progress.progressSeconds);
  console.log(lyricCue.previous?.text, lyricCue.current?.text, lyricCue.next?.text, progress.progressSeconds)
  if (!lyricsQuery) return fallback;
  if (lyrics.status === "loading") return <Skeleton className="h-7 w-72 max-w-full" />;
  if (lyrics.lines.length === 0) return fallback;
  if (!lyricCue.previous && !lyricCue.current && !lyricCue.next) return fallback;
  return <AnimatedLyricStack cue={lyricCue} />;
}

function Skeleton(props: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-amber-50/70", props.className)} />;
}

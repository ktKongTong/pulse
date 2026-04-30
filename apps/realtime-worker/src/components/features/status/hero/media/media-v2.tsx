import { motion } from "motion/react";
import React from "react";
import {
  buildDefaultMediaLyricsQuery,
  formatClock,
  resolveLyricCue,
  useMediaLyrics,
  useMediaProgress,
  useOwnerMedia,
  type MediaStatus,
} from "@pulse/realtime-react";
import { AnimatedLyricStack } from "./animated-lyric";
import { ProviderBadge } from "./provider-badge";
import { LiveListenControl } from "../../live-listen/live-listen-control";
import { useMemo } from "react";
import { cn } from "@/lib/utils";

type MediaStateProps = {
  className?: string;
}

export function MediaState({ className }: MediaStateProps) {
  const { data: media } = useOwnerMedia();
  const providerId = useMemo(() => media?.providerId, [media?.providerId])

  return (
    <div className={className}>
      <div className="font-medium text-start py-2 line-clamp-1 uppercase text-sm opacity-70 leading-tight tracking-widest">
        正在聆听
      </div>
    <div className={cn(
      "flex flex-row gap-2 md:gap-4 w-full items-start",
      // className
  )}>
    <div className="relative self-center size-20 overflow-hidden rounded-lg shrink-0 ">
      {media?.artworkUrl ? (
        <img
          className="h-full w-full object-cover"
          src={media?.artworkUrl}
          alt={media?.title ?? "Media artwork"}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-3xl text-stone-500">
          ♪
        </div>
      )}
      <div className="absolute bottom-2 right-2">
        <ProviderBadge providerId={providerId} classNames={{img: "size-3"}} className={"size-3 text-white"} />
      </div>

    </div>
      <div className="flex flex-col w-full items-start gap-3">

      <h2 className="font-medium line-clamp-1 text-start leading-tight tracking-tight text-stone-950">
        {media?.title ?? "Unknown track"}
      </h2>
      <Lyric media={media} />
      <LiveListenControl className="mt-1" />
      {/*<Progress media={media} className="mt-auto hidden md:block"/>*/}
    </div>
      </div>

    </div>
  );
}

function Lyric({ media }: { media?: MediaStatus | undefined | null }) {
  const lyricsQuery = useMemo(() => buildDefaultMediaLyricsQuery(media), [media]);
  const lyrics = useMediaLyrics(lyricsQuery);
  const progress = useMediaProgress(media);
  const lyricCue = resolveLyricCue(lyrics.lines, progress.progressSeconds);
  return <AnimatedLyricStack cue={lyricCue} />
}

type ProgressProps = {
  media?: MediaStatus | undefined | null
} & Omit<React.HTMLProps<HTMLDivElement>, 'media'>

function Progress({ media, className,  ...rest }: ProgressProps) {

  const progress = useMediaProgress(media);
  return <div className={cn('w-full', className)} {...rest}>
    <div className="h-0.5  my-3 w-full bg-stone-300/80">
      <motion.div
        className="h-0.5 bg-stone-900 "
        animate={{ width: `${progress.progressPercent}%` }}
        transition={{ duration: 0.18, ease: "linear" }}
        style={{ width: `${progress.progressPercent}%` }}
      />
    </div>
    <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.26em] text-stone-400">
      <span>{progress.progressLabel}</span>
      <span>{progress.durationLabel}</span>
    </div>
  </div>
}

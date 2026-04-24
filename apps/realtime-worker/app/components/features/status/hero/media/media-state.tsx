import { motion } from "motion/react";
import React from "react";
import {
  formatClock,
  resolveProgressPercent,
  useMediaProgress,
  useOwnerMedia,
  type MediaStatus,
} from "@pulse/realtime-react";
import { AnimatedLyricStack } from "./animated-lyric-stack";
import { ProviderBadge } from "./provider-badge";
import { resolveLyricCue } from "./lrc";
import { useMediaLyrics } from "./use-media-lyrics";
import { useMemo } from "react";
import { cn } from "@/lib/utils";


export function MediaState() {
  const { data: media } = useOwnerMedia();
  const providerId = useMemo(() => media?.providerId, [media?.providerId])

  return (
    <div className="flex flex-col min-w-80 sm:w-xl gap-1.5 md:items-stretch">
      <div className="flex flex-row gap-2 md:gap-4 w-full items-start justify-around">
        <div className="relative self-center size-32 md:size-44 overflow-hidden rounded-lg shrink-0 ">
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
            <ProviderBadge providerId={providerId} classNames={{img: "size-6 md:size-8"}} className={"size-6 md:size-8"} />
          </div>

        </div>
        <div className="flex flex-col w-full items-start gap-1">
          <h2 className="font-medium line-clamp-1 text-start leading-tight tracking-tight text-stone-950 ">
            {media?.title ?? "Unknown track"}
          </h2>
          <div className=" flex flex-col">
            <span className="text-[13px] text-stone-600">
              {media?.artist ?? "Unknown artist"}
            </span>
          </div>
          <Lyric media={media} />
          <Progress media={media} className="mt-auto hidden md:block"/>
        </div>
      </div>
      <Progress media={media} className="block md:hidden"/>
    </div>
  );
}

function Lyric({ media }: { media?: MediaStatus | undefined | null }) {
  const lyrics = useMediaLyrics(media);
  const progressSeconds = useMediaProgress(media);
  const lyricCue = resolveLyricCue(lyrics.lines, progressSeconds);
  return <AnimatedLyricStack cue={lyricCue} />
}

type ProgressProps = {
  media?: MediaStatus | undefined | null
} & Omit<React.HTMLProps<HTMLDivElement>, 'media'>

function Progress({ media, className,  ...rest }: ProgressProps) {

  const progressSeconds = useMediaProgress(media);
  const progressPercent = resolveProgressPercent(
    progressSeconds,
    media?.durationSeconds ?? 0,
  );
  const progressLabel = formatClock(progressSeconds);
  return <div className={cn('w-full', className)} {...rest}>
    <div className="h-0.5  my-3 w-full bg-stone-300/80">
      <motion.div
        className="h-0.5 bg-stone-900 "
        animate={{ width: `${progressPercent}%` }}
        transition={{ duration: 0.18, ease: "linear" }}
        style={{ width: `${progressPercent}%` }}
      />
    </div>
    <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.26em] text-stone-400">
      <span>{progressLabel}</span>
      <span>{media?.durationLabel}</span>
    </div>
  </div>
}

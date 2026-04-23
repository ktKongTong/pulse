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


export function MediaState() {
  const { data: media } = useOwnerMedia();
  const providerId = useMemo(() => media?.providerId, [media?.providerId])

  return (
    <div className="flex sm:flex-row flex-col min-w-80 sm:w-xl gap-6 md:items-stretch">
      <div className="relative self-center  overflow-hidden rounded-lg shrink-0 size-50 bg-stone-200/80">
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
        <ProviderBadge providerId={providerId} />
      </div>
      <div className="flex min-h-42 gap-1.5 w-full flex-col items-start justify-around">
        <div className="flex flex-col w-full items-start gap-1">
          <h2 className="font-medium leading-tight tracking-tight text-stone-950 ">
            {media?.title ?? "Unknown track"}
          </h2>
          <div className=" flex flex-col">
            <span className="text-[13px] text-stone-600">
              {media?.artist ?? "Unknown artist"}
            </span>
          </div>
        </div>
        <ProgressAndLyric media={media} />
      </div>
    </div>
  );
}

function Progress() {
  return
}

function ProgressAndLyric({ media }: { media?: MediaStatus | undefined | null }) {
  const lyrics = useMediaLyrics(media);
  const progressSeconds = useMediaProgress(media);
  const progressPercent = resolveProgressPercent(
    progressSeconds,
    media?.durationSeconds ?? 0,
  );
  const progressLabel = formatClock(progressSeconds);
  const lyricCue = resolveLyricCue(lyrics.lines, progressSeconds);
  return <>
    <div className="w-full">
        <AnimatedLyricStack cue={lyricCue} />
    </div>

    <div className="w-full">
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

  </>
}

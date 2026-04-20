import { motion } from "motion/react";

import {
  formatClock,
  resolveProgressPercent,
  useMediaProgress,
  useOwnerMedia,
} from "@pulse/realtime-react";
import { ProviderBadge } from "./provider-badge";

export function MediaState() {
  const { data: media } = useOwnerMedia();
  const progressSeconds = useMediaProgress(media);

  if (!media) {
    return (
      <div className="text-center">
        <p className="text-[11px] font-medium uppercase tracking-[0.34em] text-stone-400">
          Listening
        </p>
        <p className="mt-4 text-[14px] leading-7 text-stone-500">
          No active media session on the connected device.
        </p>
      </div>
    );
  }

  const progressPercent = resolveProgressPercent(
    progressSeconds,
    media.durationSeconds ?? 0,
  );
  const progressLabel = formatClock(progressSeconds);

  return (
    <div className="grid gap-7 md:grid-cols-[188px_minmax(0,1fr)] md:items-stretch">
      <div className="relative h-[188px] overflow-hidden rounded-[1.9rem] bg-stone-200/80">
        {media.artworkUrl ? (
          <img
            className="h-full w-full object-cover"
            src={media.artworkUrl}
            alt={media.title ?? "Media artwork"}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-3xl text-stone-500">
            ♪
          </div>
        )}
        <ProviderBadge providerId={media.providerId} />
      </div>

      <div className="flex min-h-[176px] flex-col justify-between pt-1">
        <p className="text-[11px] font-medium uppercase tracking-[0.34em] text-stone-400">
          Listening
        </p>
        <h2 className="mt-3 text-[22px] font-medium leading-tight tracking-tight text-stone-950 md:text-[24px]">
          {media.title ?? "Unknown track"}
        </h2>
        <p className="mt-3 text-[14px] text-stone-600">
          {media.artist ?? "Unknown artist"}
        </p>
        {media.album ? (
          <p className="mt-1 text-[13px] text-stone-400">{media.album}</p>
        ) : null}

        <div className="mt-6">
          <div className="h-[2px] w-full bg-stone-300/80">
            <motion.div
              className="h-[2px] bg-stone-900"
              animate={{ width: `${progressPercent}%` }}
              transition={{ duration: 0.18, ease: "linear" }}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <div className="mt-3 flex items-center justify-between text-[11px] uppercase tracking-[0.26em] text-stone-400">
            <span>{progressLabel}</span>
            <span>{media.durationLabel}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

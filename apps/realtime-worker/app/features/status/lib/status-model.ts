import type { GlobalRoomSnapshot } from "@pulse/realtime-protocol";

export interface StatusMediaModel {
  providerId?: string;
  artworkUrl?: string;
  title?: string;
  artist?: string;
  artistLine: string;
  progressPercent: number;
  progressLabel: string;
  durationLabel: string;
}

export function buildStatusViewModel(snapshot: GlobalRoomSnapshot | null, nowMs: number) {
  const deviceReaders = (snapshot?.activeReaders ?? []).filter(
    (reader) => reader.source === "device"
  );
  const primaryReader =
    [...deviceReaders].sort(
      (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
    )[0] ?? null;

  const media = primaryReader?.media;
  const displayedProgress = resolveDisplayedProgress(
    media?.progressSeconds ?? 0,
    media?.durationSeconds ?? 0,
    media?.playbackState,
    primaryReader?.updatedAt,
    nowMs
  );

  return {
    deviceName: primaryReader?.device?.name ?? "PulseBar",
    deviceId: primaryReader?.device?.deviceId ?? null,
    appId: primaryReader?.app?.id ?? primaryReader?.readerId ?? "idle",
    appLabel:
      primaryReader?.app?.name ?? primaryReader?.displayName ?? "No active app",
    media: media
      ? {
          providerId: media.providerId ?? undefined,
          artworkUrl: media.artworkUrl ?? undefined,
          title: media.title ?? undefined,
          artist: media.artist ?? undefined,
          artistLine: [media.artist, media.album].filter(Boolean).join(" · "),
          progressPercent: resolveMediaPercent(
            displayedProgress,
            media.durationSeconds ?? 0
          ),
          progressLabel: clock(displayedProgress),
          durationLabel: clock(media.durationSeconds ?? 0),
        }
      : null,
  };
}

function resolveMediaPercent(progressSeconds: number, durationSeconds: number) {
  if (!durationSeconds || durationSeconds <= 0) return 0;
  return Math.max(0, Math.min(100, (progressSeconds / durationSeconds) * 100));
}

function resolveDisplayedProgress(
  progressSeconds: number,
  durationSeconds: number,
  playbackState: string | undefined,
  updatedAt: string | undefined,
  nowMs: number
) {
  const baseline = progressSeconds || 0;
  if (playbackState !== "playing") return baseline;
  const updatedAtMs = Date.parse(updatedAt ?? "");
  if (!Number.isFinite(updatedAtMs)) return baseline;
  const elapsedSeconds = Math.max(0, (nowMs - updatedAtMs) / 1000);
  const progressed = baseline + elapsedSeconds;
  return durationSeconds > 0 ? Math.min(durationSeconds, progressed) : progressed;
}

function clock(rawSeconds: number) {
  const total = Math.max(0, Math.round(rawSeconds));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

import { createContext, createElement, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { RoomReader } from "@pulse/realtime-protocol";
import type { MediaStatus } from "./user-api";

type RoomReaderMedia = NonNullable<RoomReader["media"]>;
type PlaybackProgressSource = {
  progressSeconds?: number;
  durationSeconds?: number;
  playbackState?: string;
};

export interface LyricLine {
  timeSeconds: number;
  text: string;
}

export interface LyricCue {
  previous: LyricLine | null;
  current: LyricLine | null;
  next: LyricLine | null;
  state: "idle" | "upcoming" | "active";
}

export interface MediaProgressSnapshot {
  progressSeconds: number;
  progressPercent: number;
  progressLabel: string;
  durationSeconds: number;
  durationLabel: string | null;
}

export interface MediaLyricsState {
  lines: LyricLine[];
  status: "idle" | "loading" | "ready" | "empty" | "error";
}

interface MediaLyricsStoreState extends MediaLyricsState {
  queryKey: string | null;
}

export type MediaLyricsQueryValue = string | number | boolean | null | undefined;
export type MediaLyricsQuery =
  | string
  | URLSearchParams
  | Record<string, MediaLyricsQueryValue>
  | null
  | undefined;

export interface LoadMediaLyricsContext {
  signal: AbortSignal;
  queryKey: string;
}

export type MediaLyricsLoader = (
  query: Exclude<MediaLyricsQuery, null | undefined>,
  context: LoadMediaLyricsContext,
) => Promise<string | LyricLine[] | null | undefined>;

export interface MediaLyricsOptions {
  queryKey?: string | null;
  loader?: MediaLyricsLoader;
  endpoint?: string;
  fetcher?: typeof fetch;
  cache?: Map<string, LyricLine[]>;
}

const LRC_TIMESTAMP_RE = /\[(\d+):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const mediaLyricsCache = new Map<string, LyricLine[]>();
const MediaProgressTickContext = createContext<number | null>(null);

function parseFraction(raw: string | undefined) {
  if (!raw) return 0;
  if (raw.length === 3) return Number(raw) / 1000;
  if (raw.length === 2) return Number(raw) / 100;
  return Number(raw) / 10;
}

function normalizeLyricsField(value: string | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function buildDefaultMediaLyricsQuery(media: MediaStatus | null | undefined) {
  const title = normalizeLyricsField(media?.title);
  if (!title) return null;

  const query = new URLSearchParams({ title });
  const album = normalizeLyricsField(media?.album);
  const artist = normalizeLyricsField(media?.artist);

  if (album) query.set("album", album);
  if (artist) query.set("artist", artist);

  return query;
}


export function serializeMediaLyricsQuery(query: MediaLyricsQuery) {
  if (!query) return null;
  if (typeof query === "string") {
    const normalized = query.trim().replace(/^\?/, "");
    return normalized ? normalized : null;
  }
  if (query instanceof URLSearchParams) {
    const serialized = query.toString();
    return serialized ? serialized : null;
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined) continue;
    const normalized = String(value).trim();
    if (!normalized) continue;
    params.set(key, normalized);
  }

  const serialized = params.toString();
  return serialized ? serialized : null;
}

export function createEndpointMediaLyricsLoader(options: {
  endpoint: string;
  fetcher?: typeof fetch;
}): MediaLyricsLoader {
  return async (query, context) => {
    const queryString = serializeMediaLyricsQuery(query);
    if (!queryString) return null;

    const response = await (options.fetcher ?? fetch)(`${options.endpoint}?${queryString}`, {
      signal: context.signal,
      headers: {
        accept: "text/plain",
      },
    });

    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`lyrics_${response.status}`);
    }

    return response.text();
  };
}

export function useNowTick(intervalMs = 250) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);

  return now;
}

export function MediaProgressTickProvider(props: {
  children: ReactNode;
  intervalMs?: number;
}) {
  const now = useNowTick(props.intervalMs ?? 800);

  return createElement(
    MediaProgressTickContext.Provider,
    { value: now },
    props.children,
  );
}

export function useMediaProgressTick(intervalMs = 800) {
  const contextNow = useContext(MediaProgressTickContext);
  const [fallbackNow, setFallbackNow] = useState(() => Date.now());

  useEffect(() => {
    if (contextNow !== null) return;

    const timer = window.setInterval(() => {
      setFallbackNow(Date.now());
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [contextNow, intervalMs]);

  return contextNow ?? fallbackNow;
}

export function resolveDisplayedProgressSeconds(
  media: PlaybackProgressSource | null | undefined,
  updatedAt: string | undefined,
  nowMs: number,
) {
  if (!media) return 0;

  const baseline = media.progressSeconds ?? 0;
  const durationSeconds = media.durationSeconds ?? 0;
  if (media.playbackState !== "playing") return baseline;

  const updatedAtMs = Date.parse(updatedAt ?? "");
  if (!Number.isFinite(updatedAtMs)) return baseline;

  const elapsedSeconds = Math.max(0, (nowMs - updatedAtMs) / 1000);
  const progressed = baseline + elapsedSeconds;
  return durationSeconds > 0 ? Math.min(durationSeconds, progressed) : progressed;
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
    durationLabel: media?.durationLabel ?? (durationSeconds > 0 ? formatClock(durationSeconds) : null),
  };
}

export function useMediaProgress(
  media?: MediaStatus | null,
  options: { intervalMs?: number } = {},
): MediaProgressSnapshot {
  const now = useMediaProgressTick(options.intervalMs ?? 800);

  return useMemo(
    () => resolveMediaProgressSnapshot(media, now),
    [media, now],
  );
}

export function resolveProgressPercent(
  progressSeconds: number,
  durationSeconds: number,
) {
  if (!durationSeconds || durationSeconds <= 0) return 0;
  return Math.max(0, Math.min(100, (progressSeconds / durationSeconds) * 100));
}

export function formatClock(rawSeconds: number): string {
  const total = Math.max(0, Math.round(rawSeconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function parseLrc(source: string): LyricLine[] {
  const lines: LyricLine[] = [];

  for (const rawLine of source.split(/\r?\n/)) {
    const matches = [...rawLine.matchAll(LRC_TIMESTAMP_RE)];
    if (matches.length === 0) continue;

    const text = rawLine.replaceAll(LRC_TIMESTAMP_RE, "").trim();
    if (!text) continue;

    for (const match of matches) {
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      const fraction = parseFraction(match[3]);
      const timeSeconds = minutes * 60 + seconds + fraction;

      if (!Number.isFinite(timeSeconds)) continue;

      lines.push({
        timeSeconds,
        text,
      });
    }
  }

  return lines.sort((left, right) => left.timeSeconds - right.timeSeconds);
}

export function resolveActiveLyricIndex(
  lines: LyricLine[],
  progressSeconds: number,
) {
  if (lines.length === 0) return -1;

  let low = 0;
  let high = lines.length - 1;
  let resolved = -1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const line = lines[mid];

    if (!line) break;

    if (line.timeSeconds <= progressSeconds) {
      resolved = mid;
      low = mid + 1;
      continue;
    }

    high = mid - 1;
  }

  return resolved;
}

export function resolveLyricCue(
  lines: LyricLine[],
  progressSeconds: number,
): LyricCue {
  if (lines.length === 0) {
    return {
      previous: null,
      current: null,
      next: null,
      state: "idle",
    };
  }

  const activeIndex = resolveActiveLyricIndex(lines, progressSeconds);
  if (activeIndex < 0) {
    return {
      previous: null,
      current: null,
      next: lines[0] ?? null,
      state: "upcoming",
    };
  }

  return {
    previous: lines[activeIndex - 1] ?? null,
    current: lines[activeIndex] ?? null,
    next: lines[activeIndex + 1] ?? null,
    state: "active",
  };
}

function normalizeLoadedLyrics(loaded: string | LyricLine[] | null | undefined) {
  if (!loaded) return [];
  return typeof loaded === "string" ? parseLrc(loaded) : loaded;
}

export function useMediaLyrics(
  query: MediaLyricsQuery,
  options: MediaLyricsOptions = {},
): MediaLyricsState {
  const queryKey = options.queryKey ?? serializeMediaLyricsQuery(query);
  const defaultLoader = useMemo(() => createEndpointMediaLyricsLoader({
    endpoint: options.endpoint ?? "/api/lyrics",
    fetcher: options.fetcher,
  }), [options.endpoint, options.fetcher]);
  const loader = options.loader ?? defaultLoader;
  const cache = options.cache ?? mediaLyricsCache;
  const [state, setState] = useState<MediaLyricsStoreState>({
    queryKey,
    lines: [],
    status: queryKey ? "loading" : "idle",
  });

  useEffect(() => {
    if (!query || !queryKey) {
      setState({
        queryKey: null,
        lines: [],
        status: "idle",
      });
      return;
    }

    const cached = cache.get(queryKey);
    if (cached) {
      setState({
        queryKey,
        lines: cached,
        status: cached.length > 0 ? "ready" : "empty",
      });
      return;
    }

    const controller = new AbortController();
    setState({
      queryKey,
      lines: [],
      status: "loading",
    });

    void loader(query, {
      signal: controller.signal,
      queryKey,
    })
      .then(normalizeLoadedLyrics)
      .then((lines) => {
        cache.set(queryKey, lines);
        setState({
          queryKey,
          lines,
          status: lines.length > 0 ? "ready" : "empty",
        });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setState({
          queryKey,
          lines: [],
          status: "error",
        });
      });

    return () => {
      controller.abort();
    };
  }, [queryKey, loader, cache]);

  if (state.queryKey !== queryKey) {
    return {
      lines: [],
      status: queryKey ? "loading" : "idle",
    };
  }

  return {
    lines: state.lines,
    status: state.status,
  };
}

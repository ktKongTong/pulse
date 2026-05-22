import { useEffect, useState } from "react";
import type { MediaStatus } from "@/hooks/media-model";

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

const LRC_TIMESTAMP_RE = /\[(\d+):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const lyricsCache = new Map<string, LyricLine[]>();

export function useMediaLyrics(query: URLSearchParams | null) {
  const queryKey = query?.toString() || null;
  const [state, setState] = useState({
    status: queryKey ? "loading" : "idle",
    lines: [] as LyricLine[],
  });
  useEffect(() => {
    if (!queryKey) {
      setState({ status: "idle", lines: [] });
      return;
    }
    const cached = lyricsCache.get(queryKey);
    if (cached) {
      setState({ status: "ready", lines: cached });
      return;
    }
    const controller = new AbortController();
    setState({ status: "loading", lines: [] });
    fetch(`/api/lyrics?${queryKey}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.text() : null))
      .then((text) => {
        if (controller.signal.aborted) return;
        const lines = text ? parseLrc(text) : [];
        lyricsCache.set(queryKey, lines);
        setState({ status: "ready", lines });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "error", lines: [] });
      });
    return () => controller.abort();
  }, [queryKey]);

  return state;
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

export function resolveLyricCue(lines: LyricLine[], progressSeconds: number): LyricCue {
  if (lines.length === 0) return { previous: null, current: null, next: null, state: "idle" };
  const activeIndex = resolveActiveLyricIndex(lines, progressSeconds);
  if (activeIndex < 0) {
    return { previous: null, current: null, next: lines[0] ?? null, state: "upcoming" };
  }
  return {
    previous: lines[activeIndex - 1] ?? null,
    current: lines[activeIndex] ?? null,
    next: lines[activeIndex + 1] ?? null,
    state: "active",
  };
}

function parseLrc(source: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const rawLine of source.split(/\r?\n/)) {
    const matches = [...rawLine.matchAll(LRC_TIMESTAMP_RE)];
    const text = rawLine.replaceAll(LRC_TIMESTAMP_RE, "").trim();
    if (matches.length === 0 || !text) continue;
    for (const match of matches) {
      lines.push({
        timeSeconds: Number(match[1]) * 60 + Number(match[2]) + parseFraction(match[3]),
        text,
      });
    }
  }
  return lines.sort((left, right) => left.timeSeconds - right.timeSeconds);
}

function resolveActiveLyricIndex(lines: LyricLine[], progressSeconds: number) {
  let resolved = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].timeSeconds <= progressSeconds) resolved = index;
    else break;
  }
  return resolved;
}

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

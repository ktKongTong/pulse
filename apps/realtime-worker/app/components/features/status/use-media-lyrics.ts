import { useEffect, useState } from "react";

import type { MediaStatus } from "@pulse/realtime-react";

import { parseLrc, type LyricLine } from "./lrc";

interface LyricsState {
  lines: LyricLine[];
  status: "idle" | "loading" | "ready" | "empty" | "error";
}

interface LyricsStoreState extends LyricsState {
  queryKey: string | null;
}

const lyricsCache = new Map<string, LyricLine[]>();

function normalizeField(value: string | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function buildLyricsQuery(media: MediaStatus | null | undefined) {
  const title = normalizeField(media?.title);
  if (!title) return null;

  const query = new URLSearchParams({ title });
  const album = normalizeField(media?.album);
  const artist = normalizeField(media?.artist);

  if (album) query.set("album", album);
  if (artist) query.set("artist", artist);

  return query;
}

export function useMediaLyrics(media: MediaStatus | null | undefined): LyricsState {
  const query = buildLyricsQuery(media);
  const queryKey = query?.toString() ?? null;
  const [state, setState] = useState<LyricsStoreState>({
    queryKey,
    lines: [],
    status: queryKey ? "loading" : "idle",
  });

  useEffect(() => {
    if (!queryKey) {
      setState({
        queryKey: null,
        lines: [],
        status: "idle",
      });
      return;
    }

    const cached = lyricsCache.get(queryKey);
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

    void fetch(`/api/lyrics?${queryKey}`, {
      signal: controller.signal,
      headers: {
        accept: "text/plain",
      },
    })
      .then(async (response) => {
        if (response.status === 404) return [];
        if (!response.ok) {
          throw new Error(`lyrics_${response.status}`);
        }

        const lrc = await response.text();
        return parseLrc(lrc);
      })
      .then((lines) => {
        lyricsCache.set(queryKey, lines);
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
  }, [queryKey]);

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

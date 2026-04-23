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

function parseFraction(raw: string | undefined) {
  if (!raw) return 0;
  if (raw.length === 3) return Number(raw) / 1000;
  if (raw.length === 2) return Number(raw) / 100;
  return Number(raw) / 10;
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

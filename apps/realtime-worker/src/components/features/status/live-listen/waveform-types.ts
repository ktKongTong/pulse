export type WaveformPoint = {
  peak: number;
  rms: number;
  seq: number;
  timestamp: number;
};

export function latestWaveformPoint(points: WaveformPoint[]) {
  return points.at(-1) ?? null;
}

export function normalizeWaveformHistory(
  points: WaveformPoint[],
  targetSize: number,
  windowMs: number,
  now = Date.now(),
): WaveformPoint[] {
  const size = Math.max(1, Math.floor(targetSize));
  const normalized: WaveformPoint[] = [];
  const windowStart = now - windowMs;
  for (let index = 0; index < size; index += 1) {
    const start = windowStart + (windowMs * index) / size;
    const end = windowStart + (windowMs * (index + 1)) / size;
    const slice = points.filter((point) => point.timestamp >= start && point.timestamp < end);
    if (slice.length === 0) {
      normalized.push({ peak: 0, rms: 0, seq: index, timestamp: end });
      continue;
    }
    const peak = Math.max(...slice.map((point) => point.peak), 0);
    const rms = slice.reduce((sum, point) => sum + point.rms, 0) / slice.length;
    normalized.push({ peak, rms, seq: index, timestamp: end });
  }
  return normalized;
}

export function waveformScaleMax(histories: WaveformPoint[][]) {
  return Math.max(
    0.03,
    ...histories.flatMap((history) => history.map((point) => point.peak)),
  );
}

export function commonWaveformWindowEnd(histories: WaveformPoint[][], fallback = Date.now()) {
  const latestTimestamps = histories
    .map((history) => latestWaveformPoint(history)?.timestamp ?? null)
    .filter((timestamp): timestamp is number => typeof timestamp === "number" && timestamp > 0);

  if (latestTimestamps.length === 0) return fallback;
  return Math.min(...latestTimestamps);
}

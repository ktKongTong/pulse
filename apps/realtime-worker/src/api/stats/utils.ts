import type { StatsBucket, StatsPeriod } from "@pulse/realtime-protocol";

function toDate(day: string) {
  return new Date(`${day}T00:00:00.000Z`);
}

function toDayString(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function startOfWeek(date: Date) {
  const next = new Date(date);
  const day = next.getUTCDay();
  const delta = day === 0 ? -6 : 1 - day;
  return addDays(next, delta);
}

function startOfMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function startOfYear(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
}

export function dayKeyFromIso(isoDateTime: string) {
  return isoDateTime.slice(0, 10);
}

export function dayKeyFromMs(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function coerceNonNegativeInt(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.round(value));
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.round(parsed));
    }
  }
  return 0;
}

export function coerceNonNegativeFloat(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, value);
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(0, parsed);
    }
  }
  return 0;
}

export function bucketForDay(day: string, period: StatsPeriod): StatsBucket {
  const date = toDate(day);

  switch (period) {
    case "day": {
      return {
        period,
        key: day,
        label: day,
        startDay: day,
        endDay: day,
      };
    }
    case "week": {
      const start = startOfWeek(date);
      const end = addDays(start, 6);
      const startDay = toDayString(start);
      const endDay = toDayString(end);
      return {
        period,
        key: `${startDay}:${endDay}`,
        label: `${startDay} → ${endDay}`,
        startDay,
        endDay,
      };
    }
    case "month": {
      const start = startOfMonth(date);
      const end = addDays(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)), -1);
      const startDay = toDayString(start);
      const endDay = toDayString(end);
      const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
      return {
        period,
        key,
        label: key,
        startDay,
        endDay,
      };
    }
    case "year": {
      const start = startOfYear(date);
      const end = addDays(new Date(Date.UTC(date.getUTCFullYear() + 1, 0, 1)), -1);
      const startDay = toDayString(start);
      const endDay = toDayString(end);
      const key = String(date.getUTCFullYear());
      return {
        period,
        key,
        label: key,
        startDay,
        endDay,
      };
    }
  }
}

export function compareBucketsDesc(left: StatsBucket, right: StatsBucket) {
  return right.startDay.localeCompare(left.startDay);
}

export function splitDurationAcrossDays(
  startMs: number,
  endMs: number,
  onSegment: (day: string, durationMs: number) => void,
) {
  let cursor = Math.max(0, Math.round(startMs));
  const end = Math.max(0, Math.round(endMs));
  while (cursor < end) {
    const day = dayKeyFromMs(cursor);
    const dayEndMs = Date.parse(`${day}T23:59:59.999Z`) + 1;
    const segmentEnd = Math.min(end, dayEndMs);
    if (segmentEnd > cursor) {
      onSegment(day, segmentEnd - cursor);
    }
    cursor = segmentEnd;
  }
}

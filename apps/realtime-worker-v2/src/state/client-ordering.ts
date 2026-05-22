import type { TabPageState } from "./client";

export function maxIso(left: string, right: string) {
  if (!left) return right;
  return Date.parse(right) > Date.parse(left) ? right : left;
}

export function byLastSeenDesc<T extends { lastSeenAt: string }>(a: T, b: T) {
  return Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt);
}

export function isNewerTabUpdate(
  next: Pick<TabPageState, "seq" | "observedAt">,
  previous: Pick<TabPageState, "seq" | "observedAt">,
) {
  if (next.seq !== previous.seq) return next.seq > previous.seq;
  return Date.parse(next.observedAt) > Date.parse(previous.observedAt);
}

export function isNewerLastSeen(tab: TabPageState, previous: string) {
  return Date.parse(tab.lastSeenAt) >= Date.parse(previous);
}

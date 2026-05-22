import type { OwnerFocus } from "@pulse/v2-realtime-protocol";
import type { PageAggregate } from "./client";

export function ownerFocusEqual(
  left: OwnerFocus | null,
  right: OwnerFocus | null,
) {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.updatedAt === right.updatedAt &&
    left.app?.id === right.app?.id &&
    left.app?.name === right.app?.name &&
    left.app?.category === right.app?.category &&
    left.app?.icon === right.app?.icon &&
    left.window?.title === right.window?.title;
}

export function pageAggregateEqual(
  left: PageAggregate | undefined,
  right: PageAggregate | null,
) {
  if (!left || !right) return !left && !right;
  if (
    left.canonicalUrl !== right.canonicalUrl ||
    left.title !== right.title ||
    left.url !== right.url ||
    left.sessionCount !== right.sessionCount ||
    left.lastSeenAt !== right.lastSeenAt ||
    left.sessions.length !== right.sessions.length
  ) {
    return false;
  }
  return left.sessions.every((session, index) => {
    const next = right.sessions[index];
    return session.sessionId === next.sessionId &&
      session.tabCount === next.tabCount &&
      session.lastSeenAt === next.lastSeenAt &&
      session.progress?.percent === next.progress?.percent &&
      session.progress?.scrollY === next.progress?.scrollY;
  });
}

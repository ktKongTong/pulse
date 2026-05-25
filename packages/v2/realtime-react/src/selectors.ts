import type {
  ActivePagesView,
  GlobalOnlineCountView,
  GlobalSessionActivityView,
  GlobalSessionPreviewView,
  OwnerFocusView,
  PageReadersView,
  PulseRealtimeV2Snapshot,
} from "./types";

export function selectGlobalOnlineCount(
  state: PulseRealtimeV2Snapshot,
): number {
  return state.common.snapshot?.sessions.totalCount ?? 0
}

export function selectActivePages(
  state: PulseRealtimeV2Snapshot,
): ActivePagesView {
  const snapshot = state.common.snapshot;
  return {
    activePageCount: snapshot?.activePages.totalCount ?? 0,
    activePages:
      snapshot?.activePages.top.map((page) => ({
        canonicalUrl: page.canonicalUrl,
        title: page.title,
        url: page.url,
        sessionCount: page.sessionCount,
      })) ?? [],
  };
}

export function selectOwnerFocus(
  state: PulseRealtimeV2Snapshot,
): OwnerFocusView {
  return state.common.snapshot?.owner.focus ?? null;
}

export function selectGlobalSessionPreview(
  state: PulseRealtimeV2Snapshot,
): GlobalSessionPreviewView {
  const snapshot = state.common.snapshot;
  return {
    sessionCount: snapshot?.sessions.totalCount ?? 0,
    sessions:
      snapshot?.sessions.recent.map((session) => ({
        sessionId: session.sessionId,
        user: session.user,
      })) ?? [],
  };
}

export function selectGlobalSessionActivity(
  state: PulseRealtimeV2Snapshot,
): GlobalSessionActivityView {
  return {
    sessions:
      state.common.snapshot?.sessions.recent.map((session) => ({
        sessionId: session.sessionId,
        user: session.user,
        pages: session.pages,
      })) ?? [],
  };
}

export function selectPageReaders(
  state: PulseRealtimeV2Snapshot,
  canonicalUrl: string,
): PageReadersView {
  const page = state.pages[canonicalUrl]?.snapshot;
  return {
    canonicalUrl,
    sessionCount: page?.sessions.totalCount ?? 0,
    sessions:
      page?.sessions.recent.map((session) => ({
        sessionId: session.sessionId,
        progress: session.progress,
      })) ?? [],
  };
}

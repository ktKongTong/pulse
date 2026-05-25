import type { ClientCommonActivePageDetail, ClientCommonGlobalSnapshot, ClientCommonSessionDetail, ClientCommonSessionPage, ClientPageSnapshot, ClientUser, OwnerFocus } from "@ktfun/pulse-protocol";
import { byLastSeenDesc, isNewerLastSeen, maxIso } from "./client-ordering";

export interface CommonConnectionMeta {
  connectionId: string;
  sessionId: string;
  tabId: string;
  connectedAt: string;
  lastSeenAt: string;
  user?: ClientUser;
}

export interface PageAggregate {
  canonicalUrl: string;
  title?: string;
  url?: string;
  sessionCount: number;
  sessions: PageSessionAggregate[];
  lastSeenAt: string;
}

export interface PageSessionAggregate {
  sessionId: string;
  tabCount: number;
  progress?: { percent?: number; scrollY?: number };
  lastSeenAt: string;
}

export interface GlobalStoredState {
  users: Record<string, ClientUser | undefined>;
  pageAggregates: Record<string, PageAggregate>;
  ownerFocus: OwnerFocus | null;
  revision: number;
  updatedAt: string;
}

export interface TabPageState {
  sessionId: string;
  tabId: string;
  canonicalUrl: string;
  title?: string;
  url?: string;
  progress?: { percent?: number; scrollY?: number };
  observedAt: string;
  seq: number;
  lastSeenAt: string;
}

export function emptyGlobalState(now: string): GlobalStoredState {
  return {
    users: {},
    pageAggregates: {},
    ownerFocus: null,
    revision: 0,
    updatedAt: now,
  };
}

export function buildGlobalSnapshot(input: {
  connections: CommonConnectionMeta[];
  state: GlobalStoredState;
}): ClientCommonGlobalSnapshot {
  const pagesBySession = sessionPages(input.state.pageAggregates);
  const sessions = input.connections.reduce((map, connection) => {
    const existing = map.get(connection.sessionId);
    if (existing) {
      existing.tabCount += 1;
      existing.lastSeenAt = maxIso(existing.lastSeenAt, connection.lastSeenAt);
      return map;
    }
    map.set(connection.sessionId, {
      sessionId: connection.sessionId,
      tabCount: 1,
      user: connection.user ?? input.state.users[connection.sessionId],
      pages: pagesBySession.get(connection.sessionId) ?? [],
      lastSeenAt: connection.lastSeenAt,
    });
    return map;
  }, new Map<string, ClientCommonSessionDetail>());

  const activePages = Object.values(input.state.pageAggregates)
    .sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt));

  return {
    revision: input.state.revision,
    updatedAt: input.state.updatedAt,
    sessions: {
      totalCount: sessions.size,
      recent: Array.from(sessions.values())
        .sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt))
        .slice(0, 10),
    },
    activePages: {
      totalCount: activePages.length,
      top: activePages.slice(0, 10).map(toActivePage),
    },
    owner: { focus: input.state.ownerFocus },
  };
}

export function buildPageSnapshot(
  revision: number,
  updatedAt: string,
  canonicalUrl: string,
  tabs: TabPageState[],
): ClientPageSnapshot {
  const aggregate = aggregatePage(canonicalUrl, tabs);
  return {
    revision,
    updatedAt,
    page: {
      canonicalUrl,
      title: aggregate?.title,
      url: aggregate?.url,
    },
    sessions: {
      totalCount: aggregate?.sessionCount ?? 0,
      recent: aggregate?.sessions.slice(0, 10) ?? [],
    },
  };
}

export function aggregatePage(canonicalUrl: string, tabs: TabPageState[]) {
  const sessions = new Map<string, PageSessionAggregate>();
  let title: string | undefined;
  let url: string | undefined;
  let lastSeenAt = "";
  for (const tab of tabs) {
    title = tab.title ?? title;
    url = tab.url ?? url;
    lastSeenAt = maxIso(lastSeenAt, tab.lastSeenAt);
    const sessionId = tab.sessionId;
    const existing = sessions.get(sessionId);
    if (!existing) {
      sessions.set(sessionId, {
        sessionId,
        tabCount: 1,
        progress: tab.progress,
        lastSeenAt: tab.lastSeenAt,
      });
    } else {
      const previousLastSeenAt = existing.lastSeenAt;
      existing.tabCount += 1;
      existing.lastSeenAt = maxIso(existing.lastSeenAt, tab.lastSeenAt);
      if (isNewerLastSeen(tab, previousLastSeenAt)) existing.progress = tab.progress;
    }
  }
  if (sessions.size === 0) return null;
  return {
    canonicalUrl,
    title,
    url,
    sessionCount: sessions.size,
    sessions: Array.from(sessions.values()).sort(byLastSeenDesc),
    lastSeenAt,
  };
}

function sessionPages(aggregates: Record<string, PageAggregate>) {
  const pages = new Map<string, ClientCommonSessionPage[]>();
  for (const aggregate of Object.values(aggregates)) {
    for (const session of aggregate.sessions) {
      const list = pages.get(session.sessionId) ?? [];
      list.push({
        canonicalUrl: aggregate.canonicalUrl,
        title: aggregate.title,
        url: aggregate.url,
        tabCount: session.tabCount,
        lastSeenAt: session.lastSeenAt,
      });
      pages.set(session.sessionId, list.sort(byLastSeenDesc).slice(0, 10));
    }
  }
  return pages;
}

function toActivePage(page: PageAggregate): ClientCommonActivePageDetail {
  return {
    canonicalUrl: page.canonicalUrl,
    title: page.title,
    url: page.url,
    sessionCount: page.sessionCount,
    lastSeenAt: page.lastSeenAt,
  };
}

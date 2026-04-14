import type {
  DeviceAggregate,
  DeviceAggregateHistoryPoint,
  PageAggregate,
  PageAggregateHistoryPoint,
  PresenceEvent,
  PresenceIngestRequest,
  PresenceStatePayload,
  RoomAggregate,
  RoomAggregateHistoryPoint,
  StatsBucket,
  StatsAggregateValue,
  StatsPeriod,
  StatsSummary,
  StatsSummaryHistoryPoint,
  WebEvent,
  WebIngestRequest,
} from "@pulse/realtime-protocol";

import type { StoredRoomReader, StoredRoomState, WebApplyResult } from "./room-state";

interface AggregateValueBucket {
  label: string;
  totalSeconds: number;
  count: number;
}

interface MediaAggregateBucket {
  providerId: string;
  trackId?: string;
  title?: string;
  totalSeconds: number;
  count: number;
}

interface GlobalDailyBucket {
  day: string;
  startedAtMs: number;
  lastUpdatedAtMs: number;
  currentOnlineCount: number;
  currentDeviceCount: number;
  currentWebCount: number;
  onlineIntegralMs: number;
  onlineCountPeak: number;
  activeDeviceCountPeak: number;
  activeWebReaderCountPeak: number;
  mediaActiveSecondsByProvider: Record<string, AggregateValueBucket>;
  devicePresenceSecondsByApp: Record<string, AggregateValueBucket>;
  ops: {
    dedupedEventCount: number;
    rejectedEventCount: number;
    expiredSessionCount: number;
    roomRevisionBumpCount: number;
    broadcastCount: number;
    wsSubscriberCountPeak: number;
    sseSubscriberCountPeak: number;
  };
}

interface PageDailyBucket {
  day: string;
  canonicalUrl: string;
  title: string;
  startedAtMs: number;
  lastUpdatedAtMs: number;
  currentOnlineCount: number;
  onlineIntegralMs: number;
  onlineCountPeak: number;
  pageViewCount: number;
  readerSessionCount: number;
  progressSum: number;
  progressSamples: number;
  maxProgressPercent: number;
  completionBucketCounts: {
    zeroToTwentyFive: number;
    twentyFiveToFifty: number;
    fiftyToSeventyFive: number;
    seventyFiveToHundred: number;
  };
  visibleSeconds: number;
  hiddenSeconds: number;
  idleSeconds: number;
  bounceCount: number;
  engagedReaderCount: number;
  pageTransitionOutCount: number;
  pageTransitionInCount: number;
  uniqueSessionIds: Record<string, true>;
}

interface RoomBucket {
  day: string;
  roomId: string;
  startedAtMs: number;
  lastUpdatedAtMs: number;
  currentOnlineCount: number;
  onlineIntegralMs: number;
  onlineCountPeak: number;
  progressSum: number;
  progressSamples: number;
  maxProgressPercent: number;
  deviceReaderCount: number;
  webReaderCount: number;
  entryCount: number;
  exitCount: number;
  uniqueReaderSessions: Record<string, true>;
}

interface DeviceDailyBucket {
  day: string;
  deviceId: string;
  focusSwitchCount: number;
  mediaSwitchCount: number;
  sessionCount: number;
  appFocus: Record<string, AggregateValueBucket>;
  mediaPlayback: Record<string, MediaAggregateBucket>;
}

interface RawJournalEntry {
  protocol: "presence.v2" | "web.v1";
  source: "device" | "web";
  workspaceId: string;
  siteId?: string;
  roomId: string;
  deviceId?: string;
  sessionId: string;
  eventId: string;
  seq: number;
  observedAt: string;
  sentAt: string;
  kind: string;
  ingestResult: "accepted" | "deduped" | "rejected";
  rejectedReason?: string;
  payload: {
    page?: {
      title?: string;
      url?: string;
      canonicalUrl?: string;
    };
    app?: {
      id?: string;
      name?: string;
    };
    reading?: {
      progressPercent?: number;
      scrollY?: number;
    };
    media?: {
      providerId?: string;
      title?: string;
      trackId?: string;
      state?: string;
      progressSeconds?: number;
      durationSeconds?: number;
    };
    presenceState?: string;
  };
}

interface WebSessionState {
  sessionId: string;
  currentUrl: string;
  currentTitle: string;
  enteredAtMs: number;
  lastObservedAtMs: number;
  lastVisibility: "visible" | "hidden";
  lastPresence: "active" | "hidden" | "idle" | "offline";
  maxProgressPercent: number;
}

interface DeviceSessionState {
  deviceId: string;
  lastObservedAtMs: number;
  currentAppId?: string;
  currentAppLabel?: string;
  currentMediaKey?: string;
  currentMediaProvider?: string;
  currentMediaTitle?: string;
  currentMediaPlaying: boolean;
}

const SERVER_RAW_RETENTION_MS = 72 * 60 * 60 * 1000;
const DAILY_RETENTION_DAYS = 93;
const MONTHLY_RETENTION_MONTHS = 36;
const YEARLY_RETENTION_YEARS = 10;

export interface StoredStatsState {
  globalDaily: Record<string, GlobalDailyBucket>;
  globalMonthly: Record<string, GlobalDailyBucket>;
  globalYearly: Record<string, GlobalDailyBucket>;
  pageDaily: Record<string, PageDailyBucket>;
  pageMonthly: Record<string, PageDailyBucket>;
  pageYearly: Record<string, PageDailyBucket>;
  roomDaily: Record<string, RoomBucket>;
  roomHourly: Record<string, RoomBucket>;
  roomMonthly: Record<string, RoomBucket>;
  roomYearly: Record<string, RoomBucket>;
  deviceDaily: Record<string, DeviceDailyBucket>;
  deviceMonthly: Record<string, DeviceDailyBucket>;
  deviceYearly: Record<string, DeviceDailyBucket>;
  rawJournal: RawJournalEntry[];
  webSessions: Record<string, WebSessionState>;
  deviceSessions: Record<string, DeviceSessionState>;
}

export function createStatsState(): StoredStatsState {
  return {
    globalDaily: {},
    globalMonthly: {},
    globalYearly: {},
    pageDaily: {},
    pageMonthly: {},
    pageYearly: {},
    roomDaily: {},
    roomHourly: {},
    roomMonthly: {},
    roomYearly: {},
    deviceDaily: {},
    deviceMonthly: {},
    deviceYearly: {},
    rawJournal: [],
    webSessions: {},
    deviceSessions: {},
  };
}

export function normalizeStatsState(state?: StoredStatsState): StoredStatsState {
  return {
    globalDaily: state?.globalDaily ?? {},
    globalMonthly: state?.globalMonthly ?? {},
    globalYearly: state?.globalYearly ?? {},
    pageDaily: state?.pageDaily ?? {},
    pageMonthly: state?.pageMonthly ?? {},
    pageYearly: state?.pageYearly ?? {},
    roomDaily: state?.roomDaily ?? {},
    roomHourly: state?.roomHourly ?? {},
    roomMonthly: state?.roomMonthly ?? {},
    roomYearly: state?.roomYearly ?? {},
    deviceDaily: state?.deviceDaily ?? {},
    deviceMonthly: state?.deviceMonthly ?? {},
    deviceYearly: state?.deviceYearly ?? {},
    rawJournal: state?.rawJournal ?? [],
    webSessions: state?.webSessions ?? {},
    deviceSessions: state?.deviceSessions ?? {},
  };
}

export function pruneRawJournal(roomState: StoredRoomState, nowMs: number): boolean {
  if (roomState.roomId !== "global") return false;
  const before = roomState.stats!.rawJournal.length;
  roomState.stats!.rawJournal = roomState.stats!.rawJournal.filter(
    (entry) => nowMs - Date.parse(entry.observedAt) <= SERVER_RAW_RETENTION_MS
  );
  return roomState.stats!.rawJournal.length != before;
}

export function pruneAggregateHistory(roomState: StoredRoomState, nowMs: number): boolean {
  if (roomState.roomId !== "global") return false;
  const stats = roomState.stats!;
  const currentDay = dayKeyFromMs(nowMs);
  const currentMonth = monthKeyFromDay(currentDay);
  const currentYear = yearKeyFromDay(currentDay);

  return [
    pruneMapByAge(stats.globalDaily, (key) => dayStartMs(key), nowMs, DAILY_RETENTION_DAYS * 24 * 60 * 60 * 1000),
    pruneMapByAge(stats.pageDaily, (key) => dayStartMs(key.split("|")[0]!), nowMs, DAILY_RETENTION_DAYS * 24 * 60 * 60 * 1000),
    pruneMapByAge(stats.roomDaily, (key) => dayStartMs(key.split("|")[0]!), nowMs, DAILY_RETENTION_DAYS * 24 * 60 * 60 * 1000),
    pruneMapByAge(stats.deviceDaily, (key) => dayStartMs(key.split("|")[0]!), nowMs, DAILY_RETENTION_DAYS * 24 * 60 * 60 * 1000),
    pruneMapByAge(stats.globalMonthly, (key) => monthStartMs(key), monthStartMs(currentMonth), MONTHLY_RETENTION_MONTHS * 31 * 24 * 60 * 60 * 1000),
    pruneMapByAge(stats.pageMonthly, (key) => monthStartMs(key.split("|")[0]!), monthStartMs(currentMonth), MONTHLY_RETENTION_MONTHS * 31 * 24 * 60 * 60 * 1000),
    pruneMapByAge(stats.roomMonthly, (key) => monthStartMs(key.split("|")[0]!), monthStartMs(currentMonth), MONTHLY_RETENTION_MONTHS * 31 * 24 * 60 * 60 * 1000),
    pruneMapByAge(stats.deviceMonthly, (key) => monthStartMs(key.split("|")[0]!), monthStartMs(currentMonth), MONTHLY_RETENTION_MONTHS * 31 * 24 * 60 * 60 * 1000),
    pruneMapByAge(stats.globalYearly, (key) => yearStartMs(key), yearStartMs(currentYear), YEARLY_RETENTION_YEARS * 366 * 24 * 60 * 60 * 1000),
    pruneMapByAge(stats.pageYearly, (key) => yearStartMs(key.split("|")[0]!), yearStartMs(currentYear), YEARLY_RETENTION_YEARS * 366 * 24 * 60 * 60 * 1000),
    pruneMapByAge(stats.roomYearly, (key) => yearStartMs(key.split("|")[0]!), yearStartMs(currentYear), YEARLY_RETENTION_YEARS * 366 * 24 * 60 * 60 * 1000),
    pruneMapByAge(stats.deviceYearly, (key) => yearStartMs(key.split("|")[0]!), yearStartMs(currentYear), YEARLY_RETENTION_YEARS * 366 * 24 * 60 * 60 * 1000),
  ].some(Boolean);
}

export function appendPresenceRawJournal(
  roomState: StoredRoomState,
  request: PresenceIngestRequest,
  event: PresenceEvent,
  ingestResult: "accepted" | "deduped" | "rejected",
  rejectedReason?: string
) {
  if (roomState.roomId !== "global") return;
  roomState.stats!.rawJournal.push({
    protocol: "presence.v2",
    source: "device",
    workspaceId: request.workspaceId,
    roomId: "global",
    deviceId: request.deviceId,
    sessionId: request.sessionId,
    eventId: event.eventId,
    seq: event.seq,
    observedAt: event.observedAt,
    sentAt: event.sentAt,
    kind: event.kind,
    ingestResult,
    rejectedReason,
    payload: presencePayload(event.state),
  });
}

export function appendWebRawJournal(
  roomState: StoredRoomState,
  request: WebIngestRequest,
  event: WebEvent,
  ingestResult: "accepted" | "deduped" | "rejected",
  rejectedReason?: string
) {
  if (roomState.roomId !== "global") return;
  roomState.stats!.rawJournal.push({
    protocol: "web.v1",
    source: "web",
    workspaceId: request.workspaceId,
    siteId: request.siteId,
    roomId: event.page.canonicalUrl ? `page:${event.page.canonicalUrl}` : "global",
    sessionId: request.sessionId,
    eventId: event.eventId,
    seq: event.seq,
    observedAt: event.observedAt,
    sentAt: event.sentAt,
    kind: event.kind,
    ingestResult,
    rejectedReason,
    payload: {
      page: {
        title: event.page.title,
        url: event.page.url,
        canonicalUrl: event.page.canonicalUrl,
      },
      reading: event.reading
        ? {
            progressPercent: event.reading.progressPercent,
            scrollY: event.reading.scrollY,
          }
        : undefined,
      presenceState: event.presence.state,
    },
  });
}

export function updatePresenceAggregates(
  roomState: StoredRoomState,
  request: PresenceIngestRequest,
  event: PresenceEvent,
  nowMs: number
) {
  if (roomState.roomId !== "global") return;
  const stats = roomState.stats!;
  const deviceSession = stats.deviceSessions[request.deviceId];

  if (deviceSession) {
    for (const window of rollupWindowsForObservedAt(event.observedAt)) {
      accumulateDeviceDelta(
        getDeviceBucket(stats, window.period, window.key, request.deviceId),
        getGlobalBucket(stats, window.period, window.key, nowMs),
        deviceSession,
        nowMs
      );
    }
  }

  if (event.kind === "session_end" || !event.state) {
    delete stats.deviceSessions[request.deviceId];
    return;
  }

  const appId = event.state.focus.app?.id ?? "unknown";
  const appLabel = event.state.focus.app?.name ?? request.deviceId;
  const media = event.state.mediaSessions[0];
  const mediaKey = media?.item.id ?? media?.item.title ?? "";
  const mediaProvider = media?.provider.id;
  const mediaTitle = media?.item.title;
  const mediaPlaying = media?.playback.state === "playing";

  for (const window of rollupWindowsForObservedAt(event.observedAt)) {
    const deviceBucket = getDeviceBucket(stats, window.period, window.key, request.deviceId);
    if (!deviceSession) {
      deviceBucket.sessionCount += 1;
    } else {
      if (deviceSession.currentAppId && deviceSession.currentAppId !== appId) {
        deviceBucket.focusSwitchCount += 1;
      }
      if (
        deviceSession.currentMediaKey &&
        mediaKey &&
        deviceSession.currentMediaKey !== mediaKey
      ) {
        deviceBucket.mediaSwitchCount += 1;
      }
    }
  }

  stats.deviceSessions[request.deviceId] = {
    deviceId: request.deviceId,
    lastObservedAtMs: nowMs,
    currentAppId: appId,
    currentAppLabel: appLabel,
    currentMediaKey: mediaKey || undefined,
    currentMediaProvider: mediaProvider,
    currentMediaTitle: mediaTitle,
    currentMediaPlaying: mediaPlaying,
  };
}

export function updateWebAggregates(
  roomState: StoredRoomState,
  request: WebIngestRequest,
  event: WebEvent,
  result: WebApplyResult,
  nowMs: number
) {
  if (roomState.roomId !== "global") return;
  const stats = roomState.stats!;
  const transition = result.pageTransitions.find((item) => item.eventId === event.eventId);
  const session = stats.webSessions[request.sessionId];

  if (session) {
    accumulateWebDelta(stats, session, nowMs);
  }

  if (event.kind === "session_end") {
    if (session) {
      finalizeWebSession(stats, session, nowMs);
      delete stats.webSessions[request.sessionId];
    }
    if (transition?.previousRoomId) {
      const previousUrl = roomIdToCanonicalUrl(transition.previousRoomId);
      for (const window of rollupWindowsForObservedAt(event.observedAt)) {
        const bucket = getPageBucket(stats, window.period, window.key, previousUrl, session?.currentTitle ?? previousUrl, nowMs);
        const roomBucket = getRoomBucket(stats, window.period, window.key, transition.previousRoomId, nowMs);
        bucket.pageTransitionOutCount += 1;
        roomBucket.exitCount += 1;
      }
    }
    return;
  }

  const canonicalUrl = event.page.canonicalUrl ?? event.page.url;
  const windows = rollupWindowsForObservedAt(event.observedAt);
  for (const window of windows) {
    getPageBucket(stats, window.period, window.key, canonicalUrl, event.page.title, nowMs).title = event.page.title;
  }

  if (!session || session.currentUrl !== canonicalUrl) {
    if (session && session.currentUrl !== canonicalUrl) {
      for (const window of windows) {
        const previousBucket = getPageBucket(stats, window.period, window.key, session.currentUrl, session.currentTitle, nowMs);
        const previousRoomBucket = getRoomBucket(stats, window.period, window.key, `page:${session.currentUrl}`, nowMs);
        previousBucket.pageTransitionOutCount += 1;
        previousRoomBucket.exitCount += 1;
      }
      finalizeWebSession(stats, session, nowMs, false);
    }

    for (const window of windows) {
      const pageBucket = getPageBucket(stats, window.period, window.key, canonicalUrl, event.page.title, nowMs);
      const roomBucket = getRoomBucket(stats, window.period, window.key, `page:${canonicalUrl}`, nowMs);
      pageBucket.pageViewCount += 1;
      pageBucket.readerSessionCount += 1;
      pageBucket.pageTransitionInCount += 1;
      pageBucket.uniqueSessionIds[request.sessionId] = true;
      roomBucket.entryCount += 1;
      roomBucket.uniqueReaderSessions[request.sessionId] = true;
    }
    stats.webSessions[request.sessionId] = {
      sessionId: request.sessionId,
      currentUrl: canonicalUrl,
      currentTitle: event.page.title,
      enteredAtMs: nowMs,
      lastObservedAtMs: nowMs,
      lastVisibility: event.presence.visibility,
      lastPresence: event.presence.state,
      maxProgressPercent: event.reading?.progressPercent ?? 0,
    };
  } else {
    session.currentTitle = event.page.title;
    session.lastObservedAtMs = nowMs;
    session.lastPresence = event.presence.state;
    session.lastVisibility = event.presence.visibility;
    session.maxProgressPercent = Math.max(
      session.maxProgressPercent,
      event.reading?.progressPercent ?? 0
    );
  }

  if (event.reading) {
    for (const window of windows) {
      const pageBucket = getPageBucket(stats, window.period, window.key, canonicalUrl, event.page.title, nowMs);
      const roomBucket = getRoomBucket(stats, window.period, window.key, `page:${canonicalUrl}`, nowMs);
      pageBucket.progressSum += event.reading.progressPercent;
      pageBucket.progressSamples += 1;
      pageBucket.maxProgressPercent = Math.max(pageBucket.maxProgressPercent, event.reading.progressPercent);
      roomBucket.progressSum += event.reading.progressPercent;
      roomBucket.progressSamples += 1;
      roomBucket.maxProgressPercent = Math.max(roomBucket.maxProgressPercent, event.reading.progressPercent);
    }
  }
}

export function noteAggregateResult(
  roomState: StoredRoomState,
  kind: "presence" | "web",
  result: { dedupedEventIds: string[]; rejected: Array<{ eventId: string; reason: string }>; changed: boolean },
  nowMs: number
) {
  if (roomState.roomId !== "global") return;
  const stats = roomState.stats!;
  const bucket = getGlobalBucket(stats, "day", dayKeyFromMs(nowMs), nowMs);
  bucket.ops.dedupedEventCount += result.dedupedEventIds.length;
  bucket.ops.rejectedEventCount += result.rejected.length;
  if (result.changed) {
    bucket.ops.roomRevisionBumpCount += 1;
  }
}

export function noteBroadcast(
  roomState: StoredRoomState,
  nowMs: number,
  wsSubscribers: number,
  sseSubscribers: number
) {
  if (roomState.roomId !== "global") return;
  const bucket = getGlobalBucket(roomState.stats!, "day", dayKeyFromMs(nowMs), nowMs);
  bucket.ops.broadcastCount += 1;
  bucket.ops.wsSubscriberCountPeak = Math.max(bucket.ops.wsSubscriberCountPeak, wsSubscribers);
  bucket.ops.sseSubscriberCountPeak = Math.max(bucket.ops.sseSubscriberCountPeak, sseSubscribers);
}

export function updateSnapshotIntegrals(roomState: StoredRoomState, nowMs: number) {
  if (roomState.roomId !== "global") return;
  const stats = roomState.stats!;
  const deviceReaders = Object.values(roomState.readers).filter((reader) => reader.source === "device");
  const webReaders = Object.values(roomState.readers).filter((reader) => reader.source === "web");
  const windows = rollupWindowsForMs(nowMs);

  for (const window of windows) {
    const globalBucket = getGlobalBucket(stats, window.period, window.key, nowMs);
    advanceIntegral(globalBucket, nowMs, Object.keys(roomState.readers).length);
    globalBucket.currentDeviceCount = deviceReaders.length;
    globalBucket.currentWebCount = webReaders.length;
    globalBucket.activeDeviceCountPeak = Math.max(globalBucket.activeDeviceCountPeak, deviceReaders.length);
    globalBucket.activeWebReaderCountPeak = Math.max(globalBucket.activeWebReaderCountPeak, webReaders.length);
  }

  const currentPageCounts = new Map<string, number>();
  for (const reader of webReaders) {
    const canonicalUrl = reader.page?.canonicalUrl;
    if (!canonicalUrl) continue;
    currentPageCounts.set(canonicalUrl, (currentPageCounts.get(canonicalUrl) ?? 0) + 1);
  }

  const seenUrls = new Set<string>([
    ...currentPageCounts.keys(),
    ...Object.keys(stats.pageDaily).filter((key) => key.startsWith(`${dayKeyFromMs(nowMs)}|`)).map((key) => key.split("|")[1]!),
  ]);
  for (const canonicalUrl of seenUrls) {
    for (const window of windows) {
      const bucket = getPageBucket(stats, window.period, window.key, canonicalUrl, canonicalUrl, nowMs);
      advanceIntegral(bucket, nowMs, currentPageCounts.get(canonicalUrl) ?? 0);
      const roomBucket = getRoomBucket(stats, window.period, window.key, `page:${canonicalUrl}`, nowMs);
      advanceIntegral(roomBucket, nowMs, currentPageCounts.get(canonicalUrl) ?? 0);
      roomBucket.webReaderCount = currentPageCounts.get(canonicalUrl) ?? 0;
    }
  }

  for (const window of windows) {
    const globalRoomBucket = getRoomBucket(stats, window.period, window.key, "global", nowMs);
    advanceIntegral(globalRoomBucket, nowMs, Object.keys(roomState.readers).length);
    globalRoomBucket.deviceReaderCount = deviceReaders.length;
    globalRoomBucket.webReaderCount = webReaders.length;
  }
}

export function buildGlobalStats(state: StoredRoomState, day: string): StatsSummary {
  const bucket = state.stats?.globalDaily[day] ?? getGlobalBucket(createStatsState(), "day", day, Date.now());
  const elapsedMs = Math.max(1, bucket.lastUpdatedAtMs - bucket.startedAtMs);
  return {
    day,
    onlineCountPeak: bucket.onlineCountPeak,
    activeDeviceCountPeak: bucket.activeDeviceCountPeak,
    activeWebReaderCountPeak: bucket.activeWebReaderCountPeak,
    avgOnlineCount: round2(bucket.onlineIntegralMs / 1000 / (elapsedMs / 1000)),
    avgActiveReaderCount: round2(bucket.onlineIntegralMs / 1000 / (elapsedMs / 1000)),
    mediaActiveSecondsByProvider: toAggregateValues(bucket.mediaActiveSecondsByProvider),
    devicePresenceSecondsByApp: toAggregateValues(bucket.devicePresenceSecondsByApp),
    ops: bucket.ops,
  };
}

export function buildPageAggregates(state: StoredRoomState, day: string, limit: number): PageAggregate[] {
  const values = Object.values(state.stats?.pageDaily ?? {})
    .filter((bucket) => bucket.day === day)
    .map((bucket) => {
      const elapsedMs = Math.max(1, bucket.lastUpdatedAtMs - bucket.startedAtMs);
      return {
        day,
        canonicalUrl: bucket.canonicalUrl,
        title: bucket.title,
        pageViewCount: bucket.pageViewCount,
        readerOnlineSeconds: Math.round(bucket.onlineIntegralMs / 1000),
        readerSessionCount: bucket.readerSessionCount,
        avgProgressPercent: bucket.progressSamples > 0 ? round2(bucket.progressSum / bucket.progressSamples) : 0,
        maxProgressPercent: bucket.maxProgressPercent,
        completionBucketCounts: bucket.completionBucketCounts,
        visibleSeconds: bucket.visibleSeconds,
        hiddenSeconds: bucket.hiddenSeconds,
        idleSeconds: bucket.idleSeconds,
        bounceCount: bucket.bounceCount,
        engagedReaderCount: bucket.engagedReaderCount,
        pageTransitionOutCount: bucket.pageTransitionOutCount,
        pageTransitionInCount: bucket.pageTransitionInCount,
        onlineCountPeak: bucket.onlineCountPeak,
        avgOnlineCount: round2(bucket.onlineIntegralMs / 1000 / (elapsedMs / 1000)),
      } satisfies PageAggregate;
    })
    .sort((left, right) => right.readerOnlineSeconds - left.readerOnlineSeconds);
  return limit > 0 ? values.slice(0, limit) : values;
}

export function buildRoomAggregates(state: StoredRoomState, day: string, limit: number): RoomAggregate[] {
  const values = Object.values(state.stats?.roomDaily ?? {})
    .filter((bucket) => bucket.day === day)
    .map((bucket) => {
      const elapsedMs = Math.max(1, bucket.lastUpdatedAtMs - bucket.startedAtMs);
      return {
        day,
        roomId: bucket.roomId,
        onlineCountPeak: bucket.onlineCountPeak,
        avgOnlineCount: round2(bucket.onlineIntegralMs / 1000 / (elapsedMs / 1000)),
        roomOnlineSecondsIntegral: Math.round(bucket.onlineIntegralMs / 1000),
        uniqueReaderSessions: Object.keys(bucket.uniqueReaderSessions).length,
        avgProgressPercent: bucket.progressSamples > 0 ? round2(bucket.progressSum / bucket.progressSamples) : 0,
        maxProgressPercent: bucket.maxProgressPercent,
        deviceReaderCount: bucket.deviceReaderCount,
        webReaderCount: bucket.webReaderCount,
        roomLifetimeSeconds: Math.max(0, Math.round((bucket.lastUpdatedAtMs - bucket.startedAtMs) / 1000)),
        entryCount: bucket.entryCount,
        exitCount: bucket.exitCount,
      } satisfies RoomAggregate;
    })
    .sort((left, right) => right.roomOnlineSecondsIntegral - left.roomOnlineSecondsIntegral);
  return limit > 0 ? values.slice(0, limit) : values;
}

export function buildDeviceAggregate(state: StoredRoomState, day: string, deviceId: string): DeviceAggregate | null {
  const bucket = state.stats?.deviceDaily[`${day}|${deviceId}`];
  if (!bucket) return null;
  return {
    day,
    deviceId,
    focusSwitchCount: bucket.focusSwitchCount,
    mediaSwitchCount: bucket.mediaSwitchCount,
    sessionCount: bucket.sessionCount,
    appFocus: toAggregateValues(bucket.appFocus),
    mediaPlayback: Object.values(bucket.mediaPlayback)
      .map((item) => ({
        providerId: item.providerId,
        trackId: item.trackId,
        title: item.title,
        totalSeconds: item.totalSeconds,
        count: item.count,
      }))
      .sort((left, right) => right.totalSeconds - left.totalSeconds),
  };
}

export function buildGlobalHistory(
  state: StoredRoomState,
  period: StatsPeriod,
  limit: number,
  anchorDay: string
): StatsSummaryHistoryPoint[] {
  const keys = selectBucketKeys(period, limit, anchorDay, state.stats?.globalDaily ?? {}, state.stats?.globalMonthly ?? {}, state.stats?.globalYearly ?? {});
  return keys.map((bucket) => ({
    bucket,
    value: buildGlobalStatsForBucket(state, period, bucket.key),
  }));
}

export function buildPageHistory(
  state: StoredRoomState,
  period: StatsPeriod,
  limit: number,
  anchorDay: string,
  itemLimit: number
): PageAggregateHistoryPoint[] {
  const keys = selectBucketKeys(period, limit, anchorDay, state.stats?.pageDaily ?? {}, state.stats?.pageMonthly ?? {}, state.stats?.pageYearly ?? {});
  return keys.map((bucket) => ({
    bucket,
    items: buildPageAggregatesForBucket(state, period, bucket.key, itemLimit),
  }));
}

export function buildRoomHistory(
  state: StoredRoomState,
  period: StatsPeriod,
  limit: number,
  anchorDay: string,
  itemLimit: number
): RoomAggregateHistoryPoint[] {
  const keys = selectBucketKeys(period, limit, anchorDay, state.stats?.roomDaily ?? {}, state.stats?.roomMonthly ?? {}, state.stats?.roomYearly ?? {});
  return keys.map((bucket) => ({
    bucket,
    items: buildRoomAggregatesForBucket(state, period, bucket.key, itemLimit),
  }));
}

export function buildDeviceHistory(
  state: StoredRoomState,
  period: StatsPeriod,
  limit: number,
  anchorDay: string,
  deviceId: string
): DeviceAggregateHistoryPoint[] {
  const keys = selectBucketKeys(period, limit, anchorDay, state.stats?.deviceDaily ?? {}, state.stats?.deviceMonthly ?? {}, state.stats?.deviceYearly ?? {}, deviceId);
  return keys.map((bucket) => ({
    bucket,
    value: buildDeviceAggregateForBucket(state, period, bucket.key, deviceId),
  }));
}

function getGlobalBucket(stats: StoredStatsState, period: "day" | "month" | "year", key: string, nowMs: number): GlobalDailyBucket {
  const target = period === "day" ? stats.globalDaily : period === "month" ? stats.globalMonthly : stats.globalYearly;
  return (target[key] ??= {
    day: key,
    startedAtMs: nowMs,
    lastUpdatedAtMs: nowMs,
    currentOnlineCount: 0,
    currentDeviceCount: 0,
    currentWebCount: 0,
    onlineIntegralMs: 0,
    onlineCountPeak: 0,
    activeDeviceCountPeak: 0,
    activeWebReaderCountPeak: 0,
    mediaActiveSecondsByProvider: {},
    devicePresenceSecondsByApp: {},
    ops: {
      dedupedEventCount: 0,
      rejectedEventCount: 0,
      expiredSessionCount: 0,
      roomRevisionBumpCount: 0,
      broadcastCount: 0,
      wsSubscriberCountPeak: 0,
      sseSubscriberCountPeak: 0,
    },
  });
}

function getPageBucket(stats: StoredStatsState, period: "day" | "month" | "year", key: string, canonicalUrl: string, title: string, nowMs: number): PageDailyBucket {
  const target = period === "day" ? stats.pageDaily : period === "month" ? stats.pageMonthly : stats.pageYearly;
  return (target[`${key}|${canonicalUrl}`] ??= {
    day: key,
    canonicalUrl,
    title,
    startedAtMs: nowMs,
    lastUpdatedAtMs: nowMs,
    currentOnlineCount: 0,
    onlineIntegralMs: 0,
    onlineCountPeak: 0,
    pageViewCount: 0,
    readerSessionCount: 0,
    progressSum: 0,
    progressSamples: 0,
    maxProgressPercent: 0,
    completionBucketCounts: {
      zeroToTwentyFive: 0,
      twentyFiveToFifty: 0,
      fiftyToSeventyFive: 0,
      seventyFiveToHundred: 0,
    },
    visibleSeconds: 0,
    hiddenSeconds: 0,
    idleSeconds: 0,
    bounceCount: 0,
    engagedReaderCount: 0,
    pageTransitionOutCount: 0,
    pageTransitionInCount: 0,
    uniqueSessionIds: {},
  });
}

function getRoomBucket(stats: StoredStatsState, period: "day" | "month" | "year", key: string, roomId: string, nowMs: number): RoomBucket {
  const target = period === "day" ? stats.roomDaily : period === "month" ? stats.roomMonthly : stats.roomYearly;
  return (target[`${key}|${roomId}`] ??= {
    day: key,
    roomId,
    startedAtMs: nowMs,
    lastUpdatedAtMs: nowMs,
    currentOnlineCount: 0,
    onlineIntegralMs: 0,
    onlineCountPeak: 0,
    progressSum: 0,
    progressSamples: 0,
    maxProgressPercent: 0,
    deviceReaderCount: 0,
    webReaderCount: 0,
    entryCount: 0,
    exitCount: 0,
    uniqueReaderSessions: {},
  });
}

function getDeviceBucket(stats: StoredStatsState, period: "day" | "month" | "year", key: string, deviceId: string): DeviceDailyBucket {
  const target = period === "day" ? stats.deviceDaily : period === "month" ? stats.deviceMonthly : stats.deviceYearly;
  return (target[`${key}|${deviceId}`] ??= {
    day: key,
    deviceId,
    focusSwitchCount: 0,
    mediaSwitchCount: 0,
    sessionCount: 0,
    appFocus: {},
    mediaPlayback: {},
  });
}

function accumulateDeviceDelta(
  deviceBucket: DeviceDailyBucket,
  globalBucket: GlobalDailyBucket,
  session: DeviceSessionState,
  nowMs: number
) {
  const deltaSeconds = Math.max(0, Math.floor((nowMs - session.lastObservedAtMs) / 1000));
  if (deltaSeconds <= 0) return;
  if (session.currentAppId) {
    incrementAggregate(deviceBucket.appFocus, session.currentAppId, session.currentAppLabel ?? session.currentAppId, deltaSeconds);
    incrementAggregate(globalBucket.devicePresenceSecondsByApp, session.currentAppId, session.currentAppLabel ?? session.currentAppId, deltaSeconds);
  }
  if (session.currentMediaProvider && session.currentMediaPlaying) {
    incrementAggregate(globalBucket.mediaActiveSecondsByProvider, session.currentMediaProvider, session.currentMediaProvider, deltaSeconds);
    const key = `${session.currentMediaProvider}|${session.currentMediaKey ?? "unknown"}`;
    incrementMediaAggregate(deviceBucket.mediaPlayback, key, session.currentMediaProvider, session.currentMediaKey, session.currentMediaTitle, deltaSeconds);
  }
}

function accumulateWebDelta(stats: StoredStatsState, session: WebSessionState, nowMs: number) {
  const deltaSeconds = Math.max(0, Math.floor((nowMs - session.lastObservedAtMs) / 1000));
  if (deltaSeconds <= 0) return;
  for (const window of rollupWindowsForMs(nowMs)) {
    const pageBucket = getPageBucket(stats, window.period, window.key, session.currentUrl, session.currentTitle, nowMs);
    if (session.lastVisibility === "visible") {
      pageBucket.visibleSeconds += deltaSeconds;
    } else {
      pageBucket.hiddenSeconds += deltaSeconds;
    }
    if (session.lastPresence === "idle") {
      pageBucket.idleSeconds += deltaSeconds;
    }
    pageBucket.lastUpdatedAtMs = nowMs;
  }
  session.lastObservedAtMs = nowMs;
}

function finalizeWebSession(stats: StoredStatsState, session: WebSessionState, nowMs: number, remove = true) {
  const durationSeconds = Math.max(0, Math.floor((nowMs - session.enteredAtMs) / 1000));
  for (const window of rollupWindowsForMs(nowMs)) {
    const pageBucket = getPageBucket(stats, window.period, window.key, session.currentUrl, session.currentTitle, nowMs);
    const roomBucket = getRoomBucket(stats, window.period, window.key, `page:${session.currentUrl}`, nowMs);
    if (session.maxProgressPercent < 25 && durationSeconds < 30) {
      pageBucket.bounceCount += 1;
    }
    if (session.maxProgressPercent >= 50 || durationSeconds >= 60) {
      pageBucket.engagedReaderCount += 1;
    }
    incrementCompletionBucket(pageBucket, session.maxProgressPercent);
    roomBucket.exitCount += 1;
  }
  if (remove) {
    delete stats.webSessions[session.sessionId];
  }
}

function incrementCompletionBucket(bucket: PageDailyBucket, progress: number) {
  if (progress < 25) bucket.completionBucketCounts.zeroToTwentyFive += 1;
  else if (progress < 50) bucket.completionBucketCounts.twentyFiveToFifty += 1;
  else if (progress < 75) bucket.completionBucketCounts.fiftyToSeventyFive += 1;
  else bucket.completionBucketCounts.seventyFiveToHundred += 1;
}

function advanceIntegral(bucket: { currentOnlineCount: number; lastUpdatedAtMs: number; onlineIntegralMs: number; onlineCountPeak: number }, nowMs: number, nextCount: number) {
  const deltaMs = Math.max(0, nowMs - bucket.lastUpdatedAtMs);
  bucket.onlineIntegralMs += bucket.currentOnlineCount * deltaMs;
  bucket.currentOnlineCount = nextCount;
  bucket.lastUpdatedAtMs = nowMs;
  bucket.onlineCountPeak = Math.max(bucket.onlineCountPeak, nextCount);
}

function incrementAggregate(target: Record<string, AggregateValueBucket>, key: string, label: string, deltaSeconds: number) {
  const bucket = (target[key] ??= { label, totalSeconds: 0, count: 0 });
  bucket.label = label;
  bucket.totalSeconds += deltaSeconds;
  bucket.count += 1;
}

function incrementMediaAggregate(target: Record<string, MediaAggregateBucket>, key: string, providerId: string, trackId: string | undefined, title: string | undefined, deltaSeconds: number) {
  const bucket = (target[key] ??= { providerId, trackId, title, totalSeconds: 0, count: 0 });
  bucket.totalSeconds += deltaSeconds;
  bucket.count += 1;
}

function toAggregateValues(source: Record<string, AggregateValueBucket>): StatsAggregateValue[] {
  return Object.entries(source)
    .map(([key, value]) => ({
      key,
      label: value.label,
      totalSeconds: value.totalSeconds,
      count: value.count,
    }))
    .sort((left, right) => right.totalSeconds - left.totalSeconds);
}

function roomIdToCanonicalUrl(roomId: string): string {
  return roomId.replace(/^page:/, "");
}

function dayKey(value: string): string {
  return value.slice(0, 10);
}

function dayKeyFromMs(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

function monthKeyFromDay(day: string): string {
  return day.slice(0, 7);
}

function yearKeyFromDay(day: string): string {
  return day.slice(0, 4);
}

function rollupWindowsForObservedAt(observedAt: string): Array<{ period: "day" | "month" | "year"; key: string }> {
  const day = dayKey(observedAt);
  return [
    { period: "day", key: day },
    { period: "month", key: monthKeyFromDay(day) },
    { period: "year", key: yearKeyFromDay(day) },
  ];
}

function rollupWindowsForMs(nowMs: number): Array<{ period: "day" | "month" | "year"; key: string }> {
  return rollupWindowsForObservedAt(new Date(nowMs).toISOString());
}

function dayStartMs(day: string) {
  return Date.parse(`${day}T00:00:00.000Z`);
}

function monthStartMs(month: string) {
  return Date.parse(`${month}-01T00:00:00.000Z`);
}

function yearStartMs(year: string) {
  return Date.parse(`${year}-01-01T00:00:00.000Z`);
}

function pruneMapByAge<T>(
  source: Record<string, T>,
  keyToMs: (key: string) => number,
  referenceMs: number,
  retentionMs: number
) {
  let changed = false;
  for (const key of Object.keys(source)) {
    if (referenceMs - keyToMs(key) > retentionMs) {
      delete source[key];
      changed = true;
    }
  }
  return changed;
}

function selectBucketKeys<T>(
  period: StatsPeriod,
  limit: number,
  anchorDay: string,
  daily: Record<string, T>,
  monthly: Record<string, T>,
  yearly: Record<string, T>,
  deviceId?: string
): StatsBucket[] {
  if (period === "week") {
    const anchorWeek = weekKeyFromDay(anchorDay);
    const weekKeys = Array.from(
      new Set(
        Object.keys(daily)
          .filter((key) => !deviceId || key.endsWith(`|${deviceId}`))
          .map((key) => key.split("|")[0] ?? key)
          .map((day) => weekKeyFromDay(day))
      )
    );
    return weekKeys
      .filter((key) => key <= anchorWeek)
      .sort((a, b) => (a < b ? 1 : -1))
      .slice(0, limit)
      .map((key) => weekBucket(key));
  }

  const anchorKey =
    period === "day" ? anchorDay :
    period === "month" ? monthKeyFromDay(anchorDay) :
    yearKeyFromDay(anchorDay);
  const source =
    period === "day"
      ? daily
      : period === "month"
        ? monthly
        : yearly;
  const keys = Array.from(
    new Set(
      Object.keys(source)
        .filter((key) => !deviceId || key.endsWith(`|${deviceId}`))
        .map((key) => key.split("|")[0] ?? key)
        .filter(Boolean)
    )
  )
    .filter((key) => key <= anchorKey)
    .sort((a, b) => (a < b ? 1 : -1))
    .slice(0, limit > 0 ? limit : undefined);

  return keys.map((key) => bucketFor(period, key));
}

function bucketFor(period: Exclude<StatsPeriod, "week">, key: string): StatsBucket {
  if (period === "day") {
    return {
      period,
      key,
      label: key,
      startDay: key,
      endDay: key,
    };
  }
  if (period === "month") {
    const endDay = endOfMonth(key);
    return {
      period,
      key,
      label: key,
      startDay: `${key}-01`,
      endDay,
    };
  }
  return {
    period,
    key,
    label: key,
    startDay: `${key}-01-01`,
    endDay: `${key}-12-31`,
  };
}

function weekKeyFromDay(day: string) {
  const date = new Date(`${day}T00:00:00.000Z`);
  const weekday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - weekday + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((date.getTime() - firstThursday.getTime()) / 86400000 - 3) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function weekBucket(key: string): StatsBucket {
  const [yearPart, weekPart] = key.split("-W");
  const year = Number(yearPart);
  const week = Number(weekPart);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Weekday = (jan4.getUTCDay() + 6) % 7;
  const start = new Date(jan4);
  start.setUTCDate(jan4.getUTCDate() - jan4Weekday + (week - 1) * 7);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  return {
    period: "week",
    key,
    label: key,
    startDay: start.toISOString().slice(0, 10),
    endDay: end.toISOString().slice(0, 10),
  };
}

function endOfMonth(month: string) {
  const [year, monthIndex] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthIndex, 0));
  return date.toISOString().slice(0, 10);
}

function buildGlobalStatsForBucket(
  state: StoredRoomState,
  period: StatsPeriod,
  key: string
): StatsSummary {
  if (period === "day") return buildGlobalStats(state, key);
  const bucket =
    period === "month"
      ? state.stats?.globalMonthly[key]
      : period === "year"
        ? state.stats?.globalYearly[key]
        : mergeGlobalWeek(state, key);
  const resolved = bucket ?? getGlobalBucket(createStatsState(), period === "week" ? "day" : period, key, Date.now());
  const elapsedMs = Math.max(1, resolved.lastUpdatedAtMs - resolved.startedAtMs);
  return {
    day: key,
    onlineCountPeak: resolved.onlineCountPeak,
    activeDeviceCountPeak: resolved.activeDeviceCountPeak,
    activeWebReaderCountPeak: resolved.activeWebReaderCountPeak,
    avgOnlineCount: round2(resolved.onlineIntegralMs / 1000 / (elapsedMs / 1000)),
    avgActiveReaderCount: round2(resolved.onlineIntegralMs / 1000 / (elapsedMs / 1000)),
    mediaActiveSecondsByProvider: toAggregateValues(resolved.mediaActiveSecondsByProvider),
    devicePresenceSecondsByApp: toAggregateValues(resolved.devicePresenceSecondsByApp),
    ops: resolved.ops,
  };
}

function buildPageAggregatesForBucket(state: StoredRoomState, period: StatsPeriod, key: string, limit: number): PageAggregate[] {
  const values =
    period === "day"
      ? Object.values(state.stats?.pageDaily ?? {}).filter((bucket) => bucket.day === key)
      : period === "month"
        ? Object.values(state.stats?.pageMonthly ?? {}).filter((bucket) => bucket.day === key)
        : period === "year"
          ? Object.values(state.stats?.pageYearly ?? {}).filter((bucket) => bucket.day === key)
          : mergePageWeek(state, key);
  return values
    .map((bucket) => {
      const elapsedMs = Math.max(1, bucket.lastUpdatedAtMs - bucket.startedAtMs);
      return {
        day: key,
        canonicalUrl: bucket.canonicalUrl,
        title: bucket.title,
        pageViewCount: bucket.pageViewCount,
        readerOnlineSeconds: Math.round(bucket.onlineIntegralMs / 1000),
        readerSessionCount: bucket.readerSessionCount,
        avgProgressPercent: bucket.progressSamples > 0 ? round2(bucket.progressSum / bucket.progressSamples) : 0,
        maxProgressPercent: bucket.maxProgressPercent,
        completionBucketCounts: bucket.completionBucketCounts,
        visibleSeconds: bucket.visibleSeconds,
        hiddenSeconds: bucket.hiddenSeconds,
        idleSeconds: bucket.idleSeconds,
        bounceCount: bucket.bounceCount,
        engagedReaderCount: bucket.engagedReaderCount,
        pageTransitionOutCount: bucket.pageTransitionOutCount,
        pageTransitionInCount: bucket.pageTransitionInCount,
        onlineCountPeak: bucket.onlineCountPeak,
        avgOnlineCount: round2(bucket.onlineIntegralMs / 1000 / (elapsedMs / 1000)),
      } satisfies PageAggregate;
    })
    .sort((left, right) => right.readerOnlineSeconds - left.readerOnlineSeconds)
    .slice(0, limit > 0 ? limit : undefined);
}

function buildRoomAggregatesForBucket(state: StoredRoomState, period: StatsPeriod, key: string, limit: number): RoomAggregate[] {
  const values =
    period === "day"
      ? Object.values(state.stats?.roomDaily ?? {}).filter((bucket) => bucket.day === key)
      : period === "month"
        ? Object.values(state.stats?.roomMonthly ?? {}).filter((bucket) => bucket.day === key)
        : period === "year"
          ? Object.values(state.stats?.roomYearly ?? {}).filter((bucket) => bucket.day === key)
          : mergeRoomWeek(state, key);
  return values
    .map((bucket) => {
      const elapsedMs = Math.max(1, bucket.lastUpdatedAtMs - bucket.startedAtMs);
      return {
        day: key,
        roomId: bucket.roomId,
        onlineCountPeak: bucket.onlineCountPeak,
        avgOnlineCount: round2(bucket.onlineIntegralMs / 1000 / (elapsedMs / 1000)),
        roomOnlineSecondsIntegral: Math.round(bucket.onlineIntegralMs / 1000),
        uniqueReaderSessions: Object.keys(bucket.uniqueReaderSessions).length,
        avgProgressPercent: bucket.progressSamples > 0 ? round2(bucket.progressSum / bucket.progressSamples) : 0,
        maxProgressPercent: bucket.maxProgressPercent,
        deviceReaderCount: bucket.deviceReaderCount,
        webReaderCount: bucket.webReaderCount,
        roomLifetimeSeconds: Math.max(0, Math.round((bucket.lastUpdatedAtMs - bucket.startedAtMs) / 1000)),
        entryCount: bucket.entryCount,
        exitCount: bucket.exitCount,
      } satisfies RoomAggregate;
    })
    .sort((left, right) => right.roomOnlineSecondsIntegral - left.roomOnlineSecondsIntegral)
    .slice(0, limit > 0 ? limit : undefined);
}

function buildDeviceAggregateForBucket(state: StoredRoomState, period: StatsPeriod, key: string, deviceId: string): DeviceAggregate | null {
  const bucket =
    period === "day"
      ? state.stats?.deviceDaily[`${key}|${deviceId}`]
      : period === "month"
        ? state.stats?.deviceMonthly[`${key}|${deviceId}`]
        : period === "year"
          ? state.stats?.deviceYearly[`${key}|${deviceId}`]
          : mergeDeviceWeek(state, key, deviceId);
  if (!bucket) return null;
  return {
    day: key,
    deviceId,
    focusSwitchCount: bucket.focusSwitchCount,
    mediaSwitchCount: bucket.mediaSwitchCount,
    sessionCount: bucket.sessionCount,
    appFocus: toAggregateValues(bucket.appFocus),
    mediaPlayback: Object.values(bucket.mediaPlayback)
      .map((item) => ({
        providerId: item.providerId,
        trackId: item.trackId,
        title: item.title,
        totalSeconds: item.totalSeconds,
        count: item.count,
      }))
      .sort((left, right) => right.totalSeconds - left.totalSeconds),
  };
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function presencePayload(state: PresenceStatePayload | null | undefined): RawJournalEntry["payload"] {
  const media = state?.mediaSessions?.[0];
  return {
    app: state?.focus.app
      ? {
          id: state.focus.app.id,
          name: state.focus.app.name,
        }
      : undefined,
    page: state?.focus.page
      ? {
          title: state.focus.page.title,
          url: state.focus.page.url,
          canonicalUrl: state.focus.page.url,
        }
      : undefined,
    media: media
      ? {
          providerId: media.provider.id,
          title: media.item.title,
          trackId: media.item.id,
          state: media.playback.state,
          progressSeconds: media.playback.progressSeconds,
          durationSeconds: media.playback.durationSeconds,
        }
      : undefined,
    presenceState: state?.availability.state,
  };
}

function mergeGlobalWeek(state: StoredRoomState, weekKey: string): GlobalDailyBucket | undefined {
  const matches = Object.values(state.stats?.globalDaily ?? {}).filter((bucket) => weekKeyFromDay(bucket.day) === weekKey);
  if (matches.length === 0) return undefined;
  return matches.reduce((acc, bucket) => mergeGlobalBuckets(acc, bucket));
}

function mergePageWeek(state: StoredRoomState, weekKey: string): PageDailyBucket[] {
  const grouped = new Map<string, PageDailyBucket>();
  for (const bucket of Object.values(state.stats?.pageDaily ?? {})) {
    if (weekKeyFromDay(bucket.day) !== weekKey) continue;
    const current = grouped.get(bucket.canonicalUrl);
    grouped.set(bucket.canonicalUrl, current ? mergePageBuckets(current, bucket) : clonePageBucket(bucket));
  }
  return [...grouped.values()];
}

function mergeRoomWeek(state: StoredRoomState, weekKey: string): RoomBucket[] {
  const grouped = new Map<string, RoomBucket>();
  for (const bucket of Object.values(state.stats?.roomDaily ?? {})) {
    if (weekKeyFromDay(bucket.day) !== weekKey) continue;
    const current = grouped.get(bucket.roomId);
    grouped.set(bucket.roomId, current ? mergeRoomBuckets(current, bucket) : cloneRoomBucket(bucket));
  }
  return [...grouped.values()];
}

function mergeDeviceWeek(state: StoredRoomState, weekKey: string, deviceId: string): DeviceDailyBucket | undefined {
  const matches = Object.values(state.stats?.deviceDaily ?? {}).filter(
    (bucket) => bucket.deviceId === deviceId && weekKeyFromDay(bucket.day) === weekKey
  );
  if (matches.length === 0) return undefined;
  return matches.reduce((acc, bucket) => mergeDeviceBuckets(acc, bucket));
}

function mergeGlobalBuckets(left: GlobalDailyBucket, right: GlobalDailyBucket): GlobalDailyBucket {
  return {
    ...left,
    startedAtMs: Math.min(left.startedAtMs, right.startedAtMs),
    lastUpdatedAtMs: Math.max(left.lastUpdatedAtMs, right.lastUpdatedAtMs),
    currentOnlineCount: right.currentOnlineCount,
    currentDeviceCount: right.currentDeviceCount,
    currentWebCount: right.currentWebCount,
    onlineIntegralMs: left.onlineIntegralMs + right.onlineIntegralMs,
    onlineCountPeak: Math.max(left.onlineCountPeak, right.onlineCountPeak),
    activeDeviceCountPeak: Math.max(left.activeDeviceCountPeak, right.activeDeviceCountPeak),
    activeWebReaderCountPeak: Math.max(left.activeWebReaderCountPeak, right.activeWebReaderCountPeak),
    mediaActiveSecondsByProvider: mergeAggregateRecords(left.mediaActiveSecondsByProvider, right.mediaActiveSecondsByProvider),
    devicePresenceSecondsByApp: mergeAggregateRecords(left.devicePresenceSecondsByApp, right.devicePresenceSecondsByApp),
    ops: {
      dedupedEventCount: left.ops.dedupedEventCount + right.ops.dedupedEventCount,
      rejectedEventCount: left.ops.rejectedEventCount + right.ops.rejectedEventCount,
      expiredSessionCount: left.ops.expiredSessionCount + right.ops.expiredSessionCount,
      roomRevisionBumpCount: left.ops.roomRevisionBumpCount + right.ops.roomRevisionBumpCount,
      broadcastCount: left.ops.broadcastCount + right.ops.broadcastCount,
      wsSubscriberCountPeak: Math.max(left.ops.wsSubscriberCountPeak, right.ops.wsSubscriberCountPeak),
      sseSubscriberCountPeak: Math.max(left.ops.sseSubscriberCountPeak, right.ops.sseSubscriberCountPeak),
    },
  };
}

function mergePageBuckets(left: PageDailyBucket, right: PageDailyBucket): PageDailyBucket {
  return {
    ...left,
    title: right.title || left.title,
    startedAtMs: Math.min(left.startedAtMs, right.startedAtMs),
    lastUpdatedAtMs: Math.max(left.lastUpdatedAtMs, right.lastUpdatedAtMs),
    currentOnlineCount: right.currentOnlineCount,
    onlineIntegralMs: left.onlineIntegralMs + right.onlineIntegralMs,
    onlineCountPeak: Math.max(left.onlineCountPeak, right.onlineCountPeak),
    pageViewCount: left.pageViewCount + right.pageViewCount,
    readerSessionCount: left.readerSessionCount + right.readerSessionCount,
    progressSum: left.progressSum + right.progressSum,
    progressSamples: left.progressSamples + right.progressSamples,
    maxProgressPercent: Math.max(left.maxProgressPercent, right.maxProgressPercent),
    completionBucketCounts: {
      zeroToTwentyFive: left.completionBucketCounts.zeroToTwentyFive + right.completionBucketCounts.zeroToTwentyFive,
      twentyFiveToFifty: left.completionBucketCounts.twentyFiveToFifty + right.completionBucketCounts.twentyFiveToFifty,
      fiftyToSeventyFive: left.completionBucketCounts.fiftyToSeventyFive + right.completionBucketCounts.fiftyToSeventyFive,
      seventyFiveToHundred: left.completionBucketCounts.seventyFiveToHundred + right.completionBucketCounts.seventyFiveToHundred,
    },
    visibleSeconds: left.visibleSeconds + right.visibleSeconds,
    hiddenSeconds: left.hiddenSeconds + right.hiddenSeconds,
    idleSeconds: left.idleSeconds + right.idleSeconds,
    bounceCount: left.bounceCount + right.bounceCount,
    engagedReaderCount: left.engagedReaderCount + right.engagedReaderCount,
    pageTransitionOutCount: left.pageTransitionOutCount + right.pageTransitionOutCount,
    pageTransitionInCount: left.pageTransitionInCount + right.pageTransitionInCount,
    uniqueSessionIds: { ...left.uniqueSessionIds, ...right.uniqueSessionIds },
  };
}

function mergeRoomBuckets(left: RoomBucket, right: RoomBucket): RoomBucket {
  return {
    ...left,
    startedAtMs: Math.min(left.startedAtMs, right.startedAtMs),
    lastUpdatedAtMs: Math.max(left.lastUpdatedAtMs, right.lastUpdatedAtMs),
    currentOnlineCount: right.currentOnlineCount,
    onlineIntegralMs: left.onlineIntegralMs + right.onlineIntegralMs,
    onlineCountPeak: Math.max(left.onlineCountPeak, right.onlineCountPeak),
    progressSum: left.progressSum + right.progressSum,
    progressSamples: left.progressSamples + right.progressSamples,
    maxProgressPercent: Math.max(left.maxProgressPercent, right.maxProgressPercent),
    deviceReaderCount: right.deviceReaderCount,
    webReaderCount: right.webReaderCount,
    entryCount: left.entryCount + right.entryCount,
    exitCount: left.exitCount + right.exitCount,
    uniqueReaderSessions: { ...left.uniqueReaderSessions, ...right.uniqueReaderSessions },
  };
}

function mergeDeviceBuckets(left: DeviceDailyBucket, right: DeviceDailyBucket): DeviceDailyBucket {
  return {
    ...left,
    focusSwitchCount: left.focusSwitchCount + right.focusSwitchCount,
    mediaSwitchCount: left.mediaSwitchCount + right.mediaSwitchCount,
    sessionCount: left.sessionCount + right.sessionCount,
    appFocus: mergeAggregateRecords(left.appFocus, right.appFocus),
    mediaPlayback: mergeMediaAggregateRecords(left.mediaPlayback, right.mediaPlayback),
  };
}

function clonePageBucket(bucket: PageDailyBucket): PageDailyBucket {
  return {
    ...bucket,
    completionBucketCounts: { ...bucket.completionBucketCounts },
    uniqueSessionIds: { ...bucket.uniqueSessionIds },
  };
}

function cloneRoomBucket(bucket: RoomBucket): RoomBucket {
  return {
    ...bucket,
    uniqueReaderSessions: { ...bucket.uniqueReaderSessions },
  };
}

function mergeAggregateRecords<T extends { label: string; totalSeconds: number; count: number }>(
  left: Record<string, T>,
  right: Record<string, T>
): Record<string, T> {
  const merged = { ...left };
  for (const [key, value] of Object.entries(right)) {
    const current = merged[key];
    merged[key] = current
      ? { ...current, label: value.label, totalSeconds: current.totalSeconds + value.totalSeconds, count: current.count + value.count }
      : { ...value };
  }
  return merged;
}

function mergeMediaAggregateRecords(
  left: Record<string, MediaAggregateBucket>,
  right: Record<string, MediaAggregateBucket>
): Record<string, MediaAggregateBucket> {
  const merged = { ...left };
  for (const [key, value] of Object.entries(right)) {
    const current = merged[key];
    merged[key] = current
      ? {
          ...current,
          totalSeconds: current.totalSeconds + value.totalSeconds,
          count: current.count + value.count,
        }
      : { ...value };
  }
  return merged;
}

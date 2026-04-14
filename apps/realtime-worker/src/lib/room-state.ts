import type {
  DeviceAggregate,
  PageAggregate,
  PresenceEvent,
  PresenceIngestRequest,
  RoomReader,
  RoomAggregate,
  RoomSnapshot,
  StatsSummary,
  WebEvent,
  WebIngestRequest
} from "@pulse/realtime-protocol";

import { canonicalizeUrl, pageRoomId } from "./url";
import {
  appendPresenceRawJournal,
  appendWebRawJournal,
  buildDeviceHistory,
  buildDeviceAggregate,
  buildGlobalHistory,
  buildGlobalStats,
  buildPageHistory,
  buildPageAggregates,
  buildRoomHistory,
  buildRoomAggregates,
  createStatsState,
  noteAggregateResult,
  normalizeStatsState,
  pruneAggregateHistory,
  pruneRawJournal,
  type StoredStatsState,
  updatePresenceAggregates,
  updateSnapshotIntegrals,
  updateWebAggregates,
} from "./stats-state";

const DEDUPE_TTL_MS = 15 * 60 * 1000;

export interface StoredRoomReader extends RoomReader {
  expiresAtMs: number;
}

export interface StoredRoomState {
  workspaceId: string;
  roomId: string;
  revision: number;
  readers: Record<string, StoredRoomReader>;
  sessionSubscribers: Record<string, true>;
  dedupe: Record<string, number>;
  pageSessionRooms: Record<string, string>;
  stats?: StoredStatsState;
  updatedAt: string;
}

export interface PresenceApplyResult {
  acceptedSeqMax: number;
  dedupedEventIds: string[];
  rejected: Array<{ eventId: string; reason: string }>;
  changed: boolean;
}

export interface WebPageTransition {
  eventId: string;
  currentRoomId?: string;
  previousRoomId?: string;
}

export interface WebApplyResult extends PresenceApplyResult {
  pageTransitions: WebPageTransition[];
}

export interface PageEventPayload {
  workspaceId: string;
  siteId: string;
  sessionId: string;
  userId?: string;
  event: WebEvent;
}

export interface PageLeavePayload {
  sessionId: string;
}

export function createRoomState(workspaceId: string, roomId: string): StoredRoomState {
  return {
    workspaceId,
    roomId,
    revision: 0,
    readers: {},
    sessionSubscribers: {},
    dedupe: {},
    pageSessionRooms: {},
    stats: createStatsState(),
    updatedAt: new Date(0).toISOString()
  };
}

export function normalizeRoomState(state: StoredRoomState): StoredRoomState {
  return {
    ...state,
    readers: state.readers ?? {},
    sessionSubscribers: state.sessionSubscribers ?? {},
    dedupe: state.dedupe ?? {},
    pageSessionRooms: state.pageSessionRooms ?? {},
    stats: normalizeStatsState(state.stats),
    updatedAt: state.updatedAt ?? new Date(0).toISOString()
  };
}

export function snapshotFromState(state: StoredRoomState): RoomSnapshot {
  const activeReaders = Object.values(state.readers)
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .map(({ expiresAtMs: _expiresAtMs, ...reader }) => reader);

  return {
    workspaceId: state.workspaceId,
    roomId: state.roomId,
    revision: state.revision,
    onlineCount: activeReaders.length,
    activeReaders,
    updatedAt: state.updatedAt
  };
}

export function pruneState(state: StoredRoomState, nowMs: number): boolean {
  let changed = false;
  const rawPruned = pruneRawJournal(state, nowMs);
  const aggregatesPruned = pruneAggregateHistory(state, nowMs);

  for (const [dedupeKey, expiresAtMs] of Object.entries(state.dedupe)) {
    if (expiresAtMs <= nowMs) {
      delete state.dedupe[dedupeKey];
    }
  }

  for (const [readerId, reader] of Object.entries(state.readers)) {
    if (reader.expiresAtMs <= nowMs) {
      delete state.readers[readerId];
      changed = true;
    }
  }

  for (const [sessionId, roomId] of Object.entries(state.pageSessionRooms)) {
    const reader = state.readers[`web:${sessionId}`];
    if (!reader || roomId !== (reader.page?.canonicalUrl ? pageRoomId(reader.page.canonicalUrl) : undefined)) {
      delete state.pageSessionRooms[sessionId];
      changed = true;
    }
  }

  if (changed || rawPruned || aggregatesPruned) {
    if (state.roomId === "global" && state.stats) {
      state.stats.globalDaily[dayKeyFromMs(nowMs)]?.ops && (state.stats.globalDaily[dayKeyFromMs(nowMs)].ops.expiredSessionCount += 1);
      updateSnapshotIntegrals(state, nowMs);
    }
    touch(state, new Date(nowMs).toISOString());
  }

  return changed || rawPruned || aggregatesPruned;
}

export function applyPresenceIngest(
  state: StoredRoomState,
  request: PresenceIngestRequest,
  ttlMs: number,
  nowMs: number
): PresenceApplyResult {
  const dedupedEventIds: string[] = [];
  const rejected: Array<{ eventId: string; reason: string }> = [];
  let acceptedSeqMax = 0;
  let changed = false;

  pruneState(state, nowMs);

  for (const event of request.events) {
    acceptedSeqMax = Math.max(acceptedSeqMax, event.seq);
    const dedupeKey = `${request.workspaceId}:${request.deviceId}:${event.eventId}`;
    if (isDuplicate(state, dedupeKey, nowMs)) {
      dedupedEventIds.push(event.eventId);
      appendPresenceRawJournal(state, request, event, "deduped");
      continue;
    }

    rememberDedupe(state, dedupeKey, nowMs);
    const mutation = applyPresenceEvent(state, request, event, ttlMs, nowMs);
    updatePresenceAggregates(state, request, event, nowMs);
    changed = changed || mutation;
    if (!mutation && event.kind === "session_end") {
      appendPresenceRawJournal(state, request, event, "accepted");
      continue;
    }
    if (!mutation && !event.state) {
      rejected.push({ eventId: event.eventId, reason: "missing_state" });
      appendPresenceRawJournal(state, request, event, "rejected", "missing_state");
      continue;
    }
    appendPresenceRawJournal(state, request, event, "accepted");
  }

  noteAggregateResult(state, "presence", { dedupedEventIds, rejected, changed }, nowMs);
  updateSnapshotIntegrals(state, nowMs);
  return { acceptedSeqMax, dedupedEventIds, rejected, changed };
}

export function applyWebIngestToGlobal(
  state: StoredRoomState,
  request: WebIngestRequest,
  ttlMs: number,
  nowMs: number
): WebApplyResult {
  const dedupedEventIds: string[] = [];
  const rejected: Array<{ eventId: string; reason: string }> = [];
  const pageTransitions: WebPageTransition[] = [];
  let acceptedSeqMax = 0;
  let changed = false;

  pruneState(state, nowMs);

  for (const event of request.events) {
    acceptedSeqMax = Math.max(acceptedSeqMax, event.seq);
    const dedupeKey = `${request.workspaceId}:${request.sessionId}:${event.eventId}`;
    if (isDuplicate(state, dedupeKey, nowMs)) {
      dedupedEventIds.push(event.eventId);
      appendWebRawJournal(state, request, event, "deduped");
      continue;
    }

    rememberDedupe(state, dedupeKey, nowMs);
    const result = applyWebGlobalEvent(state, request, event, ttlMs, nowMs);
    updateWebAggregates(state, request, event, { acceptedSeqMax, dedupedEventIds, rejected, changed: result.changed, pageTransitions: result.transition ? [result.transition] : [] }, nowMs);
    changed = changed || result.changed;
    if (result.rejectedReason) {
      rejected.push({ eventId: event.eventId, reason: result.rejectedReason });
      appendWebRawJournal(state, request, event, "rejected", result.rejectedReason);
      continue;
    }
    if (result.transition) {
      pageTransitions.push(result.transition);
    }
    appendWebRawJournal(state, request, event, "accepted");
  }

  noteAggregateResult(state, "web", { dedupedEventIds, rejected, changed }, nowMs);
  updateSnapshotIntegrals(state, nowMs);
  return { acceptedSeqMax, dedupedEventIds, rejected, changed, pageTransitions };
}

export function globalStatsForDay(state: StoredRoomState, day: string): StatsSummary {
  return buildGlobalStats(state, day);
}

export function pageStatsForDay(state: StoredRoomState, day: string, limit: number): PageAggregate[] {
  return buildPageAggregates(state, day, limit);
}

export function roomStatsForDay(state: StoredRoomState, day: string, limit: number): RoomAggregate[] {
  return buildRoomAggregates(state, day, limit);
}

export function deviceStatsForDay(state: StoredRoomState, day: string, deviceId: string): DeviceAggregate | null {
  return buildDeviceAggregate(state, day, deviceId);
}

export function globalStatsHistory(state: StoredRoomState, period: import("@pulse/realtime-protocol").StatsPeriod, limit: number, anchorDay: string) {
  return buildGlobalHistory(state, period, limit, anchorDay);
}

export function pageStatsHistory(state: StoredRoomState, period: import("@pulse/realtime-protocol").StatsPeriod, limit: number, anchorDay: string, itemLimit: number) {
  return buildPageHistory(state, period, limit, anchorDay, itemLimit);
}

export function roomStatsHistory(state: StoredRoomState, period: import("@pulse/realtime-protocol").StatsPeriod, limit: number, anchorDay: string, itemLimit: number) {
  return buildRoomHistory(state, period, limit, anchorDay, itemLimit);
}

export function deviceStatsHistory(state: StoredRoomState, period: import("@pulse/realtime-protocol").StatsPeriod, limit: number, anchorDay: string, deviceId: string) {
  return buildDeviceHistory(state, period, limit, anchorDay, deviceId);
}

export function applyWebEventToPageRoom(
  state: StoredRoomState,
  payload: PageEventPayload,
  ttlMs: number,
  nowMs: number
): boolean {
  pruneState(state, nowMs);
  const dedupeKey = `${payload.workspaceId}:${payload.sessionId}:${state.roomId}:${payload.event.eventId}`;
  if (isDuplicate(state, dedupeKey, nowMs)) {
    return false;
  }
  rememberDedupe(state, dedupeKey, nowMs);

  if (payload.event.kind === "session_end") {
    return removeReader(state, `web:${payload.sessionId}`, payload.event.observedAt);
  }

  const canonicalUrl = canonicalPageUrl(payload.event);
  const targetRoomId = pageRoomId(canonicalUrl);
  if (state.roomId !== targetRoomId) {
    return false;
  }

  const readerId = `web:${payload.sessionId}`;
  const displayName = payload.userId ? `@${payload.userId}` : `Anonymous ${payload.sessionId.slice(-4)}`;
  const nextReader: StoredRoomReader = {
    readerId,
    sessionId: payload.sessionId,
    userId: payload.userId,
    source: "web",
    displayName,
    presenceState: payload.event.presence.state,
    page: {
      title: payload.event.page.title,
      url: payload.event.page.url,
      canonicalUrl
    },
    reading: payload.event.reading
      ? {
          progressPercent: payload.event.reading.progressPercent,
          scrollY: payload.event.reading.scrollY
        }
      : undefined,
    device: {
      sessionId: payload.sessionId
    },
    app: undefined,
    media: undefined,
    updatedAt: payload.event.observedAt,
    expiresAtMs: nowMs + ttlMs
  };

  return upsertReader(state, nextReader);
}

export function applyWebLeaveToPageRoom(
  state: StoredRoomState,
  payload: PageLeavePayload,
  observedAt: string,
  nowMs: number
): boolean {
  pruneState(state, nowMs);
  return removeReader(state, `web:${payload.sessionId}`, observedAt);
}

function applyPresenceEvent(
  state: StoredRoomState,
  request: PresenceIngestRequest,
  event: PresenceEvent,
  ttlMs: number,
  nowMs: number
): boolean {
  const readerId = `device:${request.deviceId}`;

  if (event.kind === "session_end" || !event.state) {
    return removeReader(state, readerId, event.observedAt);
  }

  const firstMedia = event.state.mediaSessions[0];
  const providerExtensions =
    firstMedia &&
    firstMedia.extensions &&
    typeof firstMedia.extensions === "object" &&
    "values" in firstMedia.extensions &&
    firstMedia.extensions.values &&
    typeof firstMedia.extensions.values === "object" &&
    "provider" in firstMedia.extensions.values &&
    firstMedia.extensions.values.provider &&
    typeof firstMedia.extensions.values.provider === "object"
      ? firstMedia.extensions.values.provider as Record<string, unknown>
      : undefined;
  const pageUrl = event.state.focus.page?.url;
  const nextReader: StoredRoomReader = {
    readerId,
    sessionId: request.sessionId,
    source: "device",
    displayName: event.state.focus.app?.name || event.state.device.name || request.deviceId,
    presenceState: event.state.availability.state,
    page: event.state.focus.page
      ? {
          title: event.state.focus.page.title,
          url: pageUrl,
          canonicalUrl: pageUrl ? canonicalizeUrl(pageUrl) : undefined
        }
      : undefined,
    reading: undefined,
    device: {
      deviceId: request.deviceId,
      sessionId: request.sessionId,
      platform: event.state.device.platform,
      name: event.state.device.name
    },
    app: event.state.focus.app
      ? {
          name: event.state.focus.app.name,
          id: event.state.focus.app.id,
          category: event.state.focus.app.category
        }
      : undefined,
    media: firstMedia
      ? {
          providerId: firstMedia.provider.id,
          source: firstMedia.provider.id,
          itemType: firstMedia.item.type,
          trackId: firstMedia.item.id,
          title: firstMedia.item.title,
          artist: firstMedia.item.artist,
          album: firstMedia.item.album,
          albumArtist: stringOrUndefined(providerExtensions?.albumArtist),
          artworkUrl: firstMedia.item.artworkUrl,
          linkUrl: firstMedia.item.linkUrl,
          progressSeconds: firstMedia.playback.progressSeconds,
          durationSeconds: firstMedia.playback.durationSeconds,
          playbackState: firstMedia.playback.state,
          trackNumber: numberOrUndefined(providerExtensions?.trackNumber),
          discNumber: numberOrUndefined(providerExtensions?.discNumber),
          collectionId: stringOrUndefined(providerExtensions?.collectionId),
          collectionTitle: stringOrUndefined(providerExtensions?.collectionTitle),
          collectionLinkUrl: stringOrUndefined(providerExtensions?.collectionLinkUrl)
        }
      : undefined,
    updatedAt: event.observedAt,
    expiresAtMs: nowMs + ttlMs
  };

  return upsertReader(state, nextReader);
}

function applyWebGlobalEvent(
  state: StoredRoomState,
  request: WebIngestRequest,
  event: WebEvent,
  ttlMs: number,
  nowMs: number
): { changed: boolean; transition?: WebPageTransition; rejectedReason?: string } {
  const readerId = `web:${request.sessionId}`;
  const previousRoomId = state.pageSessionRooms[request.sessionId];

  if (event.kind === "session_end") {
    delete state.pageSessionRooms[request.sessionId];
    const changed = removeReader(state, readerId, event.observedAt);
    return {
      changed,
      transition: {
        eventId: event.eventId,
        previousRoomId
      }
    };
  }

  let canonicalUrl: string;
  try {
    canonicalUrl = canonicalPageUrl(event);
  } catch {
    return { changed: false, rejectedReason: "invalid_page_url" };
  }

  const currentRoomId = pageRoomId(canonicalUrl);
  state.pageSessionRooms[request.sessionId] = currentRoomId;

  const displayName = request.userId ? `@${request.userId}` : `Anonymous ${request.sessionId.slice(-4)}`;
  const nextReader: StoredRoomReader = {
    readerId,
    sessionId: request.sessionId,
    userId: request.userId,
    source: "web",
    displayName,
    presenceState: event.presence.state,
    page: {
      title: event.page.title,
      url: event.page.url,
      canonicalUrl
    },
    reading: event.reading
      ? {
          progressPercent: event.reading.progressPercent,
          scrollY: event.reading.scrollY
        }
      : undefined,
    device: {
      sessionId: request.sessionId
    },
    app: undefined,
    media: undefined,
    updatedAt: event.observedAt,
    expiresAtMs: nowMs + ttlMs
  };

  const changed = upsertReader(state, nextReader);
  return {
    changed,
    transition: {
      eventId: event.eventId,
      currentRoomId,
      previousRoomId
    }
  };
}

function canonicalPageUrl(event: WebEvent): string {
  return canonicalizeUrl(event.page.url, event.page.canonicalUrl);
}

function isDuplicate(state: StoredRoomState, key: string, nowMs: number): boolean {
  const expiresAt = state.dedupe[key];
  return expiresAt !== undefined && expiresAt > nowMs;
}

function rememberDedupe(state: StoredRoomState, key: string, nowMs: number): void {
  state.dedupe[key] = nowMs + DEDUPE_TTL_MS;
}

function upsertReader(state: StoredRoomState, reader: StoredRoomReader): boolean {
  const previous = state.readers[reader.readerId];
  const identical = previous && readerStateEquals(previous, reader);
  if (identical) return false;
  state.readers[reader.readerId] = reader;
  touch(state, reader.updatedAt);
  return true;
}

function removeReader(state: StoredRoomState, readerId: string, observedAt: string): boolean {
  if (!state.readers[readerId]) return false;
  delete state.readers[readerId];
  touch(state, observedAt);
  return true;
}

function touch(state: StoredRoomState, updatedAt: string): void {
  state.revision += 1;
  state.updatedAt = updatedAt;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function readerStateEquals(left: StoredRoomReader, right: StoredRoomReader): boolean {
  return JSON.stringify({
    ...left,
    expiresAtMs: undefined
  }) === JSON.stringify({
    ...right,
    expiresAtMs: undefined
  });
}

function dayKeyFromMs(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

import { eq } from "drizzle-orm";
import type {
  ContentHistoryPoint,
  ContentLifetime,
  GlobalRoomSnapshot,
  OwnerHistoryPoint,
  OwnerLifetime,
  RealtimeChatJoin,
  RealtimeChatLeave,
  RealtimeChatSend,
  RealtimeClientMessage,
  RealtimePresenceContext,
  SiteHistoryPoint,
  SiteLifetime,
  StatsPeriod,
  WebEvent,
  WebIngestRequest,
} from "@pulse/realtime-protocol";
import { WebIngestAckSchema } from "@pulse/realtime-protocol";
import * as schema from "./db/schema";
import { BaseRoom, type WebIngestEvent } from "./base-room";
import type {
  RoomSessionConnectionRecord,
  RoomSessionConnectionState,
} from "./session-do";
import type { ActiveReaderState, DevicePresenceState } from "./runtime-models";
import { isDeviceActiveNow, isReaderActiveNow, resolveDeviceAppKey } from "./runtime-models";
import {
  buildActivePages,
  buildOwnerCurrent,
  dedupeReadersBySession,
  mapReaderToSessionPreview,
  SESSION_PREVIEW_LIMIT,
} from "./room-view-helpers";
import {
  buildContentHistory,
  buildContentLifetime,
  buildOwnerHistory,
  buildOwnerLifetime,
  buildSiteHistory,
  buildSiteLifetime,
} from "./stats-query";
import { coerceNonNegativeInt, dayKeyFromIso, splitDurationAcrossDays } from "./stats-utils";

interface PendingSiteMetrics {
  day: string;
  startedAtMs: number;
  lastUpdatedAtMs: number;
  pageViewCount: number;
  uniqueVisitorCount: number;
  readTimeMs: number;
}

interface PendingContentMetrics {
  id: string;
  day: string;
  canonicalUrl: string;
  title: string;
  startedAtMs: number;
  lastUpdatedAtMs: number;
  pageViewCount: number;
  uniqueVisitorCount: number;
  readTimeMs: number;
}

interface PendingOwnerPresence {
  id: string;
  day: string;
  appKey: string;
  label: string;
  totalMs: number;
  sampleCount: number;
}

interface GlobalStatusConnectionState extends RoomSessionConnectionState {
  presenceContext?: {
    sessionId: string;
    tabId: string;
    userId?: string;
    page: {
      title: string;
      url: string;
      canonicalUrl?: string;
    };
  };
}

export class GlobalStatusRoom extends BaseRoom<GlobalStatusConnectionState> {
  private readersMemory: Map<string, ActiveReaderState> = new Map();
  private deviceStates = new Map<string, DevicePresenceState>();
  private pendingSiteMetrics = new Map<string, PendingSiteMetrics>();
  private pendingContentMetrics = new Map<string, PendingContentMetrics>();
  private pendingOwnerPresence = new Map<string, PendingOwnerPresence>();

  protected supportsRoomId(roomId: string): boolean {
    return roomId === "global";
  }

  protected async restoreRoomState(nowMs: number): Promise<void> {
    const storedReaders =
      (await this.ctx.storage.get<ActiveReaderState[]>("volatileReaders")) ?? [];
    this.readersMemory = new Map(
      storedReaders
        .filter((reader) => reader.expiresAtMs > nowMs)
        .map((reader) => [reader.readerId, reader]),
    );

    const storedDeviceStates =
      (await this.ctx.storage.get<Array<[string, DevicePresenceState]>>(
        "volatileDeviceStates",
      )) ?? [];
    this.deviceStates = new Map(
      storedDeviceStates.filter(([, state]) => (state.expiresAtMs ?? 0) > nowMs),
    );
  }

  protected async persistRoomState(): Promise<void> {
    if (this.readersMemory.size > 0) {
      await this.ctx.storage.put("volatileReaders", Array.from(this.readersMemory.values()));
    } else {
      await this.ctx.storage.delete("volatileReaders");
    }

    if (this.deviceStates.size > 0) {
      await this.ctx.storage.put(
        "volatileDeviceStates",
        Array.from(this.deviceStates.entries()),
      );
    } else {
      await this.ctx.storage.delete("volatileDeviceStates");
    }
  }

  protected nextScheduledTick(nowMs: number) {
    let next = Infinity;
    for (const reader of this.readersMemory.values()) {
      if (reader.expiresAtMs < next) next = reader.expiresAtMs;
    }
    for (const state of this.deviceStates.values()) {
      if (state.expiresAtMs != null && state.expiresAtMs < next) {
        next = state.expiresAtMs;
      }
    }
    if (this.shouldKeepFlushTickActive(nowMs)) {
      next = Math.min(next, nowMs + this.flushIntervalMs);
    }
    return next;
  }

  protected async handlePresenceContextMessage(
    record: RoomSessionConnectionRecord<GlobalStatusConnectionState>,
    message: RealtimePresenceContext,
  ): Promise<void> {
    this.updateConnection(record, {
      ...record.state,
      presenceContext: {
        sessionId: message.sessionId,
        tabId: message.tabId,
        userId: message.userId,
        page: message.page,
      },
    });
  }

  protected async handleRoomMessage(
    record: RoomSessionConnectionRecord<GlobalStatusConnectionState>,
    message: Exclude<RealtimeClientMessage, { type: "hello" }>,
  ): Promise<void> {
    if (message.type === "presence_context") {
      return this.handlePresenceContextMessage(record, message);
    }
    return this.sendUnsupportedRealtimeMessage(record, message);
  }

  protected async cleanupRoomConnection(
    record: RoomSessionConnectionRecord<GlobalStatusConnectionState>,
  ): Promise<void> {
    if (!record.state.presenceContext) return;
    await this.removeWebReader(
      record.state.presenceContext.sessionId,
      record.state.presenceContext.tabId,
    );
  }

  protected async handleRoomAlarm(nowMs: number): Promise<boolean> {
    await this.flushAggregates(nowMs);
    let changed = false;

    for (const [key, reader] of this.readersMemory.entries()) {
      if (reader.expiresAtMs <= nowMs) {
        this.captureReaderDuration(reader, nowMs);
        this.readersMemory.delete(key);
        changed = true;
      }
    }

    for (const [key, state] of this.deviceStates.entries()) {
      if (state.expiresAtMs != null && state.expiresAtMs <= nowMs) {
        this.captureDeviceDuration(state, nowMs);
        this.deviceStates.delete(key);
        changed = true;
      }
    }

    return changed;
  }

  async handleWebIngest(request: WebIngestRequest, roomId: string, ttlMs: number) {
    await this.initMetadata(request.workspaceId, roomId);
    let changed = false;

    for (const event of request.events) {
      const eventMs = Date.parse(event.observedAt) || Date.now();
      const readerId = `web:${request.sessionId}:${request.tabId}`;
      const previousReader = this.readersMemory.get(readerId) ?? null;
      if (previousReader) {
        this.captureReaderDuration(previousReader, eventMs);
      }
      await this.recordWebEventMetrics(request.sessionId, event, eventMs);
      const ingestEvent: WebIngestEvent = {
        ...event,
        sessionId: request.sessionId,
        tabId: request.tabId,
        userId: request.userId,
      };

      if (event.kind === "session_end") {
        if (this.handleRoomSessionEnd(readerId)) changed = true;
        continue;
      }

      if (this.handleWebEventInRoom(ingestEvent, readerId, eventMs, ttlMs)) {
        changed = true;
      }
      const nextReader = this.readersMemory.get(readerId);
      if (nextReader) {
        nextReader.lastCountedAtMs = eventMs;
      }
    }

    await this.persistRoomState();
    await this.scheduleNextAlarm();

    if (changed) {
      await this.broadcastCurrentSnapshot();
    }

    return WebIngestAckSchema.parse({
      workspaceId: request.workspaceId,
      siteId: request.siteId,
      sessionId: request.sessionId,
      acceptedSeqMax: request.events[request.events.length - 1]?.seq ?? 0,
      dedupedEventIds: [],
      rejected: [],
      workspaceRevision: Date.now(),
    });
  }

  protected handleWebEventInRoom(
    event: WebIngestEvent,
    readerId: string,
    eventMs: number,
    ttlMs: number,
  ): boolean {
    this.readersMemory.set(readerId, {
      readerId,
      sessionId: event.sessionId,
      tabId: event.tabId,
      workspaceId: this.workspaceId,
      roomId: this.roomId,
      userId: event.userId ?? null,
      source: "web",
      displayName: event.userId ?? `Anonymous ${event.sessionId.slice(-4)}`,
      presenceState: event.presence.state,
      pageTitle: event.page.title,
      pageUrl: event.page.url,
      pageCanonicalUrl: event.page.canonicalUrl ?? event.page.url,
      readingProgressPercent: event.reading?.progressPercent ?? null,
      readingScrollY: event.reading?.scrollY ?? null,
      updatedAt: event.observedAt,
      expiresAtMs: eventMs + ttlMs,
      lastCountedAtMs: eventMs,
    });
    return true;
  }

  protected handleRoomSessionEnd(readerId: string): boolean {
    return this.readersMemory.delete(readerId);
  }

  async pushDeviceUpdate(
    workspaceId: string,
    roomId: string,
    deviceId: string,
    state: DevicePresenceState | null,
  ) {
    await this.initMetadata(workspaceId, roomId);
    const eventMs = Date.now();
    const previousState = this.deviceStates.get(deviceId) ?? null;
    if (previousState) {
      this.captureDeviceDuration(previousState, eventMs);
    }

    if (state) {
      const incoming = {
        ...state,
        lastCountedAtMs: eventMs,
      };
      const existing = this.deviceStates.get(deviceId);
      if (existing && existing.updatedAt && incoming.updatedAt) {
        if (
          new Date(incoming.updatedAt).getTime() <
          new Date(existing.updatedAt).getTime()
        ) {
          return;
        }
      }
      this.deviceStates.set(deviceId, incoming);
    } else {
      this.deviceStates.delete(deviceId);
    }

    await this.persistRoomState();
    await this.scheduleNextAlarm();
    await this.broadcastCurrentSnapshot();
  }

  async getSiteHistory(
    period: StatsPeriod,
    limit: number,
    anchorDay: string,
  ): Promise<SiteHistoryPoint[]> {
    await this.flushAggregates();
    const rows = this.db.select().from(schema.globalDailyStats).all();
    return buildSiteHistory(rows, period, limit, anchorDay);
  }

  async getSiteLifetime(): Promise<SiteLifetime> {
    await this.flushAggregates();
    const rows = this.db.select().from(schema.globalDailyStats).all();
    return buildSiteLifetime(rows);
  }

  async getContentHistory(
    canonicalUrl: string,
    period: StatsPeriod,
    limit: number,
    anchorDay: string,
  ): Promise<ContentHistoryPoint[]> {
    await this.flushAggregates();
    const rows = this.db.select().from(schema.pageDailyStats).all();
    return buildContentHistory(canonicalUrl, rows, period, limit, anchorDay);
  }

  async getContentLifetime(canonicalUrl: string): Promise<ContentLifetime | null> {
    await this.flushAggregates();
    const rows = this.db.select().from(schema.pageDailyStats).all();
    return buildContentLifetime(canonicalUrl, rows);
  }

  async getOwnerHistory(
    period: StatsPeriod,
    limit: number,
    anchorDay: string,
  ): Promise<OwnerHistoryPoint[]> {
    await this.flushAggregates();
    const rows = this.db.select().from(schema.globalAppDailyStats).all();
    return buildOwnerHistory(rows, period, limit, anchorDay);
  }

  async getOwnerLifetime(): Promise<OwnerLifetime> {
    await this.flushAggregates();
    const rows = this.db.select().from(schema.globalAppDailyStats).all();
    return buildOwnerLifetime(rows);
  }

  protected async recordWebEventMetrics(
    sessionId: string,
    event: WebEvent,
    nowMs: number,
  ) {
    if (event.kind !== "page_view") return;
    const day = dayKeyFromIso(event.observedAt);
    const canonicalUrl = event.page.canonicalUrl ?? event.page.url;
    const contentUniqueVisitorDelta = await this.markSeen(
      `content-uv:${day}:${canonicalUrl}`,
      sessionId,
    );
    const siteUniqueVisitorDelta = await this.markSeen(`site-uv:${day}`, sessionId);

    this.bumpContentMetrics(day, canonicalUrl, event.page.title ?? canonicalUrl, nowMs, {
      pageViewCount: 1,
      uniqueVisitorCount: contentUniqueVisitorDelta,
      readTimeMs: 0,
    });
    this.bumpSiteMetrics(day, nowMs, {
      pageViewCount: 1,
      uniqueVisitorCount: siteUniqueVisitorDelta,
      readTimeMs: 0,
    });
  }

  protected captureReaderDuration(reader: ActiveReaderState, nowMs: number): void {
    const effectiveEndMs = Math.min(nowMs, reader.expiresAtMs);
    const startMs = Math.max(
      0,
      reader.lastCountedAtMs || Date.parse(reader.updatedAt) || effectiveEndMs,
    );
    if (effectiveEndMs <= startMs) return;
    if (!isReaderActiveNow(reader, effectiveEndMs - 1)) {
      reader.lastCountedAtMs = effectiveEndMs;
      return;
    }

    const canonicalUrl = reader.pageCanonicalUrl ?? reader.pageUrl;
    const title = reader.pageTitle ?? canonicalUrl;
    if (!canonicalUrl || !title) {
      reader.lastCountedAtMs = effectiveEndMs;
      return;
    }

    splitDurationAcrossDays(startMs, effectiveEndMs, (day, durationMs) => {
      this.bumpContentMetrics(day, canonicalUrl, title, effectiveEndMs, {
        pageViewCount: 0,
        uniqueVisitorCount: 0,
        readTimeMs: durationMs,
      });
      this.bumpSiteMetrics(day, effectiveEndMs, {
        pageViewCount: 0,
        uniqueVisitorCount: 0,
        readTimeMs: durationMs,
      });
    });
    reader.lastCountedAtMs = effectiveEndMs;
  }

  protected captureDeviceDuration(state: DevicePresenceState, nowMs: number): void {
    const effectiveEndMs = Math.min(nowMs, state.expiresAtMs ?? nowMs);
    const startMs = Math.max(
      0,
      state.lastCountedAtMs || Date.parse(state.updatedAt ?? "") || effectiveEndMs,
    );
    if (effectiveEndMs <= startMs) return;
    if (!isDeviceActiveNow(state, effectiveEndMs - 1)) {
      state.lastCountedAtMs = effectiveEndMs;
      return;
    }
    const app = resolveDeviceAppKey(state);
    if (!app) {
      state.lastCountedAtMs = effectiveEndMs;
      return;
    }

    splitDurationAcrossDays(startMs, effectiveEndMs, (day, durationMs) => {
      this.bumpOwnerPresence(day, app.key, app.label, durationMs);
    });
    state.lastCountedAtMs = effectiveEndMs;
  }

  protected buildRoomSnapshot(): GlobalRoomSnapshot {
    const nowMs = Date.now();
    const rawWebReaders = Array.from(this.readersMemory.values()).filter((reader) =>
      isReaderActiveNow(reader, nowMs),
    );
    const webReaders = dedupeReadersBySession(rawWebReaders).sort(
      (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
    );

    const activeDevices = Array.from(this.deviceStates.entries())
      .filter(([, raw]) => isDeviceActiveNow(raw, nowMs))
      .sort(([, left], [, right]) =>
        Date.parse(right.updatedAt ?? "") - Date.parse(left.updatedAt ?? ""),
      );
    const activePages = buildActivePages(rawWebReaders);
    const ownerCurrent = activeDevices[0]
      ? buildOwnerCurrent(activeDevices[0][0], activeDevices[0][1])
      : null;

    return {
      roomKind: "global",
      workspaceId: this.workspaceId,
      roomId: this.roomId,
      revision: Date.now(),
      sessionCount: webReaders.length,
      sessions: webReaders
        .slice(0, SESSION_PREVIEW_LIMIT)
        .map(mapReaderToSessionPreview),
      activePageCount: activePages.length,
      activePages,
      ownerCurrent,
      updatedAt: new Date().toISOString(),
    };
  }

  protected async removeWebReader(sessionId: string, tabId: string) {
    const readerId = `web:${sessionId}:${tabId}`;
    const existing = this.readersMemory.get(readerId);
    if (!existing) return;

    this.captureReaderDuration(existing, Date.now());
    this.readersMemory.delete(readerId);
    await this.persistRoomState();
    await this.scheduleNextAlarm();
    await this.broadcastCurrentSnapshot();
  }

  private async flushAggregates(nowMs = Date.now()) {
    for (const reader of this.readersMemory.values()) {
      this.captureReaderDuration(reader, nowMs);
    }
    for (const state of this.deviceStates.values()) {
      this.captureDeviceDuration(state, nowMs);
    }

    if (
      this.pendingSiteMetrics.size === 0 &&
      this.pendingContentMetrics.size === 0 &&
      this.pendingOwnerPresence.size === 0
    ) {
      return;
    }

    for (const delta of this.pendingSiteMetrics.values()) {
      const existing =
        this.db
          .select()
          .from(schema.globalDailyStats)
          .where(eq(schema.globalDailyStats.day, delta.day))
          .all()[0] ?? null;
      this.db
        .insert(schema.globalDailyStats)
        .values({
          day: delta.day,
          startedAtMs: existing?.startedAtMs ?? delta.startedAtMs,
          lastUpdatedAtMs: Math.max(existing?.lastUpdatedAtMs ?? 0, delta.lastUpdatedAtMs),
          pageViewCount: coerceNonNegativeInt(existing?.pageViewCount) + delta.pageViewCount,
          uniqueVisitorCount:
            coerceNonNegativeInt(existing?.uniqueVisitorCount) + delta.uniqueVisitorCount,
          onlineIntegralMs: coerceNonNegativeInt(existing?.onlineIntegralMs) + delta.readTimeMs,
          onlineCountPeak: coerceNonNegativeInt(existing?.onlineCountPeak),
          activeDeviceCountPeak: coerceNonNegativeInt(existing?.activeDeviceCountPeak),
          activeWebReaderCountPeak: coerceNonNegativeInt(existing?.activeWebReaderCountPeak),
          dedupedEventCount: coerceNonNegativeInt(existing?.dedupedEventCount),
          rejectedEventCount: coerceNonNegativeInt(existing?.rejectedEventCount),
          broadcastCount: coerceNonNegativeInt(existing?.broadcastCount),
        })
        .onConflictDoUpdate({
          target: schema.globalDailyStats.day,
          set: {
            lastUpdatedAtMs: Math.max(
              existing?.lastUpdatedAtMs ?? 0,
              delta.lastUpdatedAtMs,
            ),
            pageViewCount:
              coerceNonNegativeInt(existing?.pageViewCount) + delta.pageViewCount,
            uniqueVisitorCount:
              coerceNonNegativeInt(existing?.uniqueVisitorCount) + delta.uniqueVisitorCount,
            onlineIntegralMs:
              coerceNonNegativeInt(existing?.onlineIntegralMs) + delta.readTimeMs,
          },
        })
        .run();
    }

    for (const delta of this.pendingContentMetrics.values()) {
      const existing =
        this.db
          .select()
          .from(schema.pageDailyStats)
          .where(eq(schema.pageDailyStats.id, delta.id))
          .all()[0] ?? null;
      this.db
        .insert(schema.pageDailyStats)
        .values({
          id: delta.id,
          day: delta.day,
          canonicalUrl: delta.canonicalUrl,
          title: delta.title,
          startedAtMs: existing?.startedAtMs ?? delta.startedAtMs,
          lastUpdatedAtMs: Math.max(existing?.lastUpdatedAtMs ?? 0, delta.lastUpdatedAtMs),
          pageViewCount: coerceNonNegativeInt(existing?.pageViewCount) + delta.pageViewCount,
          uniqueVisitorCount:
            coerceNonNegativeInt(existing?.uniqueVisitorCount) + delta.uniqueVisitorCount,
          readTimeMs: coerceNonNegativeInt(existing?.readTimeMs) + delta.readTimeMs,
          readerSessionCount: coerceNonNegativeInt(existing?.readerSessionCount),
          progressSum: existing?.progressSum ?? 0,
          progressSamples: coerceNonNegativeInt(existing?.progressSamples),
          maxProgressPercent: existing?.maxProgressPercent ?? 0,
          bounceCount: coerceNonNegativeInt(existing?.bounceCount),
          engagedReaderCount: coerceNonNegativeInt(existing?.engagedReaderCount),
        })
        .onConflictDoUpdate({
          target: schema.pageDailyStats.id,
          set: {
            title: delta.title,
            lastUpdatedAtMs: Math.max(
              existing?.lastUpdatedAtMs ?? 0,
              delta.lastUpdatedAtMs,
            ),
            pageViewCount:
              coerceNonNegativeInt(existing?.pageViewCount) + delta.pageViewCount,
            uniqueVisitorCount:
              coerceNonNegativeInt(existing?.uniqueVisitorCount) + delta.uniqueVisitorCount,
            readTimeMs: coerceNonNegativeInt(existing?.readTimeMs) + delta.readTimeMs,
          },
        })
        .run();
    }

    for (const delta of this.pendingOwnerPresence.values()) {
      const existing =
        this.db
          .select()
          .from(schema.globalAppDailyStats)
          .where(eq(schema.globalAppDailyStats.id, delta.id))
          .all()[0] ?? null;
      this.db
        .insert(schema.globalAppDailyStats)
        .values({
          id: delta.id,
          day: delta.day,
          appKey: delta.appKey,
          label: delta.label,
          totalMs: coerceNonNegativeInt(existing?.totalMs) + delta.totalMs,
          sampleCount: coerceNonNegativeInt(existing?.sampleCount) + delta.sampleCount,
        })
        .onConflictDoUpdate({
          target: schema.globalAppDailyStats.id,
          set: {
            label: delta.label,
            totalMs: coerceNonNegativeInt(existing?.totalMs) + delta.totalMs,
            sampleCount:
              coerceNonNegativeInt(existing?.sampleCount) + delta.sampleCount,
          },
        })
        .run();
    }

    this.pendingSiteMetrics.clear();
    this.pendingContentMetrics.clear();
    this.pendingOwnerPresence.clear();
  }

  private async markSeen(storageKey: string, sessionId: string) {
    if (!sessionId) return 0;
    const seen = (await this.ctx.storage.get<string[]>(storageKey)) ?? [];
    if (seen.includes(sessionId)) return 0;
    seen.push(sessionId);
    await this.ctx.storage.put(storageKey, seen);
    return 1;
  }

  private shouldKeepFlushTickActive(nowMs: number) {
    if (
      Array.from(this.readersMemory.values()).some((reader) =>
        isReaderActiveNow(reader, nowMs),
      )
    ) {
      return true;
    }
    if (
      Array.from(this.deviceStates.values()).some((state) =>
        isDeviceActiveNow(state, nowMs),
      )
    ) {
      return true;
    }
    return (
      this.pendingSiteMetrics.size > 0 ||
      this.pendingContentMetrics.size > 0 ||
      this.pendingOwnerPresence.size > 0
    );
  }

  private bumpSiteMetrics(
    day: string,
    nowMs: number,
    delta: { pageViewCount: number; uniqueVisitorCount: number; readTimeMs: number },
  ) {
    const existing = this.pendingSiteMetrics.get(day) ?? {
      day,
      startedAtMs: nowMs,
      lastUpdatedAtMs: nowMs,
      pageViewCount: 0,
      uniqueVisitorCount: 0,
      readTimeMs: 0,
    };
    existing.lastUpdatedAtMs = Math.max(existing.lastUpdatedAtMs, nowMs);
    existing.pageViewCount += delta.pageViewCount;
    existing.uniqueVisitorCount += delta.uniqueVisitorCount;
    existing.readTimeMs += delta.readTimeMs;
    this.pendingSiteMetrics.set(day, existing);
  }

  private bumpContentMetrics(
    day: string,
    canonicalUrl: string,
    title: string,
    nowMs: number,
    delta: { pageViewCount: number; uniqueVisitorCount: number; readTimeMs: number },
  ) {
    const id = `${day}|${canonicalUrl}`;
    const existing = this.pendingContentMetrics.get(id) ?? {
      id,
      day,
      canonicalUrl,
      title,
      startedAtMs: nowMs,
      lastUpdatedAtMs: nowMs,
      pageViewCount: 0,
      uniqueVisitorCount: 0,
      readTimeMs: 0,
    };
    existing.title = title;
    existing.lastUpdatedAtMs = Math.max(existing.lastUpdatedAtMs, nowMs);
    existing.pageViewCount += delta.pageViewCount;
    existing.uniqueVisitorCount += delta.uniqueVisitorCount;
    existing.readTimeMs += delta.readTimeMs;
    this.pendingContentMetrics.set(id, existing);
  }

  private bumpOwnerPresence(
    day: string,
    appKey: string,
    label: string,
    durationMs: number,
  ) {
    const id = `${day}|${appKey}`;
    const existing = this.pendingOwnerPresence.get(id) ?? {
      id,
      day,
      appKey,
      label,
      totalMs: 0,
      sampleCount: 0,
    };
    existing.label = label;
    existing.totalMs += durationMs;
    existing.sampleCount += 1;
    this.pendingOwnerPresence.set(id, existing);
  }

  private sendUnsupportedRealtimeMessage(
    record: RoomSessionConnectionRecord<GlobalStatusConnectionState>,
    _message: RealtimeChatJoin | RealtimeChatLeave | RealtimeChatSend,
  ) {
    this.sendError(
      record.socket,
      record.state.roomId,
      "unsupported_message",
      "This room only supports presence_context.",
    );
  }

  protected async createConnectionState(
    request: Request,
    connectionId: string,
  ): Promise<GlobalStatusConnectionState> {
    return this.serializeConnectionState({
      ...(await this.createBaseConnectionState(request, connectionId)),
      presenceContext: undefined,
    });
  }

  protected serializeConnectionState(
    state: GlobalStatusConnectionState,
  ): GlobalStatusConnectionState {
    return {
      ...this.serializeBaseConnectionState(state),
      presenceContext: state.presenceContext
        ? {
            sessionId: state.presenceContext.sessionId,
            tabId: state.presenceContext.tabId,
            userId: state.presenceContext.userId,
            page: {
              title: state.presenceContext.page.title,
              url: state.presenceContext.page.url,
              canonicalUrl: state.presenceContext.page.canonicalUrl,
            },
          }
        : undefined,
    };
  }
}

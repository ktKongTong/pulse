import type {
  PageRoomSnapshot,
  RealtimeChatJoin,
  RealtimeChatLeave,
  RealtimeChatSend,
  RealtimeClientMessage,
  RealtimePresenceContext,
  WebIngestRequest,
} from "@pulse/realtime-protocol";
import { WebIngestAckSchema } from "@pulse/realtime-protocol";
import { BaseRoom, type WebIngestEvent } from "./base-room";
import type {
  RoomSessionConnectionRecord,
  RoomSessionConnectionState,
} from "../session";
import { dedupeReadersBySession, mapReaderToPageSessionPreview, SESSION_PREVIEW_LIMIT } from "../../runtime/room-view-helpers";
import type { ActiveReaderState } from "../../runtime/models";

interface PageStatusConnectionState extends RoomSessionConnectionState {
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

export class PageStatusRoom extends BaseRoom<PageStatusConnectionState> {
  private readersMemory: Map<string, ActiveReaderState> = new Map();

  protected supportsRoomId(roomId: string): boolean {
    return roomId.startsWith("page:");
  }

  protected async restoreRoomState(nowMs: number): Promise<void> {
    const storedReaders =
      (await this.ctx.storage.get<ActiveReaderState[]>("volatileReaders")) ?? [];
    this.readersMemory = new Map(
      storedReaders
        .filter((reader) => reader.expiresAtMs > nowMs)
        .map((reader) => [reader.readerId, reader]),
    );
  }

  protected async persistRoomState(): Promise<void> {
    if (this.readersMemory.size > 0) {
      await this.ctx.storage.put("volatileReaders", Array.from(this.readersMemory.values()));
    } else {
      await this.ctx.storage.delete("volatileReaders");
    }
  }

  protected nextScheduledTick(_nowMs: number) {
    let earliest = Infinity;
    for (const reader of this.readersMemory.values()) {
      if (reader.expiresAtMs < earliest) earliest = reader.expiresAtMs;
    }
    return earliest;
  }

  protected async handlePresenceContextMessage(
    record: RoomSessionConnectionRecord<PageStatusConnectionState>,
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
    record: RoomSessionConnectionRecord<PageStatusConnectionState>,
    message: Exclude<RealtimeClientMessage, { type: "hello" }>,
  ): Promise<void> {
    if (message.type === "presence_context") {
      return this.handlePresenceContextMessage(record, message);
    }
    return this.sendUnsupportedRealtimeMessage(record, message);
  }

  protected async cleanupRoomConnection(
    record: RoomSessionConnectionRecord<PageStatusConnectionState>,
  ): Promise<void> {
    if (!record.state.presenceContext) return;
    await this.removeWebReader(
      record.state.presenceContext.sessionId,
      record.state.presenceContext.tabId,
    );
  }

  protected async handleRoomAlarm(nowMs: number): Promise<boolean> {
    let changed = false;
    for (const [key, reader] of this.readersMemory.entries()) {
      if (reader.expiresAtMs <= nowMs) {
        this.captureReaderDuration(reader, nowMs);
        this.readersMemory.delete(key);
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

  protected captureReaderDuration(_reader: ActiveReaderState, _nowMs: number): void {}

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

  protected buildRoomSnapshot(): PageRoomSnapshot {
    const nowMs = Date.now();
    const currentReaders = Array.from(this.readersMemory.values()).filter(
      (reader) => reader.expiresAtMs > nowMs && reader.presenceState === "active",
    );
    const dedupedReaders = dedupeReadersBySession(currentReaders).sort(
      (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
    );

    return {
      roomKind: "page",
      workspaceId: this.workspaceId,
      roomId: this.roomId,
      revision: Date.now(),
      sessionCount: dedupedReaders.length,
      sessions: dedupedReaders
        .slice(0, SESSION_PREVIEW_LIMIT)
        .map(mapReaderToPageSessionPreview),
      updatedAt: new Date().toISOString(),
    };
  }

  private sendUnsupportedRealtimeMessage(
    record: RoomSessionConnectionRecord<PageStatusConnectionState>,
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
  ): Promise<PageStatusConnectionState> {
    return this.serializeConnectionState({
      ...(await this.createBaseConnectionState(request, connectionId)),
      presenceContext: undefined,
    });
  }

  protected serializeConnectionState(
    state: PageStatusConnectionState,
  ): PageStatusConnectionState {
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

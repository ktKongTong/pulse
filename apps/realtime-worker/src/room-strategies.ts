import type {
  ChatRoomSnapshot,
  GlobalRoomSnapshot,
  PageRoomSnapshot,
  RoomReader,
} from '@pulse/realtime-protocol';
import type {
  ActiveReaderState,
  ChatMessageState,
  ChatParticipantState,
  DevicePresenceState,
} from './runtime-models';
import { isDeviceActiveNow, isReaderActiveNow } from './runtime-models';

// ==========================================
// Strategy Interface
// ==========================================

export interface RoomStrategy {
  /** Room type identifier */
  readonly type: 'global' | 'page' | 'chat';

  /**
   * Build a snapshot payload for this room type.
   * Called by RoomDO.getSnapshot() and broadcast.
   */
  buildSnapshot(ctx: RoomContext): GlobalRoomSnapshot | PageRoomSnapshot | ChatRoomSnapshot;

  /**
   * Handle web visitor presence events.
   * Returns true if state changed and a broadcast is needed.
   */
  handleWebEvent(
    ctx: RoomContext,
    event: WebIngestEvent,
    readerId: string,
    ttlMs: number,
  ): boolean;

  /**
   * Handle session_end for a web visitor.
   * Returns true if state changed.
   */
  handleSessionEnd(ctx: RoomContext, readerId: string): boolean;

  /**
   * Handle device state push (only meaningful for GlobalRoomStrategy).
   * Returns true if state changed and a broadcast is needed.
   */
  handleDeviceUpdate(ctx: RoomContext, deviceId: string, state: DevicePresenceState | null): boolean;
}

// ==========================================
// Shared Types
// ==========================================

/** Minimal event shape extracted from WebIngestRequest */
export interface WebIngestEvent {
  kind: string;
  observedAt: string;
  sessionId: string;
  tabId: string;
  userId?: string;
  presence: { state: string };
  page: { title: string; url: string; canonicalUrl?: string };
  reading?: { progressPercent?: number; scrollY?: number };
}

/** Context object passed to strategies — avoids strategies needing DO internals */
export interface RoomContext {
  workspaceId: string;
  roomId: string;
  nowMs: number;
  readers: Map<string, ActiveReaderState>;
  deviceStates: Map<string, DevicePresenceState>;
  chatParticipants: Map<string, ChatParticipantState>;
  chatMessages: ChatMessageState[];
  typingUsers: Set<string>;
}

// ==========================================
// GlobalRoomStrategy
// ==========================================

export class GlobalRoomStrategy implements RoomStrategy {
  readonly type = 'global' as const;

  handleDeviceUpdate(ctx: RoomContext, deviceId: string, state: DevicePresenceState | null): boolean {
    if (state) {
      const existing = ctx.deviceStates.get(deviceId);
      const incoming = state;

      // Multi-device arbitration: only accept if newer or first time
      if (existing && existing.updatedAt && incoming.updatedAt) {
        if (new Date(incoming.updatedAt).getTime() < new Date(existing.updatedAt).getTime()) {
          return false; // Stale update, ignore
        }
      }

      ctx.deviceStates.set(deviceId, state);
    } else {
      if (!ctx.deviceStates.has(deviceId)) return false;
      ctx.deviceStates.delete(deviceId);
    }
    return true;
  }

  handleWebEvent(ctx: RoomContext, event: WebIngestEvent, readerId: string, ttlMs: number): boolean {
    ctx.readers.set(readerId, {
      readerId,
      sessionId: event.sessionId,
      tabId: event.tabId,
      workspaceId: ctx.workspaceId,
      roomId: ctx.roomId,
      userId: event.userId ?? null,
      source: 'web',
      displayName: event.userId ?? `Anonymous ${event.sessionId.slice(-4)}`,
      presenceState: event.presence.state,
      pageTitle: event.page.title,
      pageUrl: event.page.url,
      pageCanonicalUrl: event.page.canonicalUrl ?? event.page.url,
      readingProgressPercent: event.reading?.progressPercent ?? null,
      readingScrollY: event.reading?.scrollY ?? null,
      updatedAt: event.observedAt,
      expiresAtMs: ctx.nowMs + ttlMs,
      lastCountedAtMs: ctx.nowMs,
    });
    return true;
  }

  handleSessionEnd(ctx: RoomContext, readerId: string): boolean {
    return ctx.readers.delete(readerId);
  }

  buildSnapshot(ctx: RoomContext): GlobalRoomSnapshot {
    const rawWebReaders = Array.from(ctx.readers.values()).filter((reader) =>
      isReaderActiveNow(reader, ctx.nowMs),
    );
    const webReaders = dedupeReadersBySession(rawWebReaders).map(mapReaderToSnapshot);

    const deviceReaders: RoomReader[] = Array.from(ctx.deviceStates.entries())
      .filter(([, raw]) => isDeviceActiveNow(raw, ctx.nowMs))
      .map(([deviceId, raw]) => {
        const state = raw;
        const sessionId = state.sessionId ?? deviceId;
        const mediaSession = state.mediaSessions?.[0];
        const mediaExtensions = mediaSession?.extensions?.values?.provider as
          | {
              albumArtist?: string;
              trackNumber?: number;
              discNumber?: number;
              collectionId?: string;
              collectionTitle?: string;
              collectionLinkUrl?: string;
            }
          | undefined;
        return {
          readerId: `device:${deviceId}`,
          sessionId: deviceId,
          source: 'device' as const,
          displayName: state.device?.name || deviceId,
          presenceState: (state.availability?.state ?? 'active') as RoomReader["presenceState"],
          app: state.focus?.app?.name ? { name: state.focus.app.name } : undefined,
          media: mediaSession ? {
            providerId: mediaSession.provider?.id,
            source: mediaSession.provider?.kind,
            itemType: mediaSession.item?.type,
            trackId: mediaSession.item?.id,
            title: mediaSession.item?.title,
            artist: mediaSession.item?.artist,
            album: mediaSession.item?.album,
            albumArtist: mediaExtensions?.albumArtist,
            artworkUrl: mediaSession.item?.artworkUrl,
            linkUrl: mediaSession.item?.linkUrl ?? mediaSession.item?.uri,
            progressSeconds: mediaSession.playback?.progressSeconds,
            durationSeconds: mediaSession.playback?.durationSeconds,
            playbackState: mediaSession.playback?.state,
            trackNumber: mediaExtensions?.trackNumber,
            discNumber: mediaExtensions?.discNumber,
            collectionId: mediaExtensions?.collectionId,
            collectionTitle: mediaExtensions?.collectionTitle,
            collectionLinkUrl: mediaExtensions?.collectionLinkUrl,
          } : undefined,
          device: {
            deviceId,
            sessionId,
            name: state.device?.name,
            platform: state.device?.platform,
          },
          updatedAt: state.updatedAt || new Date().toISOString(),
        };
      });

    const pageReaders = new Map<string, Set<string>>();
    for (const reader of rawWebReaders) {
      const key = reader.pageCanonicalUrl ?? reader.pageUrl;
      if (!key) continue;
      const sessions = pageReaders.get(key) ?? new Set<string>();
      sessions.add(reader.sessionId);
      pageReaders.set(key, sessions);
    }
    const pageConcurrencyMap = Object.fromEntries(
      [...pageReaders.entries()].map(([key, sessions]) => [key, sessions.size]),
    );

    const ownerCurrent = [...deviceReaders]
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];

    return {
      roomKind: 'global',
      workspaceId: ctx.workspaceId,
      roomId: ctx.roomId,
      revision: Date.now(),
      onlineCount: webReaders.length + deviceReaders.length,
      activeReaders: [...webReaders, ...deviceReaders],
      pageConcurrencyMap,
      ownerCurrent: ownerCurrent
        ? {
            deviceId: ownerCurrent.device?.deviceId,
            displayName: ownerCurrent.displayName,
            currentApp: ownerCurrent.app,
            currentMedia: ownerCurrent.media,
            lastActiveAt: ownerCurrent.updatedAt,
          }
        : null,
      updatedAt: new Date().toISOString(),
    };
  }
}

// ==========================================
// PageRoomStrategy
// ==========================================

export class PageRoomStrategy implements RoomStrategy {
  readonly type = 'page' as const;

  handleDeviceUpdate(_ctx: RoomContext, _deviceId: string, _state: DevicePresenceState | null): boolean {
    // Page rooms don't care about device states
    return false;
  }

  handleWebEvent(ctx: RoomContext, event: WebIngestEvent, readerId: string, ttlMs: number): boolean {
    ctx.readers.set(readerId, {
      readerId,
      sessionId: event.sessionId,
      tabId: event.tabId,
      workspaceId: ctx.workspaceId,
      roomId: ctx.roomId,
      userId: event.userId ?? null,
      source: 'web',
      displayName: event.userId ?? `Anonymous ${event.sessionId.slice(-4)}`,
      presenceState: event.presence.state,
      pageTitle: event.page.title,
      pageUrl: event.page.url,
      pageCanonicalUrl: event.page.canonicalUrl ?? event.page.url,
      readingProgressPercent: event.reading?.progressPercent ?? null,
      readingScrollY: event.reading?.scrollY ?? null,
      updatedAt: event.observedAt,
      expiresAtMs: ctx.nowMs + ttlMs,
      lastCountedAtMs: ctx.nowMs,
    });
    return true;
  }

  handleSessionEnd(ctx: RoomContext, readerId: string): boolean {
    return ctx.readers.delete(readerId);
  }

  buildSnapshot(ctx: RoomContext): PageRoomSnapshot {
    const currentReaders = Array.from(ctx.readers.values()).filter((reader) =>
      isReaderActiveNow(reader, ctx.nowMs),
    );
    const dedupedReaders = dedupeReadersBySession(currentReaders);
    const readers = dedupedReaders.map(mapReaderToSnapshot);

    // Compute page-level aggregates
    let progressSum = 0;
    let progressCount = 0;
    let maxProgress = 0;
    for (const r of dedupedReaders) {
      if (r.readingProgressPercent != null) {
        progressSum += r.readingProgressPercent;
        progressCount++;
        maxProgress = Math.max(maxProgress, r.readingProgressPercent);
      }
    }

    return {
      roomKind: 'page',
      workspaceId: ctx.workspaceId,
      roomId: ctx.roomId,
      revision: Date.now(),
      onlineCount: readers.length,
      activeReaders: readers,
      readingStats: {
        avgProgress: progressCount > 0 ? progressSum / progressCount : 0,
        maxProgress,
        sampleCount: progressCount,
      },
      updatedAt: new Date().toISOString(),
    };
  }
}

// ==========================================
// ChatRoomStrategy
// ==========================================

export class ChatRoomStrategy implements RoomStrategy {
  readonly type = 'chat' as const;

  handleDeviceUpdate(_ctx: RoomContext, _deviceId: string, _state: DevicePresenceState | null): boolean {
    return false;
  }

  handleWebEvent(ctx: RoomContext, event: WebIngestEvent, readerId: string, ttlMs: number): boolean {
    // For chat rooms, we only track who's present (no page/reading data)
    ctx.readers.set(readerId, {
      readerId,
      sessionId: event.sessionId,
      tabId: event.tabId,
      workspaceId: ctx.workspaceId,
      roomId: ctx.roomId,
      userId: event.userId ?? null,
      source: 'web',
      displayName: event.userId ?? `Anonymous ${event.sessionId.slice(-4)}`,
      presenceState: event.presence.state,
      pageTitle: null,
      pageUrl: null,
      pageCanonicalUrl: null,
      readingProgressPercent: null,
      readingScrollY: null,
      updatedAt: event.observedAt,
      expiresAtMs: ctx.nowMs + ttlMs,
      lastCountedAtMs: ctx.nowMs,
    });
    return true;
  }

  handleSessionEnd(ctx: RoomContext, readerId: string): boolean {
    return ctx.readers.delete(readerId);
  }

  buildSnapshot(ctx: RoomContext): ChatRoomSnapshot {
    const participants = Array.from(ctx.chatParticipants.values()).map((participant) => ({
      readerId: participant.readerId,
      displayName: participant.displayName,
      presenceState: participant.presenceState,
      updatedAt: participant.updatedAt,
    }));

    return {
      roomKind: 'chat',
      workspaceId: ctx.workspaceId,
      roomId: ctx.roomId,
      revision: Date.now(),
      participantCount: participants.length,
      participants,
      messages: ctx.chatMessages.map((message) => ({
        msgId: message.msgId,
        senderId: message.senderId,
        senderDisplayName: message.senderDisplayName,
        content: message.content,
        createdAt: message.createdAt,
      })),
      messageCount: ctx.chatMessages.length,
      typingUsers: Array.from(ctx.typingUsers),
      updatedAt: new Date().toISOString(),
    };
  }
}

// ==========================================
// Factory
// ==========================================

export function createStrategy(roomId: string): RoomStrategy {
  if (roomId === 'global') return new GlobalRoomStrategy();
  if (roomId.startsWith('page:')) return new PageRoomStrategy();
  if (roomId.startsWith('chat:')) return new ChatRoomStrategy();
  // Default to global-like behavior for unknown room types
  return new GlobalRoomStrategy();
}

// ==========================================
// Shared Helpers
// ==========================================

function mapReaderToSnapshot(r: ActiveReaderState): RoomReader {
  return {
    readerId: r.readerId,
    sessionId: r.sessionId,
    userId: r.userId || undefined,
    source: r.source as RoomReader["source"],
    displayName: r.displayName,
    presenceState: r.presenceState as RoomReader["presenceState"],
    updatedAt: r.updatedAt,
    page: r.pageUrl
      ? {
          title: r.pageTitle || '',
          url: r.pageUrl,
          canonicalUrl: r.pageCanonicalUrl || undefined,
        }
      : undefined,
    reading:
      r.readingProgressPercent != null
        ? {
            progressPercent: r.readingProgressPercent,
            scrollY: r.readingScrollY || 0,
          }
        : undefined,
  };
}

function dedupeReadersBySession(readers: ActiveReaderState[]) {
  const deduped = new Map<string, ActiveReaderState>();
  for (const reader of readers) {
    const existing = deduped.get(reader.sessionId);
    if (!existing) {
      deduped.set(reader.sessionId, reader);
      continue;
    }

    const existingTs = Date.parse(existing.updatedAt) || 0;
    const nextTs = Date.parse(reader.updatedAt) || 0;
    if (nextTs > existingTs) {
      deduped.set(reader.sessionId, reader);
    }
  }
  return [...deduped.values()];
}

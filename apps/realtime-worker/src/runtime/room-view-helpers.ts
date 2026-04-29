import type {
  ActivePage,
  PageSession,
  SessionUser,
} from "@pulse/realtime-protocol";
import type { ActiveReaderState, DevicePresenceState } from "./models";

export const SESSION_PREVIEW_LIMIT = 3;

export function mapReaderToSessionPreview(reader: ActiveReaderState): SessionUser {
  return {
    id: reader.sessionId,
    userId: reader.userId || undefined,
    userName: reader.displayName,
  };
}

export function mapReaderToPageSessionPreview(reader: ActiveReaderState): PageSession {
  return {
    ...mapReaderToSessionPreview(reader),
    progress:
      reader.readingProgressPercent != null
        ? {
            percent: reader.readingProgressPercent,
            scrollY: reader.readingScrollY || 0,
          }
        : undefined,
  };
}

export function dedupeReadersBySession(readers: ActiveReaderState[]) {
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

export function buildActivePages(readers: ActiveReaderState[]): ActivePage[] {
  const pages = new Map<
    string,
    { id: string; title?: string; canonicalUrl?: string; sessionIds: Set<string> }
  >();

  for (const reader of readers) {
    const canonicalUrl = reader.pageCanonicalUrl ?? reader.pageUrl;
    if (!canonicalUrl) continue;
    const current = pages.get(canonicalUrl) ?? {
      id: canonicalUrl,
      title: reader.pageTitle ?? undefined,
      canonicalUrl,
      sessionIds: new Set<string>(),
    };
    current.title = current.title ?? reader.pageTitle ?? undefined;
    current.sessionIds.add(reader.sessionId);
    pages.set(canonicalUrl, current);
  }

  return [...pages.values()]
    .map((page) => ({
      id: page.id,
      title: page.title,
      canonicalUrl: page.canonicalUrl,
      sessionCount: page.sessionIds.size,
    }))
    .sort((left, right) => right.sessionCount - left.sessionCount);
}

export function buildOwnerCurrent(deviceId: string, state: DevicePresenceState) {
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
    deviceId,
    displayName: state.device?.name || deviceId,
    currentApp:
      state.focus?.app?.name || state.focus?.app?.id
        ? {
            name: state.focus.app?.name,
            id: state.focus.app?.id,
            category: state.focus.app?.category,
          }
        : undefined,
    currentMedia: mediaSession
      ? {
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
        }
      : undefined,
    lastActiveAt: state.updatedAt,
  };
}

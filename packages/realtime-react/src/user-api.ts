import type { ReactNode } from "react";
import type {
  ActivePage as SnapshotActivePage,
  ChatRoomSnapshot,
  ContentHistoryPoint,
  ContentLifetime,
  GlobalRoomSnapshot,
  OwnerHistoryPoint,
  OwnerLifetime,
  PageSession as SnapshotPageSession,
  PageRoomSnapshot,
  SessionUser as SnapshotSessionUser,
  SiteHistoryPoint,
  SiteLifetime,
  StatsPeriod,
} from "@pulse/realtime-protocol";

import {
  formatClock,
  resolveDisplayedProgressSeconds,
  resolveProgressPercent,
} from "./media";

export interface QueryState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export interface SessionUser {
  id: string;
  userId?: string;
  userName?: string;
  userAvatar?: string;
}

export interface PageSession extends SessionUser {
  progress?: {
    percent?: number;
    scrollY?: number;
  };
}

export interface ActivePage {
  id: string;
  title?: string;
  canonicalUrl?: string;
  sessionCount: number;
}

export interface FocusStatus {
  id: string;
  name: string;
  metadata?: Record<string, unknown>;
  desc?: string;
  icon?: string | ReactNode;
}

export interface MediaStatus {
  providerId?: string;
  title?: string;
  artist?: string;
  album?: string;
  artworkUrl?: string;
  linkUrl?: string;
  playbackState?: string;
  progressSeconds?: number;
  durationSeconds?: number;
  updatedAt?: string;
  progressPercent: number;
  progressLabel: string;
  durationLabel: string;
}

export interface OwnerStatus {
  focus?: FocusStatus;
  media?: MediaStatus;
  lastActivedAt: Date;
}

export interface GlobalStatus {
  pv: number;
  uv: number;
  stayTimeInSec: number;
  sessions: SessionUser[];
  sessionCount: number;
  activePageCount: number;
  activePages: ActivePage[];
  ownerStatus: OwnerStatus | null;
}

export interface PageStatus {
  pv?: number;
  uv?: number;
  stayTimeInSec: number;
  sessions: PageSession[];
  sessionCount: number;
  activePages: ActivePage[];
}

export interface ChatParticipant {
  id: string;
  displayName: string;
  presence: "active" | "idle" | "locked" | "sleeping" | "offline" | "hidden";
  updatedAt: string;
  duplicateCount: number;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderDisplayName: string;
  content: string;
  createdAt: string;
}

export interface ChatRoom {
  id: string;
  type: string;
  participants: ChatParticipant[];
  participantCount: number;
  latestMessages: ChatMessage[];
  unreadMessageCount: number;
  messageCount: number;
}

export interface StatsQueryOptions {
  period?: StatsPeriod;
  anchorDay?: string;
  limit?: number;
}

export interface StatsBucket {
  period: StatsPeriod;
  key: string;
  label: string;
  startDay: string;
  endDay: string;
}

export interface SiteStats {
  pv: number;
  uv: number;
  readTimeSeconds: number;
  readTimeLabel: string;
}

export interface OwnerAppStat {
  key: string;
  label: string;
  totalFocusSeconds: number;
  totalFocusLabel: string;
  occurrences: number;
  sharePercent: number;
  shareLabel: string;
}

export interface OwnerStats {
  totalFocusSeconds: number;
  totalFocusLabel: string;
  activeAppCount: number;
  apps: OwnerAppStat[];
}

export interface PageStats {
  canonicalUrl: string;
  title: string;
  pv: number;
  uv: number;
  readTimeSeconds: number;
  readTimeLabel: string;
}

export interface StatsSeriesPoint<T> {
  bucket: StatsBucket;
  value: T | null;
}

export function selectGlobalStatus(
  snapshot: GlobalRoomSnapshot | null,
  lifetime: SiteLifetime | null | undefined,
  options?: { nowMs?: number },
): GlobalStatus {
  return {
    pv: lifetime?.pv ?? 0,
    uv: lifetime?.uv ?? 0,
    stayTimeInSec: lifetime?.readTimeSeconds ?? 0,
    sessions: (snapshot?.sessions ?? []).map(mapSessionUser),
    sessionCount: snapshot?.sessionCount ?? 0,
    activePageCount: snapshot?.activePageCount ?? snapshot?.activePages.length ?? 0,
    activePages: (snapshot?.activePages ?? []).map(mapActivePage),
    ownerStatus: selectOwnerStatus(snapshot, options),
  };
}

export function selectOwnerStatus(
  snapshot: GlobalRoomSnapshot | null,
  options?: { nowMs?: number },
): OwnerStatus | null {
  const focus = selectOwnerFocusApp(snapshot);
  const media = selectOwnerMedia(snapshot, options);
  const updatedAt = snapshot?.ownerCurrent?.lastActiveAt;

  if (!focus && !media && !updatedAt) return null;

  return {
    focus: focus ?? undefined,
    media: media ?? undefined,
    lastActivedAt: new Date(updatedAt ?? Date.now()),
  };
}

export function selectOwnerFocusApp(
  snapshot: GlobalRoomSnapshot | null,
): FocusStatus | null {
  const app = snapshot?.ownerCurrent?.currentApp;
  if (!app?.name && !app?.id) return null;

  return {
    id: app?.id ?? "focus",
    name: app?.name ?? snapshot?.ownerCurrent?.displayName ?? "Unknown",
  };
}

export function selectOwnerMedia(
  snapshot: GlobalRoomSnapshot | null,
  options?: { nowMs?: number },
): MediaStatus | null {
  const media = snapshot?.ownerCurrent?.currentMedia;
  const updatedAt = snapshot?.ownerCurrent?.lastActiveAt;
  if (!media) return null;

  const displayedProgress = resolveDisplayedProgressSeconds(
    media,
    updatedAt,
    options?.nowMs ?? Date.now(),
  );

  return {
    providerId: media.providerId ?? undefined,
    title: media.title ?? undefined,
    artist: media.artist ?? undefined,
    album: media.album ?? undefined,
    artworkUrl: media.artworkUrl ?? undefined,
    linkUrl: media.linkUrl ?? undefined,
    playbackState: media.playbackState ?? undefined,
    progressSeconds: media.progressSeconds ?? undefined,
    durationSeconds: media.durationSeconds ?? undefined,
    updatedAt,
    progressPercent: resolveProgressPercent(displayedProgress, media.durationSeconds ?? 0),
    progressLabel: formatClock(displayedProgress),
    durationLabel: formatClock(media.durationSeconds ?? 0),
  };
}

export function selectPageStatus(
  canonicalUrl: string,
  snapshot: PageRoomSnapshot | null,
  lifetime: ContentLifetime | null | undefined,
): PageStatus {
  const sessions = (snapshot?.sessions ?? []).map(mapPageSession);
  const title = lifetime?.title;

  return {
    pv: lifetime?.pv,
    uv: lifetime?.uv,
    stayTimeInSec: lifetime?.readTimeSeconds ?? 0,
    sessions,
    sessionCount: snapshot?.sessionCount ?? 0,
    activePages:
      (snapshot?.sessionCount ?? 0) > 0 || title
        ? [
            {
              id: canonicalUrl,
              title: title ?? canonicalUrl,
              canonicalUrl,
              sessionCount: snapshot?.sessionCount ?? 0,
            },
          ]
        : [],
  };
}

export function selectChatRoom(snapshot: ChatRoomSnapshot | null): ChatRoom | null {
  if (!snapshot) return null;

  const participantCounts = countBy(snapshot.participants, (item) => item.displayName);

  return {
    id: snapshot.roomId,
    type: resolveChatRoomType(snapshot.roomId),
    participants: snapshot.participants.map((participant) => ({
      id: participant.readerId,
      displayName: participant.displayName,
      presence: participant.presenceState,
      updatedAt: participant.updatedAt,
      duplicateCount: participantCounts[participant.displayName] ?? 0,
    })),
    participantCount: snapshot.participantCount ?? snapshot.participants.length,
    latestMessages: snapshot.messages.map((message) => ({
      id: message.msgId,
      senderId: message.senderId,
      senderDisplayName: message.senderDisplayName,
      content: message.content,
      createdAt: message.createdAt,
    })),
    unreadMessageCount: 0,
    messageCount: snapshot.messageCount ?? snapshot.messages.length,
  };
}

export function selectSiteStats(value: SiteLifetime | null | undefined): SiteStats | null {
  if (!value) return null;
  return {
    pv: value.pv,
    uv: value.uv,
    readTimeSeconds: value.readTimeSeconds,
    readTimeLabel: formatDuration(value.readTimeSeconds),
  };
}

export function selectOwnerStats(
  value: OwnerLifetime | null | undefined,
): OwnerStats | null {
  if (!value) return null;
  const totalFocusSeconds = value.appPresenceSecondsByApp.reduce(
    (sum, item) => sum + item.totalSeconds,
    0,
  );

  return {
    totalFocusSeconds,
    totalFocusLabel: formatDuration(totalFocusSeconds),
    activeAppCount: value.appPresenceSecondsByApp.length,
    apps: value.appPresenceSecondsByApp.map((item) => ({
      key: item.key,
      label: item.label,
      totalFocusSeconds: item.totalSeconds,
      totalFocusLabel: formatDuration(item.totalSeconds),
      occurrences: item.count,
      sharePercent:
        totalFocusSeconds > 0 ? (item.totalSeconds / totalFocusSeconds) * 100 : 0,
      shareLabel:
        totalFocusSeconds > 0
          ? `${Math.round((item.totalSeconds / totalFocusSeconds) * 100)}%`
          : "0%",
    })),
  };
}

export function selectPageStats(
  value: ContentLifetime | null | undefined,
): PageStats | null {
  if (!value) return null;
  return {
    canonicalUrl: value.canonicalUrl,
    title: value.title,
    pv: value.pv,
    uv: value.uv,
    readTimeSeconds: value.readTimeSeconds,
    readTimeLabel: formatDuration(value.readTimeSeconds),
  };
}

export function selectSiteStatsSeries(
  history: SiteHistoryPoint[],
): StatsSeriesPoint<SiteStats>[] {
  return history.map((point) => ({
    bucket: point.bucket,
    value: selectSiteStats(point.value),
  }));
}

export function selectOwnerStatsSeries(
  history: OwnerHistoryPoint[],
): StatsSeriesPoint<OwnerStats>[] {
  return history.map((point) => ({
    bucket: point.bucket,
    value: selectOwnerStats(point.value),
  }));
}

export function selectPageStatsSeries(
  history: ContentHistoryPoint[],
): StatsSeriesPoint<PageStats>[] {
  return history.map((point) => ({
    bucket: point.bucket,
    value: selectPageStats(point.value),
  }));
}

function mapSessionUser(reader: SnapshotSessionUser): SessionUser {
  return {
    id: reader.id,
    userId: reader.userId,
    userName: reader.userName,
  };
}

function mapPageSession(reader: SnapshotPageSession): PageSession {
  return {
    ...mapSessionUser(reader),
    progress: reader.progress
      ? {
          percent: reader.progress.percent,
          scrollY: reader.progress.scrollY,
        }
      : undefined,
  };
}

function mapActivePage(page: SnapshotActivePage): ActivePage {
  return {
    id: page.id,
    title: page.title,
    canonicalUrl: page.canonicalUrl,
    sessionCount: page.sessionCount,
  };
}

function resolveChatRoomType(roomId: string) {
  if (roomId.startsWith("chat:private:")) return "private";
  if (roomId.startsWith("chat:temp:")) return "temporary";
  return "public";
}

function countBy<T>(items: T[], selectKey: (item: T) => string) {
  return items.reduce<Record<string, number>>((acc, item) => {
    const key = selectKey(item);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function formatDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${String(remainingSeconds).padStart(2, "0")}s`;
  return `${remainingSeconds}s`;
}

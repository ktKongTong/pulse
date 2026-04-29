import type {
  ChatRoomSnapshot,
  GlobalRoomSnapshot,
  PageRoomSnapshot,
  PresenceStatePayload,
  RoomSnapshot,
} from "@pulse/realtime-protocol";

export interface DevicePresenceState extends PresenceStatePayload {
  sessionId?: string;
  deviceId?: string;
  updatedAt?: string;
  expiresAtMs?: number;
  lastCountedAtMs?: number;
}

export interface ActiveReaderState {
  readerId: string;
  sessionId: string;
  tabId: string;
  workspaceId: string;
  roomId: string;
  userId: string | null;
  source: string;
  displayName: string;
  presenceState: string;
  pageTitle: string | null;
  pageUrl: string | null;
  pageCanonicalUrl: string | null;
  readingProgressPercent: number | null;
  readingScrollY: number | null;
  updatedAt: string;
  expiresAtMs: number;
  lastCountedAtMs: number;
}

export interface ChatParticipantState {
  readerId: string;
  displayName: string;
  presenceState: "active";
  updatedAt: string;
  userId?: string;
}

export interface ChatMessageState {
  msgId: string;
  senderId: string;
  senderDisplayName: string;
  content: string;
  createdAt: string;
}

export function isReaderActiveNow(
  reader: Pick<ActiveReaderState, "presenceState" | "expiresAtMs">,
  nowMs: number,
) {
  if (reader.expiresAtMs <= nowMs) return false;
  return reader.presenceState === "active";
}

export function isDeviceActiveNow(
  state: Pick<DevicePresenceState, "expiresAtMs" | "availability">,
  nowMs: number,
) {
  if ((state.expiresAtMs ?? 0) <= nowMs) return false;
  return (state.availability?.state ?? "active") === "active";
}

export function resolveDeviceAppKey(state: DevicePresenceState) {
  const key = state.focus?.app?.id ?? state.focus?.app?.name ?? null;
  const label = state.focus?.app?.name ?? key;
  if (!key || !label) return null;
  return { key, label };
}

export function isGlobalRoomSnapshot(snapshot: RoomSnapshot): snapshot is GlobalRoomSnapshot {
  return snapshot.roomKind === "global";
}

export function isPageRoomSnapshot(snapshot: RoomSnapshot): snapshot is PageRoomSnapshot {
  return snapshot.roomKind === "page";
}

export function isChatRoomSnapshot(snapshot: RoomSnapshot): snapshot is ChatRoomSnapshot {
  return snapshot.roomKind === "chat";
}

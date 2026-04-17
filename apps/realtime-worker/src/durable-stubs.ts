import type {
  ContentHistoryPoint,
  ContentLifetime,
  OwnerHistoryPoint,
  OwnerLifetime,
  PresenceIngestAck,
  RoomSnapshot,
  SiteHistoryPoint,
  SiteLifetime,
  StatsPeriod,
} from "@pulse/realtime-protocol";

import type { DevicePresenceState } from "./runtime-models";

export interface RoomRpc {
  subscribeSession(
    workspaceId: string,
    roomId: string,
    sessionDoId: string,
  ): Promise<void>;
  unsubscribeSession(sessionDoId: string): Promise<void>;
  joinChat(
    workspaceId: string,
    roomId: string,
    sessionDoId: string,
    userId: string,
    displayName: string,
  ): Promise<void>;
  leaveChat(
    workspaceId: string,
    roomId: string,
    sessionDoId: string,
  ): Promise<void>;
  postChatMessage(
    workspaceId: string,
    roomId: string,
    sessionDoId: string,
    senderId: string,
    displayName: string,
    content: string,
  ): Promise<void>;
  getSiteHistory(
    period: StatsPeriod,
    limit: number,
    anchorDay: string,
  ): Promise<SiteHistoryPoint[]>;
  getSiteLifetime(): Promise<SiteLifetime>;
  getContentHistory(
    canonicalUrl: string,
    period: StatsPeriod,
    limit: number,
    anchorDay: string,
  ): Promise<ContentHistoryPoint[]>;
  getContentLifetime(canonicalUrl: string): Promise<ContentLifetime | null>;
  getOwnerHistory(
    period: StatsPeriod,
    limit: number,
    anchorDay: string,
  ): Promise<OwnerHistoryPoint[]>;
  getOwnerLifetime(): Promise<OwnerLifetime>;
  getSnapshot(workspaceId?: string, roomId?: string): Promise<RoomSnapshot>;
  handleWebIngest(request: unknown, roomId: string, ttlMs: number): Promise<unknown>;
  removeWebReader(
    workspaceId: string,
    roomId: string,
    sessionId: string,
    tabId: string,
  ): Promise<void>;
  pushDeviceUpdate(
    workspaceId: string,
    roomId: string,
    deviceId: string,
    state: DevicePresenceState | null,
  ): Promise<void>;
}

export interface DeviceRpc {
  handlePresenceIngest(request: unknown, ttlMs: number): Promise<PresenceIngestAck>;
  handleHistoryIngest(payload: unknown): Promise<unknown>;
  getDeviceSnapshot(): Promise<unknown>;
}

export interface SessionRpc {
  pushRoomSnapshot(roomId: string, snapshot: RoomSnapshot): Promise<void>;
}

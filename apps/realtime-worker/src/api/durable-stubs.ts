import type {
  ContentHistoryPoint,
  ContentLifetime,
  LiveListenHostHeartbeatRequest,
  LiveListenHostStartRequest,
  LiveListenHostStopRequest,
  LiveListenListenerJoinRequest,
  LiveListenListenerLeaveRequest,
  OwnerHistoryPoint,
  OwnerLifetime,
  PresenceIngestAck,
  LiveListenSnapshot,
  LiveListenTokenResponse,
  RoomSnapshot,
  SiteHistoryPoint,
  SiteLifetime,
  StatsPeriod,
} from "@pulse/realtime-protocol";

import type { DevicePresenceState } from "./runtime/models";

export interface RoomRpc {
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

export interface LiveListenRpc {
  getSnapshot(workspaceId?: string, roomId?: string): Promise<LiveListenSnapshot>;
  startHost(request: LiveListenHostStartRequest): Promise<LiveListenTokenResponse>;
  heartbeatHost(request: LiveListenHostHeartbeatRequest): Promise<LiveListenSnapshot>;
  stopHost(request: LiveListenHostStopRequest): Promise<LiveListenSnapshot>;
  joinListener(request: LiveListenListenerJoinRequest): Promise<LiveListenTokenResponse>;
  leaveListener(request: LiveListenListenerLeaveRequest): Promise<LiveListenSnapshot>;
}

export type LiveListenStateResponse = LiveListenSnapshot;
export type LiveListenJoinResponse = LiveListenTokenResponse;

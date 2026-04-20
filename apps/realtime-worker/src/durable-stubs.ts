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

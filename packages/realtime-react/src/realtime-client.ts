import type {
  DeviceAggregateHistoryPoint,
  PageAggregateHistoryPoint,
  RealtimeMetaResponse,
  RoomAggregateHistoryPoint,
  RoomSnapshot,
  StatsPeriod,
  StatsSummaryHistoryPoint,
  WebEvent,
  WebIngestAck,
} from "@pulse/realtime-protocol";
import {
  DeviceAggregateHistoryPointSchema,
  PageAggregateHistoryPointSchema,
  RealtimeMetaResponseSchema,
  RoomAggregateHistoryPointSchema,
  RoomSnapshotSchema,
  StatsSummaryHistoryPointSchema,
  WebIngestAckSchema,
  WEB_PROTOCOL_V1,
} from "@pulse/realtime-protocol";

import type { APIOptions, Fetch } from "./fetch";
import type { PulseRealtimeConfig } from "./types";
import { getOrCreateSessionId } from "./session";

export const createRealtimeApiClient = (
  fetcher: Fetch,
  config: PulseRealtimeConfig
) => ({
  ingestWebEvents: (
    events: WebEvent[],
    options?: APIOptions & { keepalive?: boolean; userId?: string }
  ): Promise<WebIngestAck> =>
    fetcher.post("/api/v1/web/ingest", {
      json: {
        protocol: WEB_PROTOCOL_V1,
        workspaceId: config.workspaceId,
        siteId: config.siteId,
        sessionId: getOrCreateSessionId(config),
        userId: options?.userId,
        events,
      },
      schema: WebIngestAckSchema,
      keepalive: options?.keepalive,
      signal: options?.signal,
      timeout: options?.timeout,
      retry: options?.retry,
      retryDelay: options?.retryDelay,
      retryStatusCodes: options?.retryStatusCodes,
      credentials: options?.credentials,
    }),
  fetchMeta: (options?: APIOptions): Promise<RealtimeMetaResponse> =>
    fetcher.get("/api/v1/meta", {
      schema: RealtimeMetaResponseSchema,
      ...options,
    }),
  fetchRoomSnapshot: (roomId: string, options?: APIOptions): Promise<RoomSnapshot> =>
    fetcher.get("/api/v1/realtime/snapshot", {
      query: {
        workspaceId: config.workspaceId,
        roomId,
      },
      schema: RoomSnapshotSchema,
      ...options,
    }),
  fetchGlobalHistory: (
    period: StatsPeriod,
    options?: APIOptions & { limit?: number; anchorDay?: string }
  ): Promise<StatsSummaryHistoryPoint[]> =>
    fetcher.get("/api/v1/stats/global/history", {
      query: {
        workspaceId: config.workspaceId,
        period,
        limit: options?.limit,
        anchorDay: options?.anchorDay,
      },
      schema: StatsSummaryHistoryPointSchema.array(),
      ...options,
    }),
  fetchPageHistory: (
    period: StatsPeriod,
    options?: APIOptions & { limit?: number; itemLimit?: number; anchorDay?: string }
  ): Promise<PageAggregateHistoryPoint[]> =>
    fetcher.get("/api/v1/stats/pages/history", {
      query: {
        workspaceId: config.workspaceId,
        period,
        limit: options?.limit,
        itemLimit: options?.itemLimit,
        anchorDay: options?.anchorDay,
      },
      schema: PageAggregateHistoryPointSchema.array(),
      ...options,
    }),
  fetchRoomHistory: (
    period: StatsPeriod,
    options?: APIOptions & { limit?: number; itemLimit?: number; anchorDay?: string }
  ): Promise<RoomAggregateHistoryPoint[]> =>
    fetcher.get("/api/v1/stats/rooms/history", {
      query: {
        workspaceId: config.workspaceId,
        period,
        limit: options?.limit,
        itemLimit: options?.itemLimit,
        anchorDay: options?.anchorDay,
      },
      schema: RoomAggregateHistoryPointSchema.array(),
      ...options,
    }),
  fetchDeviceHistory: (
    deviceId: string,
    period: StatsPeriod,
    options?: APIOptions & { limit?: number; anchorDay?: string }
  ): Promise<DeviceAggregateHistoryPoint[]> =>
    fetcher.get(`/api/v1/stats/device/${encodeURIComponent(deviceId)}/history`, {
      query: {
        workspaceId: config.workspaceId,
        period,
        limit: options?.limit,
        anchorDay: options?.anchorDay,
      },
      schema: DeviceAggregateHistoryPointSchema.array(),
      ...options,
    }),
});

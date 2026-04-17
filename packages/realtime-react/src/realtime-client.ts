import type {
  ContentHistoryPoint,
  ContentLifetime,
  OwnerHistoryPoint,
  OwnerLifetime,
  RealtimeMetaResponse,
  SiteHistoryPoint,
  SiteLifetime,
  StatsPeriod,
  WebEvent,
  WebIngestAck,
} from "@pulse/realtime-protocol";
import {
  ContentHistoryPointSchema,
  ContentLifetimeSchema,
  OwnerHistoryPointSchema,
  OwnerLifetimeSchema,
  RealtimeMetaResponseSchema,
  SiteHistoryPointSchema,
  SiteLifetimeSchema,
  WebIngestAckSchema,
  WEB_PROTOCOL_V1,
} from "@pulse/realtime-protocol";

import type { APIOptions, Fetch } from "./fetch";
import type { PulseRealtimeConfig } from "./types";
import { getOrCreateSessionId, getOrCreateTabId } from "./session";

function buildWebIngestPayload(
  config: PulseRealtimeConfig,
  events: WebEvent[],
  userId?: string,
) {
  return {
    protocol: WEB_PROTOCOL_V1,
    workspaceId: config.workspaceId,
    siteId: config.siteId,
    sessionId: getOrCreateSessionId(config),
    tabId: getOrCreateTabId(config),
    userId,
    events,
  };
}

export const createRealtimeApiClient = (
  fetcher: Fetch,
  config: PulseRealtimeConfig
) => ({
  ingestWebEvents: (
    events: WebEvent[],
    options?: APIOptions & { keepalive?: boolean; userId?: string }
  ): Promise<WebIngestAck> =>
    fetcher.post("/api/v1/web/ingest", {
      json: buildWebIngestPayload(config, events, options?.userId),
      schema: WebIngestAckSchema,
      keepalive: options?.keepalive,
      signal: options?.signal,
      timeout: options?.timeout,
      retry: options?.retry,
      retryDelay: options?.retryDelay,
      retryStatusCodes: options?.retryStatusCodes,
      credentials: options?.credentials,
    }),
  ingestWebEventsBeacon: (
    events: WebEvent[],
    options?: { userId?: string },
  ): boolean => {
    if (typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function") {
      return false;
    }

    const payload = buildWebIngestPayload(config, events, options?.userId);
    const url = new URL("/api/v1/web/ingest", config.baseUrl).toString();
    const body = new Blob([JSON.stringify(payload)], {
      type: "application/json",
    });
    return navigator.sendBeacon(url, body);
  },
  fetchMeta: (options?: APIOptions): Promise<RealtimeMetaResponse> =>
    fetcher.get("/api/v1/meta", {
      schema: RealtimeMetaResponseSchema,
      ...options,
    }),
  fetchSiteHistory: (
    period: StatsPeriod,
    options?: APIOptions & { limit?: number; anchorDay?: string }
  ): Promise<SiteHistoryPoint[]> =>
    fetcher.get("/api/v1/site/history", {
      query: {
        workspaceId: config.workspaceId,
        period,
        limit: options?.limit,
        anchorDay: options?.anchorDay,
      },
      schema: SiteHistoryPointSchema.array(),
      ...options,
    }),
  fetchSiteLifetime: (options?: APIOptions): Promise<SiteLifetime> =>
    fetcher.get("/api/v1/site/lifetime", {
      query: {
        workspaceId: config.workspaceId,
      },
      schema: SiteLifetimeSchema,
      ...options,
    }),
  fetchContentHistory: (
    canonicalUrl: string,
    period: StatsPeriod,
    options?: APIOptions & { limit?: number; anchorDay?: string }
  ): Promise<ContentHistoryPoint[]> =>
    fetcher.get("/api/v1/content/history", {
      query: {
        workspaceId: config.workspaceId,
        canonicalUrl,
        period,
        limit: options?.limit,
        anchorDay: options?.anchorDay,
      },
      schema: ContentHistoryPointSchema.array(),
      ...options,
    }),
  fetchContentLifetime: (
    canonicalUrl: string,
    options?: APIOptions
  ): Promise<ContentLifetime | null> =>
    fetcher.get("/api/v1/content/lifetime", {
      query: {
        workspaceId: config.workspaceId,
        canonicalUrl,
      },
      schema: ContentLifetimeSchema.nullable(),
      ...options,
    }),
  fetchOwnerHistory: (
    period: StatsPeriod,
    options?: APIOptions & { limit?: number; anchorDay?: string }
  ): Promise<OwnerHistoryPoint[]> =>
    fetcher.get("/api/v1/owner/history", {
      query: {
        workspaceId: config.workspaceId,
        period,
        limit: options?.limit,
        anchorDay: options?.anchorDay,
      },
      schema: OwnerHistoryPointSchema.array(),
      ...options,
    }),
  fetchOwnerLifetime: (options?: APIOptions): Promise<OwnerLifetime> =>
    fetcher.get("/api/v1/owner/lifetime", {
      query: {
        workspaceId: config.workspaceId,
      },
      schema: OwnerLifetimeSchema,
      ...options,
    }),
});

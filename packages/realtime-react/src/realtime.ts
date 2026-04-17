import { Fetch } from "./fetch";
import { createRealtimeApiClient } from "./realtime-client";
import type { PulseRealtimeConfig } from "./types";

function createHttp(config: PulseRealtimeConfig) {
  return new Fetch(undefined, {
    baseURL: config.baseUrl || undefined,
  });
}

export function ingestWebEvents(
  config: PulseRealtimeConfig,
  ...args: Parameters<ReturnType<typeof createRealtimeApiClient>["ingestWebEvents"]>
) {
  return createRealtimeApiClient(createHttp(config), config).ingestWebEvents(...args);
}

export function fetchRealtimeMeta(
  config: PulseRealtimeConfig,
  ...args: Parameters<ReturnType<typeof createRealtimeApiClient>["fetchMeta"]>
) {
  return createRealtimeApiClient(createHttp(config), config).fetchMeta(...args);
}

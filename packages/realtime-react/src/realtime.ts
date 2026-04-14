import type { RoomSnapshot, RoomStreamEnvelope } from "@pulse/realtime-protocol";
import { RoomStreamEnvelopeSchema } from "@pulse/realtime-protocol";

import { Fetch } from "./fetch";
import { createRealtimeApiClient } from "./realtime-client";
import type { PulseRealtimeConfig } from "./types";

function withOrigin(baseUrl: string, path: string) {
  if (typeof window === "undefined") return `${baseUrl}${path}`;
  return new URL(`${baseUrl}${path}`, window.location.origin).toString();
}

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

export function subscribeRoomLegacy(
  config: PulseRealtimeConfig,
  roomId: string,
  onSnapshot: (snapshot: RoomSnapshot) => void,
  onError?: (error: unknown) => void
): () => void {
  const url = `${withOrigin(config.baseUrl, "/api/v1/realtime/sse")}?workspaceId=${encodeURIComponent(config.workspaceId)}&roomId=${encodeURIComponent(roomId)}`;
  const source = new EventSource(url);

  source.onmessage = (event) => {
    try {
      const envelope = RoomStreamEnvelopeSchema.parse(JSON.parse(event.data)) as RoomStreamEnvelope;
      if (envelope.payload) {
        onSnapshot(envelope.payload);
      }
    } catch (error) {
      onError?.(error);
    }
  };

  source.onerror = (error) => {
    onError?.(error);
  };

  return () => source.close();
}

export function fetchRoomSnapshot(
  config: PulseRealtimeConfig,
  ...args: Parameters<ReturnType<typeof createRealtimeApiClient>["fetchRoomSnapshot"]>
) {
  return createRealtimeApiClient(createHttp(config), config).fetchRoomSnapshot(...args);
}

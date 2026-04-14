import type { InteractionState } from "@pulse/realtime-protocol";
import { InteractionStateSchema, type InteractionStreamEnvelope } from "@pulse/realtime-protocol";

import { Fetch } from "./fetch";
import { createInteractionClient } from "./interaction-client";
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

export function createTrackRecommendation(
  config: PulseRealtimeConfig,
  ...args: Parameters<ReturnType<typeof createInteractionClient>["createTrackRecommendation"]>
) {
  return createInteractionClient(createHttp(config), config).createTrackRecommendation(...args);
}

export function subscribeInteractionStream(
  config: PulseRealtimeConfig,
  onUpdate: (state: InteractionState) => void,
  onError?: (error: unknown) => void
): () => void {
  const source = new EventSource(withOrigin(config.baseUrl, "/api/v1/interaction/stream/sse"));
  source.onmessage = (event) => {
    try {
      const envelope = JSON.parse(event.data) as InteractionStreamEnvelope;
      if (envelope.payload) {
        onUpdate(InteractionStateSchema.parse(envelope.payload));
      }
    } catch (error) {
      onError?.(error);
    }
  };
  source.onerror = (event) => {
    onError?.(event);
  };
  return () => source.close();
}

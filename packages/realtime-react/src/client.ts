import type { InteractionState, WebEvent } from "@pulse/realtime-protocol";

import { subscribeInteractionStream } from "./interactions";
import { Fetch } from "./fetch";
import { createInteractionClient } from "./interaction-client";
import { createRealtimeApiClient } from "./realtime-client";
import { RoomSubscriptionManager } from "./room-subscription-manager";
import type { PulseRealtimeConfig } from "./types";

export class PulseRealtimeClient {
  readonly subscriptions: RoomSubscriptionManager;
  readonly http: Fetch;
  readonly realtime;
  readonly interactions;

  constructor(readonly config: PulseRealtimeConfig) {
    this.http = new Fetch(undefined, {
      baseURL: config.baseUrl || undefined,
    });
    this.realtime = createRealtimeApiClient(this.http, config);
    this.interactions = createInteractionClient(this.http, config);
    this.subscriptions = new RoomSubscriptionManager(config);
  }

  dispose() {
    this.subscriptions.dispose();
  }

  ingestWebEvents(
    events: WebEvent[],
    options?: {
      keepalive?: boolean;
      userId?: string;
      sessionId?: string;
      tabId?: string;
    },
  ) {
    return this.realtime.ingestWebEvents(events, options);
  }

  ingestWebEventsBeacon(
    events: WebEvent[],
    options?: { userId?: string; sessionId?: string; tabId?: string },
  ) {
    return this.realtime.ingestWebEventsBeacon(events, options);
  }

  setPresenceContext(context: {
    sessionId: string;
    tabId: string;
    userId?: string;
    page: {
      title: string;
      url: string;
      canonicalUrl?: string;
    };
  }) {
    this.subscriptions.setPresenceContext(context);
  }

  createTrackRecommendation(args: {
    provider: "spotify" | "apple-music";
    uri: string;
    title?: string;
    artist?: string;
    album?: string;
  }): Promise<InteractionState> {
    return this.interactions.createTrackRecommendation(args);
  }

  subscribeInteractionStream(
    onUpdate: (state: InteractionState) => void,
    onError?: (error: unknown) => void
  ) {
    return subscribeInteractionStream(this.config, onUpdate, onError);
  }
}

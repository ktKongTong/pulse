import type { InteractionState } from "@pulse/realtime-protocol";
import { InteractionStateSchema } from "@pulse/realtime-protocol";

import type { APIOptions, Fetch } from "./fetch";
import type { PulseRealtimeConfig } from "./types";

export const createInteractionClient = (
  fetcher: Fetch,
  config: PulseRealtimeConfig
) => ({
  createTrackRecommendation: (
    args: {
      provider: "spotify" | "apple-music";
      uri: string;
      title?: string;
      artist?: string;
      album?: string;
    },
    options?: APIOptions
  ): Promise<InteractionState> =>
    fetcher.post("/api/v1/interaction/requests", {
      json: {
        protocol: "interaction.v1",
        workspaceId: config.workspaceId,
        requestId: crypto.randomUUID(),
        issuedAt: new Date().toISOString(),
        actor: config.interactionActor ?? { kind: "anonymous" },
        target: {
          type: "device",
        },
        command: {
          type: "media.recommend.track",
          provider: args.provider,
          uri: args.uri,
          intent: "enqueue",
          title: args.title,
          artist: args.artist,
          album: args.album,
        },
        constraints: {
          expiresInSeconds: 30,
          requireForeground: false,
          requireCapability: "media.recommend.track",
        },
      },
      schema: InteractionStateSchema,
      ...options,
    }),
});

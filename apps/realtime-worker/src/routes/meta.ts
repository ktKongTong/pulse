import { Hono } from "hono";
import {
  LIVE_LISTEN_PROTOCOL_V1,
  LIVE_LISTEN_STREAM_PROTOCOL_V1,
  REALTIME_WS_PROTOCOL_V2,
  RealtimeMetaResponseSchema,
} from "@pulse/realtime-protocol";

import type { AppEnv } from "../http/hono";

export const metaRoutes = new Hono<AppEnv>();

metaRoutes.get("/", (c) =>
  c.json({
    name: "pulse-realtime-worker",
    protocol: [
      "presence.v2",
      "web.v1",
      "realtime.v1-stream",
      REALTIME_WS_PROTOCOL_V2,
      LIVE_LISTEN_PROTOCOL_V1,
      LIVE_LISTEN_STREAM_PROTOCOL_V1,
    ],
  }),
);

metaRoutes.get("/v1/meta", (c) =>
  c.json(
    RealtimeMetaResponseSchema.parse({
      serverVersion: "2026.04.14",
      ingestProtocols: {
        presence: ["presence.v2"],
        web: ["web.v1"],
      },
      streamProtocols: [REALTIME_WS_PROTOCOL_V2],
      capabilities: {
        presence: true,
        multiRoom: true,
        chat: true,
        richMedia: true,
        interaction: true,
        liveListen: true,
      },
      interactionProtocols: ["interaction.v1", "interaction.ws.v1"],
      supportedInteractionCommands: ["media.recommend.track"],
      liveListenProtocols: [LIVE_LISTEN_PROTOCOL_V1, LIVE_LISTEN_STREAM_PROTOCOL_V1],
    }),
  ),
);

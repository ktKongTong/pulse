import { Hono } from "hono";
import type { Env } from "./config/env";
import { applyCorsHeaders, handleOptions } from "./http/cors";
import { createWorkerLogger } from "./observability/logger";
import { ingestRoutes } from "./routes/ingest";
import { liveListenRoutes } from "./routes/live-listen";
import { metaRoutes } from "./routes/meta";
import { partyTracksRoutes } from "./routes/partytracks";
import { realtimeRoutes } from "./routes/realtime";
import { statsRoutes } from "./routes/stats";

const app = new Hono<{ Bindings: Env }>();

app.use("*", applyCorsHeaders);
app.options("*", handleOptions);

app.route("/", metaRoutes);
app.route("/", statsRoutes);
app.route("/", ingestRoutes);
app.route("/", realtimeRoutes);
app.route("/v1/live-listen", liveListenRoutes);
app.route("/v1/live-listen", partyTracksRoutes);

app.all("/v1/device-interactions/*", (c) =>
  c.json({ error: "endpoint_disabled" }, 410),
);

app.onError((err, c) => {
  createWorkerLogger(c.env, "worker.index").error("hono error", err);
  return c.json(
    {
      error: "internal_server_error",
      message: err.message,
      stack: err.stack,
    },
    500,
  );
});

app.notFound((c) => c.env.ASSETS.fetch(c.req.raw));

export default app;

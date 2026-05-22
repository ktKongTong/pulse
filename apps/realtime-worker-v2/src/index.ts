import { Hono } from "hono";
import { clientRoutes } from "./routes/client";
import { deviceRoutes } from "./routes/device";
import { lyricsRoutes } from "./routes/lyrics";
import type { Env } from "./env";

export { DeviceDO } from "./durable/device";
export { GlobalDO } from "./durable/global";
export { MediaDO } from "./durable/media";
export { PageDO } from "./durable/page";

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.json({ ok: true, worker: "realtime-worker-v2" }));
app.route("/api/lyrics", lyricsRoutes);
app.route("/api/v1/client", clientRoutes);
app.route("/api/v1/device", deviceRoutes);

app.notFound((c) => c.json({ error: "not_found" }, 404));

export default app;

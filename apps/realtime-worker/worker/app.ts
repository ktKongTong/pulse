import { Hono } from "hono";
import { createRequestHandler } from "react-router";

import api from '@/api'
import type { Env } from '@/api/config/env'

export { GlobalStatusRoom, PageStatusRoom, ChatRoom, InteractionHub, InteractionInbox, LiveListenRoom, MediaRoomDO, DeviceDO } from '@/api/do'
const requestHandler = createRequestHandler(
  // @ts-ignore
  () => import("virtual:react-router/server-build"),
    // .then((module) => module.default),
  import.meta.env.MODE
);

const app = new Hono<{ Bindings: Env }>();

app.route('/api', api)

app.all("*", (c) => {
  return requestHandler(c.req.raw, {
    cloudflare: { env: c.env, ctx: c.executionCtx as ExecutionContext },
  });
});

export default app;

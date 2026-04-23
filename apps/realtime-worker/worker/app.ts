import { Hono } from "hono";
import { createRequestHandler } from "react-router";

import api from '../src/index'
export { GlobalStatusRoom, PageStatusRoom, ChatRoom, InteractionHub, InteractionInbox, DeviceDO } from '../src/index'
const requestHandler = createRequestHandler(
  // @ts-ignore
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE
);

const app = new Hono();

app.route('/api', api)

app.all("*", (c) => {
  return requestHandler(c.req.raw, {
    cloudflare: { env: c.env, ctx: c.executionCtx as ExecutionContext },
  });
});

export default app;

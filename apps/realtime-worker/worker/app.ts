import { Hono } from "hono";
import { createRequestHandler } from "react-router";

import api from '../src/index'
export { GlobalStatusRoom, PageStatusRoom, ChatRoom, InteractionHub, InteractionInbox, LiveListenRoom, DeviceDO } from '../src/index'
const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE
);

const _app = new Hono();

_app.route('/api', api)

_app.all("*", (c) => {
  return requestHandler(c.req.raw, {
    cloudflare: { env: c.env, ctx: c.executionCtx as ExecutionContext },
  });
});

export default _app;

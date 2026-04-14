import { Hono } from "hono";
import { createRequestHandler } from "react-router";

import app from '../src/index'
export {RealtimeRoom,InteractionHub,InteractionInbox,RealtimeSession} from '../src/index'
const requestHandler = createRequestHandler(
  // @ts-ignore
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE
);


const _app = new Hono();

_app.route('/api', app)

_app.all("*", (c) => {
  return requestHandler(c.req.raw, {
    cloudflare: { env: c.env, ctx: c.executionCtx as ExecutionContext },
  });
});



export default _app;
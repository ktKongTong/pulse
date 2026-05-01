import { Hono } from "hono";
import { createRequestHandler } from "react-router";

import api from '@/api'

export { GlobalStatusRoom, PageStatusRoom, ChatRoom, InteractionHub, InteractionInbox, LiveListenRoom, MediaRoomDO, DeviceDO } from '@/api/do'
const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE
);

const app = new Hono();

app.route('/api', api)

app.get('/:roomId', async (c, next) => {
  if (c.req.header('Upgrade') !== 'websocket') {
    return next()
  }
  const role = c.req.query('role')
  if (role !== 'producer' && role !== 'consumer') {
    return c.text('Missing or invalid role. Use ?role=producer or ?role=consumer.', 400)
  }
  const roomId = c.req.param('roomId') || 'room-test-1'
  const id = c.env.MEDIA_ROOM.idFromName(roomId)
  const stub = c.env.MEDIA_ROOM.get(id)
  const url = new URL(c.req.url)
  url.pathname = `/api/v1/media-room/${roomId}`
  url.searchParams.set('role', role)
  return stub.fetch(new Request(url, c.req.raw))
})

app.all("*", (c) => {
  return requestHandler(c.req.raw, {
    cloudflare: { env: c.env, ctx: c.executionCtx as ExecutionContext },
  });
});

export default app;

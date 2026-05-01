import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  route("api/lyrics", "routes/api.lyrics.ts"),
  index("routes/status.tsx"),
  route("media-room", "routes/media-room.tsx"),
  route("live-listen/debug", "routes/live-listen.debug.tsx"),
  route("live-listen/host", "routes/live-listen.host.tsx"),
] satisfies RouteConfig;

import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  route("api/lyrics", "routes/api.lyrics.ts"),
  route("live-listen/benchmark", "routes/live-listen.benchmark.tsx"),
  index("routes/status.tsx"),
] satisfies RouteConfig;

import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  route("api/lyrics", "routes/api.lyrics.ts"),
  index("routes/status.tsx"),
] satisfies RouteConfig;

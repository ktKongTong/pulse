import {type RouteConfig, index, route} from "@react-router/dev/routes";

export default [

  index("routes/root.tsx"),
  route('/dashboard', 'routes/dashboard.tsx'),
  route('/status', 'routes/status.tsx'),
  route('/article/:slug', 'routes/article.tsx'),
] satisfies RouteConfig;

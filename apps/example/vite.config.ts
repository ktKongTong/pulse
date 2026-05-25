import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

import { cloudflare } from "@cloudflare/vite-plugin";
// const backend = process.env.VITE_REALTIME_V2_BACKEND ?? "https://pulse.koft.fun";

export default defineConfig({
  plugins: [
    // cloudflare({
    //   viteEnvironment: { name: "ssr" },
    // }),
    tailwindcss(),
    reactRouter(),
  ],
  resolve: {
    tsconfigPaths: true,
  },
  // server: {
  //   proxy: {
  //     "/api": { target: backend, changeOrigin: true, ws: true },
  //   },
  // },
});

import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const backend = process.env.VITE_REALTIME_V2_BACKEND ?? "http://localhost:8787";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  resolve: {
    tsconfigPaths: true,
  },
  server: {
    port: 8910,
    proxy: {
      "/api": { target: backend, changeOrigin: true, ws: true },
    },
  },
});

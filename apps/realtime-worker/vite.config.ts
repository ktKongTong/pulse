import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
export default defineConfig({
  plugins: [
    cloudflare({
      viteEnvironment: { name: "ssr" },
    }),
    tailwindcss(),
    reactRouter(),
    babel({
      presets: [reactCompilerPreset()],
      plugins: ['@babel/plugin-proposal-throw-expressions'],
    }),
  ],
  resolve: {
    tsconfigPaths: true,
  },
  server: {
    port: 8900,
  },
});

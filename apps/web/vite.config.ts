import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // Same-origin in dev, so the session cookie needs no CORS or SameSite exception —
      // and the browser behaves the way it will behind a reverse proxy in production.
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
        configure: (proxy) => {
          // Default behaviour prints a multi-line AggregateError stack for EVERY request
          // while the API is down, which buries the one fact that matters. Say it once,
          // in words, with the fix.
          let warned = false;
          proxy.on("error", (error: NodeJS.ErrnoException) => {
            if (error.code !== "ECONNREFUSED" && !/ECONNREFUSED/.test(String(error))) {
              console.error(`[api proxy] ${error.message}`);
              return;
            }
            if (warned) return;
            warned = true;
            console.warn(
              "\n[api proxy] The API is not running on :3001 — every /api request will fail." +
                "\n            Stop this process and start both with:  corepack pnpm dev\n",
            );
          });
          proxy.on("proxyRes", () => {
            warned = false; // the API came back; report it again if it goes away later
          });
        },
      },
    },
  },
  resolve: {
    alias: {
      // shadcn components are authored with "@/lib/utils" style imports; they live in
      // packages/ui so there is ONE component layer, not a copy per app (ADR-019).
      "@": fileURLToPath(new URL("../../packages/ui/src", import.meta.url)),
    },
  },
});

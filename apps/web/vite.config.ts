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

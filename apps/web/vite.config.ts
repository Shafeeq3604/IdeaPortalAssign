import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import type { UserConfig } from "vite";
import type { InlineConfig } from "vitest/node";
import { defaultExclude } from "vitest/config";

/**
 * `vitest/config`'s own `defineConfig` re-exports Vite's, merged with the `test` field —
 * but its bundled type declarations pin an OLDER Vite than the one actually installed
 * here (root `vitest` is 2.1.x; this app is on vite 8), so importing it drags in a
 * second, incompatible `Plugin`/`UserConfig` and every plugin call fails to type-check
 * against it. Plain `vite`'s `defineConfig` has no `test` overload at all. Typing the
 * config object by hand with vite's OWN UserConfig plus vitest's `InlineConfig` — never
 * calling vitest/config's defineConfig — sidesteps the version clash entirely rather
 * than fighting it.
 */
type ConfigWithTest = UserConfig & { test?: InlineConfig };

// https://vite.dev/config/
const config: ConfigWithTest = {
  plugins: [react(), tailwindcss()],
  test: {
    // Only component tests need this — api-client.test.ts, query-keys.test.ts and
    // use-session.test.ts are pure logic and run fine under jsdom too, so there is no
    // need for a second, Node-only project just for them.
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    // `.deploy` is a committed `turbo prune` snapshot (see scripts/prepare-deploy.mjs)
    // that mirrors other workspace packages' source verbatim, including THEIR test
    // files — vitest picks those up too under a bare glob, and they fail: resolved
    // from the wrong depth, they can't find their own package's node_modules.
    exclude: [...defaultExclude, "**/.deploy/**"],
  },
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
};

// Not passed through defineConfig(): that call is what triggers the version clash in the
// first place (see the comment above) — it is only a type-identity helper, never
// required for Vite to actually load a config object.
export default config;

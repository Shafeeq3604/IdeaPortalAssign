import { defaultExclude, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Integration tests talk to a real PostgreSQL (see idea.integration.test.ts).
    // They read DATABASE_URL from the repo-root .env, the same file the app uses.
    env: { DATABASE_URL: process.env["DATABASE_URL"] ?? "postgresql://iep:iep@localhost:5433/iep" },
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // `.deploy` is a committed `turbo prune` snapshot (see scripts/prepare-deploy.mjs)
    // that mirrors other workspace packages' source verbatim, including THEIR test
    // files — vitest picks those up too under a bare glob, and they fail: resolved
    // from the wrong depth, they can't find their own package's node_modules.
    exclude: [...defaultExclude, "**/.deploy/**"],
  },
});

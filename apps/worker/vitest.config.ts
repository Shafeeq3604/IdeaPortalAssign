import { defaultExclude, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // `.deploy` is a committed `turbo prune` snapshot (see scripts/prepare-deploy.mjs)
    // that mirrors other workspace packages' source verbatim, including THEIR test
    // files — vitest picks those up too under a bare glob, and they fail: resolved
    // from the wrong depth, they can't find their own package's node_modules.
    exclude: [...defaultExclude, "**/.deploy/**"],
  },
});

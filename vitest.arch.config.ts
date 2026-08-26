import { defineConfig } from "vitest/config";

/** Architecture + navigation contract assertions. Runs in CI from P0 (SPEC §14). */
export default defineConfig({
  test: {
    include: ["tests/arch/**/*.test.ts"],
    environment: "node",
    reporters: ["verbose"],
  },
});

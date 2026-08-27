import { defineConfig } from "vitest/config";

/**
 * Layer 4 — BDD flows (SPEC §11.4).
 *
 * Flows, not units and not browsers: these drive real services against a real database
 * and assert the behaviour a feature file would describe. Slower than unit tests, far
 * faster and far less brittle than E2E, which is why the critical-path browser suite
 * stays at four specs.
 */
export default defineConfig({
  test: {
    include: ["specs/**/*.spec.ts"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 60_000,
    reporters: ["verbose"],
  },
});

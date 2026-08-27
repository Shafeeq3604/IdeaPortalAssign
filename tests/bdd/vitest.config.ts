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

    /**
     * ONE FILE AT A TIME. These share a real database.
     *
     * A ranking recompute is cohort-wide by definition, so a spec that recomputes sweeps
     * up every other spec's ideas — and if another file is deleting its fixtures at that
     * moment, the run inserts entries against rows that are on their way out. It surfaced
     * as an opaque Prisma error that vanished when the file ran alone, which is the worst
     * kind of flake to inherit.
     *
     * The E2E config made the same call for the same reason (SPEC §11.5).
     */
    fileParallelism: false,
  },
});

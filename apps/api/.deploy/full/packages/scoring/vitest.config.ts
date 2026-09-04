import { defineConfig } from "vitest/config";

/**
 * SPEC §11.1: the engine carries a 100% branch gate. It is pure, so there is no excuse —
 * and this is the package where a wrong answer silently skews every rank (risk R1).
 */
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/index.ts", "src/types.ts"],
      thresholds: { branches: 100, functions: 100, lines: 95, statements: 95 },
      reporter: ["text"],
    },
  },
});

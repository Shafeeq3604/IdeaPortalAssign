import { defineConfig, devices } from "@playwright/test";

/**
 * E2E — CRITICAL PATHS ONLY (SPEC §11.5).
 *
 * Four journeys, one browser, budget ≤6 minutes. A large E2E suite is a slow, flaky
 * suite that gets skipped, so a fifth spec means removing one.
 *
 * These run against a stack that is ALREADY UP (`pnpm deps:up && pnpm dev`). Booting the
 * stack from inside the test hides failures in the boot itself, which is exactly where
 * two real bugs have already been found.
 */
export default defineConfig({
  testDir: "./specs",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false, // shared database; parallel writes would make failures unreadable
  workers: 1,
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"] ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: process.env["E2E_BASE_URL"] ?? "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});

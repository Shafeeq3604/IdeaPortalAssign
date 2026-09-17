import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Restores the demo dataset after every e2e run, pass or fail.
 *
 * `playwright.config.ts` runs this suite against the same database `pnpm dev` uses —
 * documented there as deliberate ("shared database; parallel writes would make failures
 * unreadable"), not something this teardown changes. What it fixes is the actual
 * recurring problem: every run leaves real rows behind (ideas submitted by J-1, votes
 * cast by J-1/J-3, review decisions and score overrides from J-2, ranking runs from
 * every recompute), and nothing was ever restoring them — someone had to notice the
 * board looked wrong and run `pnpm demo:reset` by hand. This is that step, run for you,
 * every time, so the shared-database trade-off stops meaning "e2e quietly corrupts the
 * environment everyone else is looking at."
 *
 * `pnpm demo:reset` already IS the correct, idempotent fix for this (`--fresh` wipe →
 * reseed the 8 canonical ideas → re-analyse/re-rank) — this only wires it to run
 * automatically where it was previously a manual chore.
 */
export default async function globalTeardown(): Promise<void> {
  const repoRoot = path.resolve(fileURLToPath(import.meta.url), "../../..");

  await new Promise<void>((resolve) => {
    const child = spawn("pnpm", ["demo:reset"], {
      cwd: repoRoot,
      shell: true,
      stdio: "inherit",
    });

    // A failed reset must never fail the TEST RUN itself — the tests already reported
    // their own pass/fail, and losing that signal behind a cleanup-script exit code
    // would hide a real failure behind an unrelated one. Log and move on.
    child.on("error", (err) => {
      console.error(`[global-teardown] could not start "pnpm demo:reset": ${err.message}`);
      resolve();
    });
    child.on("close", (code) => {
      if (code !== 0) {
        console.error(`[global-teardown] "pnpm demo:reset" exited with code ${code} — the demo dataset may need a manual reset.`);
      }
      resolve();
    });
  });
}

#!/usr/bin/env node
/**
 * Regenerates apps/{api,worker,web}/.deploy/ — a `turbo prune --docker` snapshot of
 * exactly what each service needs (its own source plus the workspace packages it
 * depends on, transitively), committed inside that service's own directory.
 *
 * Why this exists: Validra builds each Dockerfile using that service's own directory
 * as the Docker build context — it does not use the repo root, so `COPY . .` inside
 * apps/api/Dockerfile cannot see pnpm-lock.yaml or packages/contracts, packages/db,
 * etc. at the repo root; Docker refuses to COPY anything from outside the build
 * context, in any image, on any platform. Committing a pruned mirror *inside* each
 * service's own directory is the only way to give that restricted context everything
 * the build needs.
 *
 * Prunes into a scratch directory OUTSIDE the repo, then moves each result into place
 * as a final step. Pruning straight into apps/<service>/.deploy one service at a time
 * does not work: a service's dependency graph can (and does, via this workspace's own
 * root package.json) pull in another app's source, so the second prune sees the first
 * one's already-written .deploy sitting on disk and copies it in as "source", nesting a
 * stale snapshot inside the new one — verified directly, not assumed: it produced a
 * buildkit "invalid file request" error pointing at a doubly-nested
 * apps/web/.deploy/full/apps/web/.deploy path. Nothing under apps/*\/.deploy exists
 * anywhere in the repo tree until every prune has already finished.
 *
 * Run this — and commit the result — after any change to pnpm-lock.yaml or to a
 * workspace package a service depends on (packages/contracts, packages/db, etc.).
 * `pnpm run preflight` (scripts/preflight-docker.mjs) catches a stale snapshot: it
 * builds every Dockerfile with the exact restricted context Validra uses.
 */
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SERVICES = ["api", "worker", "web"];

/**
 * Root-level files every workspace package's tsconfig reaches for via `../../<file>`
 * that `turbo prune` does not copy on its own — it only follows the package.json
 * dependency graph, not arbitrary `extends` targets outside any package. Add to this
 * list if a future tsconfig starts extending some other shared root file.
 */
const ROOT_FILES_EVERY_PACKAGE_NEEDS = ["tsconfig.base.json"];

// Delete every EXISTING real .deploy first — including ones belonging to services not
// being pruned this run. A leftover from a previous run is just as much "source files
// under apps/worker" to turbo's filesystem walk as anything else there, and gets
// swept into a fresh prune the same way a same-run leftover would.
for (const service of SERVICES) {
  const outDir = `apps/${service}/.deploy`;
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
}

const staging = mkdtempSync(join(tmpdir(), "iep-deploy-prune-"));

for (const service of SERVICES) {
  const stageDir = join(staging, service);
  console.log(`\n▶ Pruning @iep/${service} → ${stageDir}`);
  execSync(`pnpm exec turbo prune @iep/${service} --docker --out-dir="${stageDir}"`, {
    stdio: "inherit",
  });
  for (const file of ROOT_FILES_EVERY_PACKAGE_NEEDS) {
    copyFileSync(file, join(stageDir, "full", file));
  }
}

for (const service of SERVICES) {
  const outDir = `apps/${service}/.deploy`;
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
  renameSync(join(staging, service), outDir);
}
rmSync(staging, { recursive: true, force: true });

console.log("\nDone. Review with `git status`, then commit apps/*/.deploy.");

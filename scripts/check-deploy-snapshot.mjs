#!/usr/bin/env node
/**
 * Fails loudly if a committed apps/<service>/.deploy snapshot no longer matches what
 * `pnpm run deploy:prune` would produce right now — the gate for the failure mode where
 * apps/web/Dockerfile (and api/worker) build .deploy/full/apps/<service>/src, someone
 * edits the real apps/<service>/src, and the image silently keeps shipping the old code.
 *
 * Regenerates each service into a scratch dir with the exact same `turbo prune --docker`
 * call scripts/prepare-deploy.mjs uses, then diffs it against the committed apps/<service>/
 * .deploy. Confirmed directly (ran twice, diffed the two outputs) that `turbo prune` is
 * byte-deterministic, so any difference here means the committed snapshot is real drift,
 * not run-to-run noise. Comparing full trees this way — rather than hand-walking each
 * service's package.json deps — also automatically covers what turbo prune itself pulls
 * in from the root package.json (e.g. apps/api's and apps/web's snapshots both carry
 * @iep/worker, because the root package.json depends on it, not because api/web do).
 *
 * ~1-2s per service, so this runs on every PR. `pnpm run preflight` (actual Docker builds
 * of all three services) stays a separate, slower check for nightly/pre-release use.
 */
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const SERVICES = ["api", "worker", "web"];

// Kept in sync with scripts/prepare-deploy.mjs's own list by hand — both exist only
// because `turbo prune` doesn't follow tsconfig `extends` targets outside any package.
const ROOT_FILES_EVERY_PACKAGE_NEEDS = ["tsconfig.base.json"];

// The real apps/*/.deploy directories are left in place while pruning (renaming them
// aside first was tried and hit OneDrive locking the directory against rename — see
// scripts/preflight-docker.mjs's header for the same OneDrive interference on this repo).
// Left in place, `turbo prune` copies each committed .deploy as if it were ordinary
// source, nesting a stale copy inside the fresh output — the same nesting failure mode
// scripts/prepare-deploy.mjs's header documents. Since that nested copy is never real
// source, any directory literally named ".deploy" is skipped while walking, on both
// sides, so it never enters the comparison.
function listFilesRecursive(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name === ".deploy") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(full));
    else out.push(full);
  }
  return out;
}

function diffDirs(committedDir, freshDir) {
  if (!existsSync(committedDir)) return [`${committedDir} does not exist`];

  const committedFiles = new Set(listFilesRecursive(committedDir).map((f) => relative(committedDir, f)));
  const freshFiles = new Set(listFilesRecursive(freshDir).map((f) => relative(freshDir, f)));

  const diffs = [];
  for (const rel of committedFiles) {
    if (!freshFiles.has(rel)) {
      diffs.push(`only in committed snapshot: ${rel}`);
      continue;
    }
    const a = readFileSync(join(committedDir, rel));
    const b = readFileSync(join(freshDir, rel));
    if (!a.equals(b)) diffs.push(`content differs: ${rel}`);
  }
  for (const rel of freshFiles) {
    if (!committedFiles.has(rel)) diffs.push(`missing from committed snapshot: ${rel}`);
  }
  return diffs;
}

const staging = mkdtempSync(join(tmpdir(), "iep-deploy-check-"));
const stale = [];

try {
  for (const service of SERVICES) {
    const stageDir = join(staging, service);
    execSync(`pnpm exec turbo prune @iep/${service} --docker --out-dir="${stageDir}"`, {
      stdio: ["ignore", "ignore", "inherit"],
    });
    for (const file of ROOT_FILES_EVERY_PACKAGE_NEEDS) {
      copyFileSync(file, join(stageDir, "full", file));
    }
  }

  for (const service of SERVICES) {
    const committedDir = `apps/${service}/.deploy`;
    if (!existsSync(committedDir)) {
      stale.push({ service, diffs: [`${committedDir} does not exist`] });
      continue;
    }
    const diffs = diffDirs(committedDir, join(staging, service));
    if (diffs.length > 0) stale.push({ service, diffs });
  }
} finally {
  rmSync(staging, { recursive: true, force: true });
}

if (stale.length === 0) {
  console.log(`✓ apps/*/.deploy snapshots match real source for: ${SERVICES.join(", ")}`);
  process.exit(0);
}

console.error("✗ Stale deploy snapshot — the Docker build for the affected service(s) is NOT building your latest code.\n");
for (const { service, diffs } of stale) {
  console.error(`  apps/${service}/.deploy is stale (${diffs.length} difference${diffs.length === 1 ? "" : "s"}):`);
  for (const d of diffs.slice(0, 10)) console.error(`    - ${d}`);
  if (diffs.length > 10) console.error(`    ... and ${diffs.length - 10} more`);
  console.error("");
}
console.error("Fix: pnpm run deploy:prune && git add apps/*/.deploy");
process.exit(1);

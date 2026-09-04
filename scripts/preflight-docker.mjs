#!/usr/bin/env node
/**
 * Builds every service Dockerfile using ONLY that service's own directory as the
 * Docker build context — deliberately, not the repo root. This is the exact
 * constraint Validra builds under (confirmed against real Validra build logs: it
 * invokes `docker build` scoped to each service's own directory, not the monorepo
 * root), so a green run here means Validra's build step will not hit
 * ERR_PNPM_NO_LOCKFILE or a missing-workspace-package error — the two failure modes
 * this script exists to catch before a push, not after a failed cloud deploy.
 *
 * Builds from a COPY of apps/<service> staged outside this repo's own tree, not the
 * repo in place — this repo lives inside a OneDrive-synced folder, and OneDrive's
 * Files On-Demand can leave a source file as a cloud placeholder (a reparse point
 * that reports a normal size but has no local content yet). Docker's build-context
 * transfer cannot read through that and fails with "invalid file request" — verified
 * directly: `Get-Item` on the exact failing file showed the ReparsePoint attribute,
 * and the failure persisted across repeated builds until staged through a real,
 * dereferencing copy. Validra itself never hits this — it clones straight from Azure
 * DevOps into a plain Linux build environment with no OneDrive involved — so this is
 * a local-preflight reliability fix, not a change to what actually gets deployed.
 *
 * Requires apps/*\/.deploy to be up to date — run `pnpm run deploy:prune` first if
 * pnpm-lock.yaml or a workspace package a service depends on has changed since the
 * last prune.
 */
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SERVICES = ["api", "worker", "web"];
const results = [];
const staging = mkdtempSync(join(tmpdir(), "iep-preflight-"));

for (const service of SERVICES) {
  const dir = `apps/${service}`;
  const deployDir = `${dir}/.deploy`;
  const tag = `iep-preflight-${service}`;
  const stageDir = join(staging, service);

  console.log(`\n${"=".repeat(70)}\n▶ ${service}: docker build -f Dockerfile ${stageDir}\n${"=".repeat(70)}`);

  if (!existsSync(deployDir)) {
    console.error(`✗ ${deployDir} is missing — run \`pnpm run deploy:prune\` first.`);
    results.push({ service, ok: false, reason: "missing .deploy snapshot" });
    continue;
  }

  // `dereference: true` is the actual fix — it reads through a OneDrive placeholder's
  // reparse point and copies real bytes, instead of propagating the reparse point the
  // way a plain filesystem copy (including turbo prune's own) does.
  cpSync(dir, stageDir, { recursive: true, dereference: true });

  try {
    execSync(`docker build -f Dockerfile -t ${tag} .`, { cwd: stageDir, stdio: "inherit" });
    results.push({ service, ok: true });
  } catch {
    results.push({ service, ok: false, reason: "docker build failed" });
  }
}

rmSync(staging, { recursive: true, force: true });

console.log(`\n${"=".repeat(70)}\nPreflight summary (context restricted to each service's own directory)\n${"=".repeat(70)}`);
for (const r of results) {
  console.log(r.ok ? `✓ ${r.service}` : `✗ ${r.service} — ${r.reason}`);
}

if (results.some((r) => !r.ok)) process.exit(1);

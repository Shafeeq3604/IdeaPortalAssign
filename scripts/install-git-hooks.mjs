#!/usr/bin/env node
/**
 * Installs a pre-push hook that runs `pnpm run deploy:check` — the gate that catches a
 * stale apps/*\/.deploy Docker snapshot before it ships. Runs as the root "prepare"
 * script on every `pnpm install`, the same mechanism tools like husky use, so the hook
 * is present for every contributor without a separate manual step.
 *
 * No hook manager (husky/lefthook/simple-git-hooks) was already in this repo, so this
 * is a plain hand-rolled installer rather than a new dependency — it only ever needs to
 * write one file.
 *
 * A no-op, not a failure, when there's no .git to install into: `pnpm install` also runs
 * inside apps/*\/.deploy's own pruned copy (no .git there) and inside the Docker build
 * (no .git in the image at all).
 */
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const gitDir = ".git";
if (!existsSync(gitDir)) process.exit(0);

const hooksDir = join(gitDir, "hooks");
mkdirSync(hooksDir, { recursive: true });

const hookPath = join(hooksDir, "pre-push");
const hookBody = `#!/bin/sh
# Installed by scripts/install-git-hooks.mjs (root "prepare" script). Do not edit by
# hand — edit that script and re-run \`pnpm install\` instead.
pnpm run deploy:check
`;

writeFileSync(hookPath, hookBody);
try {
  chmodSync(hookPath, 0o755);
} catch {
  // chmod is a no-op on Windows filesystems without POSIX permission bits; Git for
  // Windows' bundled sh.exe runs the hook from its shebang regardless.
}

console.log(`✓ installed pre-push hook: ${hookPath}`);

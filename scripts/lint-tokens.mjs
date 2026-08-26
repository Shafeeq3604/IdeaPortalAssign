#!/usr/bin/env node
/**
 * `pnpm lint:tokens` — SPEC §7.6 enforcement.
 *
 * "One component layer, no one-offs" is a convention with no teeth unless something
 * fails the build. This is that something (D-09a: the library changed, the rule did not).
 *
 * Fails when apps/web/src/features/** contains:
 *   - a raw hex colour
 *   - a raw px value that is not a token reference
 *   - a bare <button>/<input>/<select>/<textarea> not imported from @iep/ui
 *   - a hardcoded animation duration instead of a --dur-* token
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const TARGET = join(ROOT, "apps", "web", "src", "features");

const RULES = [
  { id: "raw-hex", re: /#[0-9a-fA-F]{3,8}\b/g,
    msg: "raw hex colour — use a colour token from @iep/ui/tokens.css" },
  { id: "raw-px", re: /(?<!--[\w-]{0,40}:\s?)(?<![\w-])\d+px\b/g,
    msg: "raw px value — use a --sp-* / --r-* / --fs-* token" },
  { id: "bare-control", re: /<(button|input|select|textarea)[\s>]/g,
    msg: "bare form control — import it from @iep/ui (shadcn baseline, ADR-019)" },
  { id: "raw-duration", re: /(?:transition|animation)(?:-duration)?\s*:\s*[^;]*\b\d+m?s\b/g,
    msg: "hardcoded duration — use a --dur-* token and the named transition (SPEC §8.3)" },
];

const skip = new Set(["node_modules", "dist", ".turbo", "coverage"]);

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (skip.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|css|scss)$/.test(full)) out.push(full);
  }
  return out;
}

const files = walk(TARGET);
if (files.length === 0) {
  console.log("lint:tokens — no feature code yet (apps/web lands in P1). OK.");
  process.exit(0);
}

let failures = 0;
for (const file of files) {
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");
  for (const rule of RULES) {
    lines.forEach((line, i) => {
      if (line.includes("lint-tokens-ignore")) return;
      const m = line.match(rule.re);
      if (m) {
        failures++;
        const path = relative(ROOT, file).split(sep).join("/");
        console.error(`${path}:${i + 1}  [${rule.id}]  ${rule.msg}\n    ${line.trim()}`);
      }
    });
  }
}

if (failures > 0) {
  console.error(`\nlint:tokens — ${failures} violation(s). See SPEC §7.6.`);
  process.exit(1);
}
console.log(`lint:tokens — ${files.length} file(s) clean.`);

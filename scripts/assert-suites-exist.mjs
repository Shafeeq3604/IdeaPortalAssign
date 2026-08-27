#!/usr/bin/env node
/**
 * Fail when a test suite is empty.
 *
 * `pnpm test:bdd` and `pnpm test:e2e` both reported PASS while `tests/e2e` and the BDD
 * specs were empty directories — turbo happily succeeds at running nothing. A green tick
 * for a suite that does not exist is worse than a red one: P2 was marked done partly on
 * the strength of those two ticks.
 *
 * Usage: node scripts/assert-suites-exist.mjs <label> <dir> <pattern>
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const [, , label, dir, pattern] = process.argv;
const ROOT = join(import.meta.dirname, "..");
const re = new RegExp(pattern ?? "\\.(spec|test|feature)\\.[cm]?[jt]sx?$");

function count(current) {
  let total = 0;
  let entries;
  try {
    entries = readdirSync(current);
  } catch {
    return 0;
  }
  for (const name of entries) {
    if (name === "node_modules") continue;
    const full = join(current, name);
    if (statSync(full).isDirectory()) total += count(full);
    else if (re.test(name)) total += 1;
  }
  return total;
}

const found = count(join(ROOT, dir));

if (found === 0) {
  console.error(
    `\n${label}: NO SPECS FOUND in ${dir}\n` +
      `  This is a failure, not an empty pass. Either write the suite, or remove the\n` +
      `  command so nothing reports success for work that does not exist.\n`,
  );
  process.exit(1);
}

console.log(`${label}: ${found} spec file(s) found in ${dir}`);

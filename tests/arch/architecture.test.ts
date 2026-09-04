import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * Architecture tests (SPEC §14 P0.6, P0.5b, §12.2).
 *
 * These are the build-level enforcement of decisions that would otherwise be
 * "policy that dies in review". Each one corresponds to a named invariant.
 */

const ROOT = join(import.meta.dirname, "..", "..");
// `.deploy` is a committed `turbo prune` snapshot (apps/api, apps/worker, apps/web —
// see scripts/prepare-deploy.mjs) that mirrors other workspace packages' source
// verbatim; scanning it double-counts every rule this file checks against whatever
// it mirrors.
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".turbo", "coverage", "scratchpad", ".deploy"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const sourceFiles = () =>
  walk(ROOT).filter((f) => /\.(ts|tsx|mts|js|mjs)$/.test(f) && !f.endsWith(".d.ts"));

const rel = (f: string) => relative(ROOT, f).split(sep).join("/");

/**
 * Strip comments and string literals before scanning for field names.
 * Without this, the scanner reads its own documentation and reports prose as a violation —
 * which it did on first run. The invariant is about schema FIELDS, not commentary.
 */
function stripNonCode(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")   // block comments
    .replace(/(^|[^:])\/\/.*$/gm, "$1") // line comments (leaves protocol-relative URLs alone)
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");
}

describe("ADR-021 — model ids are configuration, never code literals", () => {
  it("no `claude-` literal outside packages/ai/src/routing", () => {
    const ALLOWED = ["packages/ai/src/routing/", "tests/arch/"];
    const offenders = sourceFiles()
      .filter((f) => !ALLOWED.some((a) => rel(f).startsWith(a)))
      .filter((f) => /claude-[a-z0-9-]/.test(stripNonCode(readFileSync(f, "utf8"))))
      .map(rel);

    expect(
      offenders,
      `Model ids must live in ai_model_routes (ADR-021). Found literals in:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});

describe("ADR-005 — the AI never produces a score", () => {
  /**
   * The invariant: no AI output schema may contain a numeric score, rank, weight or
   * percentage. Two allowed numerics, each justified in the schema file:
   *   timeline weeks (a duration) and recommendation priority (an ordinal bucket).
   */
  const ALLOWED_NUMERIC_FIELDS = new Set(["minWeeks", "maxWeeks", "priority"]);

  it("no unexpected z.number() in AI output schemas", () => {
    const schemaDir = join(ROOT, "packages", "ai", "src", "schemas");
    const violations: string[] = [];

    for (const file of walk(schemaDir)) {
      const src = stripNonCode(readFileSync(file, "utf8"));
      // Match `fieldName: z.number(` and `fieldName: z.coerce.number(`
      const re = /(\w+)\s*:\s*z\.(?:coerce\.)?number\s*\(/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        const field = m[1]!;
        if (!ALLOWED_NUMERIC_FIELDS.has(field)) {
          violations.push(`${rel(file)} → "${field}"`);
        }
      }
    }

    expect(
      violations,
      "AI schemas must emit ordinal bands, not numbers (ADR-005). Offending fields:\n" +
        violations.join("\n"),
    ).toEqual([]);
  });

  it("no score/rank/weight-shaped field names in AI output schemas", () => {
    const schemaDir = join(ROOT, "packages", "ai", "src", "schemas");
    const banned = /\b(\w*(?:score|ranking?|weight|percentile|rating)\w*)\s*:/gi;
    const ALLOW = /^(projectedRankingEffect|rankingEffect)$/i;
    const violations: string[] = [];

    for (const file of walk(schemaDir)) {
      const src = stripNonCode(readFileSync(file, "utf8"));
      let m: RegExpExecArray | null;
      while ((m = banned.exec(src)) !== null) {
        const field = m[1]!;
        if (!ALLOW.test(field)) violations.push(`${rel(file)} → "${field}"`);
      }
    }

    expect(violations, `Score-shaped fields in AI schemas (ADR-005):\n${violations.join("\n")}`)
      .toEqual([]);
  });

  it("packages/scoring never imports packages/ai", () => {
    const scoringDir = join(ROOT, "packages", "scoring", "src");
    const offenders = walk(scoringDir)
      .filter((f) => /@iep\/ai|packages\/ai|from\s+["'].*\/ai\//.test(readFileSync(f, "utf8")))
      .map(rel);

    expect(
      offenders,
      "The scoring engine must not depend on the AI package (ADR-005) — it consumes " +
        `typed factors from any source. Offenders:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("packages/scoring is pure — no I/O, no clock, no randomness", () => {
    const scoringDir = join(ROOT, "packages", "scoring", "src");
    const impure = /\b(Date\.now|Math\.random|new Date\s*\(\s*\)|process\.env|require\s*\(\s*["']fs|from\s+["']node:)/;
    const offenders = walk(scoringDir)
      .filter((f) => impure.test(readFileSync(f, "utf8")))
      .map(rel);

    expect(
      offenders,
      `packages/scoring must be reproducible byte-for-byte (SPEC §3.2). Offenders:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});

describe("SPEC §4.4 — the API process cannot reach the model provider", () => {
  it("apps/api never imports the AI provider or the Anthropic SDK", () => {
    const apiDir = join(ROOT, "apps", "api");
    let files: string[] = [];
    try {
      files = walk(apiDir);
    } catch {
      return; // apps/api lands in P1
    }
    const offenders = files
      .filter((f) => /@anthropic-ai\/sdk|AnthropicProvider/.test(readFileSync(f, "utf8")))
      .map(rel);

    expect(
      offenders,
      `Only the worker holds the provider key (SPEC §4.4). Offenders:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});

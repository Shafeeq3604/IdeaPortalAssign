import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * Provenance & determinacy tests (SPEC §7.4, §8.4).
 *
 * SPEC §7.4 calls the AI treatment "a contract, not a style", and says rendering an
 * AI-sourced field outside `<Provenance>` fails a test. This is that test — without it,
 * the sentence in the SPEC is a wish.
 *
 * P2 taught the lesson these encode: an invariant that is only true because the person
 * who wrote the page remembered it is not an invariant. It is a habit, and habits do not
 * survive the next slice.
 */

const ROOT = join(import.meta.dirname, "..", "..");
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".turbo", "coverage", "scratchpad"]);

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const rel = (f: string) => relative(ROOT, f).split(sep).join("/");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("SPEC §7.4 — the AI provenance treatment is a contract, not a style", () => {
  it("exactly one component owns the AI surface treatment", () => {
    /**
     * The treatment is `--ai-surface` + `--ai-border`. If a feature file paints those
     * itself, there are now two implementations of a contract — and the second one will
     * quietly drift, which is precisely how "AI-generated" stops meaning anything.
     */
    /**
     * The one exemption is the token gallery on `/_theme`, which exists to SHOW every
     * token as a swatch. It renders no AI content, so exempting it does not weaken the
     * rule — but it is named here rather than pattern-matched, so a second exemption has
     * to be argued for in a diff.
     */
    const EXEMPT = ["apps/web/src/components/ThemeCheck.tsx"];

    const offenders = walk(join(ROOT, "apps"))
      .filter((f) => /\.(tsx?|css)$/.test(f))
      .filter((f) => !EXEMPT.includes(rel(f)))
      .filter((f) => /ai-surface|ai-border/.test(readFileSync(f, "utf8")))
      .map(rel);

    expect(
      offenders,
      `Only packages/ui/src/components/iep/analysis.tsx may render the AI treatment.\n` +
        `Import <Provenance> instead. Offenders:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("every card on the Analysis tab declares where its content came from", () => {
    /**
     * Every card body on that page shows AI-derived content, so every card body must
     * contain a `<Provenance>`. Adding a seventh AI card without the wrapper fails here
     * rather than shipping unlabelled machine output.
     */
    const src = read("apps/web/src/features/analysis/AnalysisTab.tsx");
    const bodies = src.split("<CardContent").slice(1).map((chunk) => chunk.split("</CardContent>")[0] ?? "");

    expect(bodies.length, "the Analysis tab should render several cards").toBeGreaterThan(3);

    const unwrapped = bodies.filter((body) => !body.includes("<Provenance"));
    expect(
      unwrapped.length,
      `${unwrapped.length} card body/bodies on the Analysis tab render content without ` +
        `<Provenance>. SPEC §7.4 forbids it.`,
    ).toBe(0);
  });

  it("the analysis response carries provenance on every AI-derived block", () => {
    // The client cannot label what the API did not tell it. This is the other half of
    // the same contract, asserted where it is defined.
    const src = read("packages/contracts/src/schemas/analysis.ts");
    for (const block of ["StructuredProposal", "FeasibilityAssessment", "ImplementationPlan"]) {
      const body = src.split(`export const ${block} = z.object({`)[1]?.split("});")[0] ?? "";
      expect(body, `${block} must carry provenance`).toContain("provenance: Provenance");
    }
  });
});

describe("SPEC §8.4 — the analysis stepper is determinate and honest", () => {
  const progress = () => read("apps/web/src/features/analysis/AnalysisProgress.tsx");

  it("all six steps come from the contract, not from whatever the run has produced", () => {
    /**
     * A stepper built by mapping the response's `steps` array grows as steps start. That
     * is an indeterminate progress bar wearing a determinate costume: the total is
     * unknown until the end, which is the exact thing §8.4 rules out.
     */
    const src = progress();
    expect(src, "the step list must be driven by PIPELINE_STEPS").toContain("PIPELINE_STEPS.map");
    expect(src, "the step list must not be built from the response array").not.toMatch(
      /\.data\??\.steps\.map|steps\.map\(/,
    );
  });

  it("no synthetic percentage anywhere in the progress UI", () => {
    // "No synthetic percentage" (§8.4). Real counts of real steps only.
    const combined = progress() + read("packages/ui/src/components/iep/analysis.tsx");
    expect(combined).not.toMatch(/Math\.round\([^)]*\/\s*(?:steps|total)[^)]*\*\s*100/);
    expect(combined).not.toMatch(/percent(?:age)?\s*[:=]/i);
  });

  it("a fallback step is never presented as a clean success", () => {
    // SPEC §9.3: a step that fell back must say what the fallback supplied. The stepper
    // shows SUCCEEDED for it — correctly, the run produced a usable result — so the
    // caveat has to ride along in the detail line.
    expect(progress()).toMatch(/usedFallback[\s\S]{0,200}without AI/);
  });
});

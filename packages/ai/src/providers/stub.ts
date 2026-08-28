import type { AiProvider, AiRequest, AiResult } from "../provider.js";
import { estimateCostUsd } from "../routing/routes.js";

/**
 * StubProvider — deterministic, offline, free.
 *
 * Every unit, integration, BDD and E2E test uses this. No test spends a token, and no
 * test result depends on what a model happened to say that day (SKILL.md §2.2).
 *
 * It returns plausible, schema-valid output derived from the submission itself, so the
 * pipeline downstream of it is exercised for real — the shapes, the persistence, the
 * scoring handoff. What it does NOT do is judge anything; it is scaffolding, not a model.
 */

/** Deterministic pseudo-randomness from the input, so the same idea always stubs alike. */
function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

const pick = <T>(items: readonly T[], seed: number, salt: number): T =>
  items[(seed + salt) % items.length]!;

/**
 * The FULL band range, not a comfortable middle three.
 *
 * The first version offered LOW/MODERATE/HIGH only. Averaged across nine value
 * dimensions that lands every stubbed idea near 50, which — once the effort criterion
 * inverts — puts every one of them above the attention threshold. The consequence was
 * that no stubbed idea could ever be weak, so the entire improvement path (FR-15) was
 * unreachable in development and in every test that did not hand-build its own rows.
 *
 * A stub that can only produce healthy output is not a stand-in; it is a happy path.
 */
const BANDS = ["NEGLIGIBLE", "LOW", "MODERATE", "HIGH", "VERY_HIGH"] as const;
const VALUE_DIMENSIONS = [
  "BUSINESS_IMPACT", "PRODUCTIVITY", "COST_REDUCTION", "REVENUE", "EMPLOYEE_EXPERIENCE",
  "CUSTOMER_IMPACT", "OPERATIONAL", "PROBLEM_SEVERITY", "PROBLEM_FREQUENCY",
] as const;
const FEASIBILITY_DIMENSIONS = [
  "TECHNICAL", "DATA", "INFRASTRUCTURE", "INTEGRATION", "SECURITY", "PRIVACY",
  "COMPLIANCE", "EXPERTISE", "RESOURCES", "COST", "EXTERNAL_DEPENDENCY",
] as const;

/** First sentence of the submission, so stub evidence is grounded in the real text. */
function firstSentence(text: string): string {
  const s = text.split(/(?<=[.!?])\s/)[0]?.trim() ?? text.slice(0, 120);
  return s.length > 8 ? s : "Stated in the submission.";
}

export class StubProvider implements AiProvider {
  readonly name = "stub" as const;

  complete<T>(request: AiRequest): Promise<AiResult<T>> {
    const source = request.untrustedIdeaText;
    const seed = seedFrom(source);
    const cite = firstSentence(source);
    const data = this.buildFor(request.storyKey, seed, cite) as T;

    // Realistic-looking usage so budget accounting is exercised without a live call.
    const inputTokens = Math.max(200, Math.round(source.length / 4) + 500);
    const outputTokens = 400 + (seed % 300);

    return Promise.resolve({
      ok: true,
      data,
      usage: {
        inputTokens,
        outputTokens,
        cachedInputTokens: Math.round(inputTokens * 0.6),
        costUsd: estimateCostUsd(request.route.tier, inputTokens, outputTokens),
      },
      model: `stub:${request.route.modelId}`,
      tier: request.route.tier,
    });
  }

  private buildFor(storyKey: string, seed: number, cite: string): unknown {
    switch (storyKey) {
      case "STRUCTURE":
        return {
          problemStatement: `The submission describes a recurring problem. ${cite}`,
          proposedSolution: "A system that automates the described manual step.",
          targetUsers: "The people who perform the task today, and those who review it.",
          assumptions: ["The described process happens often enough to be worth automating."],
          missingInformation: ["How many times per month does this occur?"],
          clarificationQuestions: ["Roughly how long does the manual step take today?"],
        };

      case "USE_CASES":
        return {
          useCases: [
            {
              kind: "DIRECT", horizon: "SHORT",
              title: "Automate the described task",
              description: "Handle the routine case end to end.",
              departmentScope: ["Operations"],
              estimatedUserCountBand: pick(["B100_1K", "B1K_10K"] as const, seed, 1),
              isSpeculative: false,
              evidence: [cite],
            },
            {
              kind: "INDIRECT", horizon: "MEDIUM",
              title: "Reuse the same capability elsewhere",
              description: "Apply the approach to an adjacent process.",
              departmentScope: ["Finance"],
              estimatedUserCountBand: "B10_100",
              isSpeculative: true,
              evidence: [cite],
            },
          ],
        };

      case "VALUE":
        return {
          findings: VALUE_DIMENSIONS.map((dimension, i) => ({
            dimension,
            band: pick(BANDS, seed, i),
            rationale: "Assessed from the described problem and its stated frequency.",
            evidence: [cite],
          })),
        };

      case "FEASIBILITY":
        return {
          // The stub NEVER returns NOT_CURRENTLY_FEASIBLE. That verdict requires real
          // organisational constraints (FR-06) and a stub has none to cite.
          status: pick(
            ["HIGHLY_FEASIBLE", "FEASIBLE_WITH_CONDITIONS", "REQUIRES_INVESTIGATION"] as const,
            seed, 2,
          ),
          summary: "Appears buildable with existing capabilities, subject to confirmation.",
          constraintCitations: [],
          findings: FEASIBILITY_DIMENSIONS.slice(0, 5).map((dimension, i) => ({
            dimension,
            band: pick(BANDS, seed, i + 3),
            finding: "No obvious blocker identified from the submission alone.",
            condition: i === 0 ? "Confirm the data source is accessible." : null,
            evidence: [cite],
          })),
        };

      case "RISK":
        return {
          risks: [
            {
              category: "ADOPTION",
              description: "People may keep using the manual workaround.",
              level: "MEDIUM",
              potentialImpact: "The expected time saving does not materialise.",
              mitigation: "Pilot with one team and measure actual usage before rollout.",
              evidence: [cite],
            },
            {
              category: "DATA",
              description: "Input quality may be worse than assumed.",
              level: pick(["LOW", "MEDIUM"] as const, seed, 4),
              potentialImpact: "Higher error rate than the manual process it replaces.",
              mitigation: "Measure accuracy on a sample before switching over.",
              evidence: [cite],
            },
          ],
          dependencies: [
            { kind: "INTERNAL", description: "Access to the system that holds the source data.", blocking: false },
          ],
        };

      case "EFFORT_TIMELINE":
        return {
          // VERY_HIGH included for the same reason as the bands above: an expensive,
          // slow idea has to be reachable or nothing downstream of it is ever exercised.
          effortClass: pick(["LOW", "MEDIUM", "HIGH", "VERY_HIGH"] as const, seed, 5),
          costClass: pick(["LOW", "MEDIUM", "HIGH", "VERY_HIGH"] as const, seed, 6),
          operationalComplexity: "MEDIUM",
          notes: "Estimated from the described scope; no detailed design exists yet.",
          requirements: [
            { kind: "PEOPLE", item: "One engineer", detail: "For the build and handover.", isMandatory: true },
            { kind: "TECHNOLOGY", item: "Access to the source system", detail: null, isMandatory: true },
            { kind: "ORG", item: "Owner sign-off", detail: "From the team that runs the process today.", isMandatory: true },
          ],
          timeline: [
            { phase: "DISCOVERY", minWeeks: 1, maxWeeks: 2 },
            { phase: "PROTOTYPE", minWeeks: 2, maxWeeks: 4 },
            { phase: "MVP", minWeeks: 4, maxWeeks: 8 },
            { phase: "TESTING", minWeeks: 1, maxWeeks: 2 },
            { phase: "DEPLOYMENT", minWeeks: 1, maxWeeks: 2 },
          ],
          evidence: [cite],
        };

      case "EXPLANATION":
        return {
          summary: "This idea ranks where it does because of the factors listed below.",
          strengthsProse: ["The problem is clearly described and happens regularly."],
          constraintsProse: ["Several details are still missing, which limits confidence."],
          citedCriterionKeys: [],
        };

      default:
        return {};
    }
  }
}

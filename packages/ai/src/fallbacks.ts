/**
 * Non-AI fallbacks (SPEC §12.3).
 *
 * Built BEFORE the orchestrator, deliberately (SKILL.md §2.2). Two reasons: a feature
 * with no fallback is not shippable, and writing the fallback first forces the honest
 * question of what the model is actually adding.
 *
 * The contract every fallback meets: **the idea remains rankable**. Output is marked
 * FALLBACK with LOW confidence and says plainly that it was not analysed, so nobody
 * mistakes a placeholder for a judgement.
 */

export const NOT_ANALYSED = "not analysed — reviewer input required";

export interface FallbackInput {
  readonly fields: Readonly<Record<string, string | null>>;
}

const has = (v: string | null | undefined): boolean => Boolean(v && v.trim().length > 0);

const VALUE_DIMENSIONS = [
  "BUSINESS_IMPACT", "PRODUCTIVITY", "COST_REDUCTION", "REVENUE", "EMPLOYEE_EXPERIENCE",
  "CUSTOMER_IMPACT", "OPERATIONAL", "PROBLEM_SEVERITY", "PROBLEM_FREQUENCY",
] as const;

const FEASIBILITY_DIMENSIONS = [
  "TECHNICAL", "DATA", "INFRASTRUCTURE", "INTEGRATION", "SECURITY", "PRIVACY",
  "COMPLIANCE", "EXPERTISE", "RESOURCES", "COST", "EXTERNAL_DEPENDENCY",
] as const;

/** AI-01 — completeness heuristic. No model needed to notice a blank field. */
export function fallbackStructure(input: FallbackInput) {
  const f = input.fields;
  const missing: string[] = [];
  const optional: readonly [string, string][] = [
    ["existingProcess", "how the task is done today"],
    ["existingSolutions", "tools that already do part of this"],
    ["suggestedTechnology", "a suggested approach"],
    ["expectedBenefits", "the expected benefits"],
    ["estimatedCostNote", "any sense of cost"],
    ["references", "supporting references"],
  ];
  for (const [key, label] of optional) if (!has(f[key])) missing.push(label);

  return {
    problemStatement: f["problemStatement"] ?? NOT_ANALYSED,
    proposedSolution: f["description"] ?? NOT_ANALYSED,
    targetUsers: f["expectedUsers"] ?? NOT_ANALYSED,
    assumptions: [],
    missingInformation: missing,
    clarificationQuestions: missing.length
      ? [`Could you add ${missing[0]}? It is the biggest gap right now.`]
      : [],
  };
}

/**
 * AI-02 — the submitter's own words become one direct, short-horizon use case.
 * Low confidence, but real, and enough for the engine to produce a rank.
 */
export function fallbackUseCases(input: FallbackInput) {
  const users = input.fields["expectedUsers"];
  return {
    useCases: [
      {
        kind: "DIRECT" as const,
        horizon: "SHORT" as const,
        title: "As described by the submitter",
        description: input.fields["expectedOutcome"] ?? NOT_ANALYSED,
        departmentScope: [],
        // Unknown reach must not flatter the idea; the lowest band is the honest default.
        estimatedUserCountBand: "LT10" as const,
        isSpeculative: false,
        evidence: [has(users) ? users! : NOT_ANALYSED],
      },
    ],
  };
}

/** AI-03 — neutral bands across every dimension, visibly unanalysed. */
export function fallbackValue() {
  return {
    findings: VALUE_DIMENSIONS.map((dimension) => ({
      dimension,
      band: "MODERATE" as const,
      rationale: NOT_ANALYSED,
      evidence: [NOT_ANALYSED],
    })),
  };
}

/**
 * AI-04 — REQUIRES_INVESTIGATION, never NOT_CURRENTLY_FEASIBLE.
 *
 * The absolute verdict needs cited organisational constraints (FR-06), and a fallback
 * has none. Emitting it would let an outage kill a good idea.
 */
export function fallbackFeasibility() {
  return {
    status: "REQUIRES_INVESTIGATION" as const,
    summary: "Feasibility was not assessed automatically. A reviewer needs to look at this.",
    constraintCitations: [],
    findings: FEASIBILITY_DIMENSIONS.map((dimension) => ({
      dimension,
      band: "MODERATE" as const,
      finding: NOT_ANALYSED,
      condition: null,
      evidence: [NOT_ANALYSED],
    })),
  };
}

/** AI-05 — a baseline risk set, clearly marked as un-analysed. */
export function fallbackRisk() {
  return {
    risks: [
      {
        category: "ADOPTION" as const,
        description: "Adoption risk has not been assessed for this idea.",
        level: "MEDIUM" as const,
        potentialImpact: NOT_ANALYSED,
        // FR-10 requires a mitigation on every risk; the honest one is "look at it".
        mitigation: "A reviewer should assess this before the idea progresses.",
        evidence: [NOT_ANALYSED],
      },
    ],
    dependencies: [],
  };
}

/** AI-06 + AI-07 — mid-range classes and a timeline keyed off effort. */
export function fallbackEffortTimeline() {
  return {
    effortClass: "MEDIUM" as const,
    costClass: "MEDIUM" as const,
    operationalComplexity: "MEDIUM" as const,
    notes: NOT_ANALYSED,
    requirements: [],
    timeline: [
      { phase: "DISCOVERY" as const, minWeeks: 1, maxWeeks: 2 },
      { phase: "PROTOTYPE" as const, minWeeks: 2, maxWeeks: 4 },
      { phase: "MVP" as const, minWeeks: 4, maxWeeks: 8 },
      { phase: "TESTING" as const, minWeeks: 1, maxWeeks: 2 },
      { phase: "DEPLOYMENT" as const, minWeeks: 1, maxWeeks: 1 },
    ],
    evidence: [NOT_ANALYSED],
  };
}

/**
 * AI-08 — rule-based recommendations from what is missing.
 *
 * P-4 ("improvement over rejection") must survive an outage: an idea that could not be
 * analysed still gets actionable guidance, because the gaps are visible without a model.
 */
export function fallbackImprovement(input: FallbackInput) {
  const structure = fallbackStructure(input);
  return {
    recommendations: structure.missingInformation.slice(0, 3).map((gap, i) => ({
      issue: `The submission does not include ${gap}.`,
      whyItMatters:
        "Missing detail lowers confidence in the evaluation and limits the guidance the platform can give.",
      recommendation: `Add ${gap}.`,
      howToImplement: "Edit the idea and fill in the field, or create a new version if it has been submitted.",
      expectedEffect: "A better-grounded evaluation with fewer unknowns.",
      projectedRankingEffect: "UNKNOWN" as const,
      targetCriterionKey: null,
      priority: (i + 1) as 1 | 2 | 3,
    })),
  };
}

export const FALLBACKS = {
  STRUCTURE: fallbackStructure,
  USE_CASES: fallbackUseCases,
  VALUE: fallbackValue,
  FEASIBILITY: fallbackFeasibility,
  RISK: fallbackRisk,
  EFFORT_TIMELINE: fallbackEffortTimeline,
  IMPROVEMENT: fallbackImprovement,
} as const;

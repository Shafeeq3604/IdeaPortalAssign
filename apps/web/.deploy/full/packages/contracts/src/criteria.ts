import type {
  CriterionDirection, CriterionGroup, CriterionSourceKind,
} from "./enums.js";

/**
 * Criterion catalogue + seeded evaluation profiles (SPEC §14 P0.7, FR-12, FR-13).
 * FROZEN AT P0 as the shape; the VALUES are seed data an admin may change in M2 (P-6).
 *
 * Nothing here is hardcoded into packages/scoring — the engine receives it by injection.
 * A test asserts the engine produces different output for different catalogues.
 */

export interface CriterionDef {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly group: CriterionGroup;
  readonly direction: CriterionDirection;
  readonly sourceKind: CriterionSourceKind;
  /** Which AI factor feeds it. null = not AI-derived. Mapping lives in packages/scoring. */
  readonly factorSource: string | null;
  /** Absent means active. An admin may deactivate a criterion in M2 without deleting it. */
  readonly isActive?: boolean;
}

export const CRITERIA: readonly CriterionDef[] = [
  // ── VALUE (P-5: never multiplied by feasibility) ──
  { key: "business_impact", label: "Business impact", group: "VALUE", direction: "HIGHER_IS_BETTER", sourceKind: "AI_FACTOR", factorSource: "value.BUSINESS_IMPACT",
    description: "How materially the idea would change a business outcome if it worked." },
  { key: "user_reach", label: "Potential user reach", group: "VALUE", direction: "HIGHER_IS_BETTER", sourceKind: "AI_FACTOR", factorSource: "useCases.reachBand",
    description: "How many people across the organisation the idea could plausibly serve." },
  { key: "use_case_breadth", label: "Use-case breadth", group: "VALUE", direction: "HIGHER_IS_BETTER", sourceKind: "AI_FACTOR", factorSource: "useCases.breadth",
    description: "How many distinct, currently realistic applications the idea has." },
  { key: "problem_severity", label: "Problem severity", group: "VALUE", direction: "HIGHER_IS_BETTER", sourceKind: "AI_FACTOR", factorSource: "value.PROBLEM_SEVERITY",
    description: "How painful the underlying problem is for the people who have it." },

  // ── FEASIBILITY ──
  { key: "technical_feasibility", label: "Technical feasibility", group: "FEASIBILITY", direction: "HIGHER_IS_BETTER", sourceKind: "AI_FACTOR", factorSource: "feasibility.TECHNICAL",
    description: "How readily this can be built with capabilities the organisation has today." },
  { key: "data_availability", label: "Data availability", group: "FEASIBILITY", direction: "HIGHER_IS_BETTER", sourceKind: "AI_FACTOR", factorSource: "feasibility.DATA",
    description: "Whether the data the idea depends on exists and is accessible." },

  // ── EFFORT ──
  { key: "implementation_effort", label: "Implementation effort", group: "EFFORT", direction: "LOWER_IS_BETTER", sourceKind: "AI_FACTOR", factorSource: "plan.effortClass",
    description: "How much build work the idea would take. Lower is better; it is not a value judgement." },
  { key: "cost_efficiency", label: "Cost efficiency", group: "EFFORT", direction: "HIGHER_IS_BETTER", sourceKind: "AI_FACTOR", factorSource: "plan.costClass",
    description: "Expected value relative to expected cost." },
  { key: "time_to_value", label: "Time to value", group: "EFFORT", direction: "HIGHER_IS_BETTER", sourceKind: "AI_FACTOR", factorSource: "plan.timeline",
    description: "How quickly the first real benefit could land." },

  // ── STRATEGIC ──
  { key: "scalability", label: "Scalability", group: "STRATEGIC", direction: "HIGHER_IS_BETTER", sourceKind: "AI_FACTOR", factorSource: "useCases.scalability",
    description: "Whether the idea grows beyond its first use case without being rebuilt." },
  { key: "strategic_alignment", label: "Strategic alignment", group: "STRATEGIC", direction: "HIGHER_IS_BETTER", sourceKind: "AI_FACTOR", factorSource: "value.OPERATIONAL",
    description: "How closely the idea tracks stated organisational priorities." },
  { key: "long_term_potential", label: "Long-term potential", group: "STRATEGIC", direction: "HIGHER_IS_BETTER", sourceKind: "AI_FACTOR", factorSource: "useCases.longHorizon",
    description: "Value beyond the immediate horizon. Deliberately independent of current feasibility (FR-11)." },

  // ── RISK (LOWER_IS_BETTER: risk reduces rank, it does not condemn an idea) ──
  { key: "risk_exposure", label: "Risk exposure", group: "RISK", direction: "LOWER_IS_BETTER", sourceKind: "AI_FACTOR", factorSource: "risks.aggregate",
    description: "Weighted severity of identified risks, after recommended mitigations." },

  // ── DEMAND (M2 — the SIGNAL source kind exists at P0 so P11 needs no engine change) ──
  { key: "demonstrated_demand", label: "Demonstrated demand", group: "DEMAND", direction: "HIGHER_IS_BETTER", sourceKind: "SIGNAL", factorSource: null,
    description: "Evidence that real people want this: interest, similar reports, pilot volunteers. Populated from M2." },
];

export interface ProfileDef {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly isDefault: boolean;
  /** criterion key → weight. MUST sum to 1.0000 (enforced by a DB constraint trigger). */
  readonly weights: Readonly<Record<string, number>>;
}

/**
 * Four seeded profiles (REQUIREMENTS §16). `demonstrated_demand` is weighted 0 in M1
 * because it has no source until P11 — a zero weight keeps the criterion present and
 * explainable rather than absent and surprising when it switches on.
 */
export const PROFILES: readonly ProfileDef[] = [
  {
    key: "balanced", name: "Balanced", isDefault: true,
    description: "No thumb on the scale. The default view of the portfolio.",
    weights: {
      business_impact: 0.18, user_reach: 0.12, use_case_breadth: 0.07, problem_severity: 0.08,
      technical_feasibility: 0.13, data_availability: 0.05,
      implementation_effort: 0.08, cost_efficiency: 0.07, time_to_value: 0.06,
      scalability: 0.06, strategic_alignment: 0.06, long_term_potential: 0.02,
      risk_exposure: 0.02, demonstrated_demand: 0.00,
    },
  },
  {
    key: "quick_wins", name: "Quick Wins", isDefault: false,
    description: "Low effort, low cost, fast to land. Finds what could ship this quarter.",
    weights: {
      business_impact: 0.12, user_reach: 0.08, use_case_breadth: 0.03, problem_severity: 0.07,
      technical_feasibility: 0.18, data_availability: 0.07,
      implementation_effort: 0.20, cost_efficiency: 0.10, time_to_value: 0.10,
      scalability: 0.01, strategic_alignment: 0.02, long_term_potential: 0.00,
      risk_exposure: 0.02, demonstrated_demand: 0.00,
    },
  },
  {
    key: "strategic_innovation", name: "Strategic Innovation", isDefault: false,
    description:
      "Long-term value, scalability, alignment. A high-value idea that is hard today should surface here — that is the point (FR-11).",
    weights: {
      business_impact: 0.18, user_reach: 0.10, use_case_breadth: 0.08, problem_severity: 0.05,
      technical_feasibility: 0.04, data_availability: 0.02,
      implementation_effort: 0.02, cost_efficiency: 0.02, time_to_value: 0.01,
      scalability: 0.16, strategic_alignment: 0.16, long_term_potential: 0.14,
      risk_exposure: 0.02, demonstrated_demand: 0.00,
    },
  },
  {
    key: "cost_reduction", name: "Cost Reduction", isDefault: false,
    description: "Savings, automation, operational efficiency.",
    weights: {
      business_impact: 0.10, user_reach: 0.08, use_case_breadth: 0.04, problem_severity: 0.08,
      technical_feasibility: 0.10, data_availability: 0.04,
      implementation_effort: 0.10, cost_efficiency: 0.26, time_to_value: 0.08,
      scalability: 0.05, strategic_alignment: 0.05, long_term_potential: 0.00,
      risk_exposure: 0.02, demonstrated_demand: 0.00,
    },
  },
];

/** Guard used by the seed AND by a unit test — the DB trigger is the last line, not the first. */
export function profileWeightSum(profile: ProfileDef): number {
  return Object.values(profile.weights).reduce((a, b) => a + b, 0);
}

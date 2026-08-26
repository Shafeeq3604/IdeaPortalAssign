import type { Band, EffortClass, FeasibilityStatus, Horizon, UserCountBand } from "../enums.js";

/**
 * The canonical fixture corpus (SPEC §14 P0.9). FROZEN AT P0.
 *
 * Twelve hand-authored ideas spanning four archetypes. EVERY downstream phase tests
 * against these — which is precisely why they are a P0 deliverable and not something
 * P3 invents for itself: it is what lets P4 build the entire scoring engine in parallel,
 * before the AI pipeline exists.
 *
 * The factor sets here are HAND-AUTHORED, not model output. They are the ground truth
 * the deterministic engine is tested against, so they must never be regenerated from a
 * model run — that would make the engine's tests circular.
 *
 * Archetypes and what each one is for:
 *   STRONG      — detailed, feasible, valuable. Should rank high under most profiles.
 *   VAGUE       — underspecified. Low maturity, must still be RANKABLE (never rejected).
 *   INFEASIBLE  — blocked by a stated organisational constraint. Exercises FR-06's
 *                 citation requirement and must still receive improvement guidance (P-4).
 *
 * NOTE on maturityLevel: these are DERIVED from the REQUIREMENTS §20 rule (implemented in
 * packages/scoring), not authored by hand. Six were corrected in P4 when the rule was first
 * run against them — the rule is the spec; the original numbers were estimates.
 *
 *   STRATEGIC   — high long-term value, low current feasibility. The FR-11 case: must
 *                 outrank a quick win under `strategic_innovation` and lose under
 *                 `quick_wins`. If that inversion does not happen, the engine is wrong.
 */

export type Archetype = "STRONG" | "VAGUE" | "INFEASIBLE" | "STRATEGIC";

export interface IdeaFixture {
  readonly key: string;
  readonly archetype: Archetype;
  readonly title: string;
  readonly problemStatement: string;
  readonly expectedUsers: string;
  readonly expectedOutcome: string;
  /** Which optional FR-02 fields the submitter filled in. Drives maturity (FR-17). */
  readonly optionalFieldsProvided: readonly string[];
  readonly factors: FixtureFactors;
  /** What the engine must do with it. Asserted in P4's tests. */
  readonly expectations: FixtureExpectations;
}

export interface FixtureFactors {
  readonly value: Readonly<Record<string, Band>>;
  readonly feasibility: Readonly<Record<string, Band>>;
  readonly feasibilityStatus: FeasibilityStatus;
  readonly constraintCitations: readonly string[];
  readonly useCases: readonly {
    readonly kind: "DIRECT" | "INDIRECT";
    readonly horizon: Horizon;
    readonly reachBand: UserCountBand;
    readonly isSpeculative: boolean;
  }[];
  readonly riskLevels: readonly ("LOW" | "MEDIUM" | "HIGH" | "CRITICAL")[];
  readonly effortClass: EffortClass;
  readonly costClass: EffortClass;
  readonly timelineWeeks: { readonly min: number; readonly max: number };
}

export interface FixtureExpectations {
  readonly maturityLevel: 1 | 2 | 3 | 4 | 5;
  /** Must always be true: no fixture is unrankable, whatever its state (SPEC §9.3). */
  readonly isRankable: true;
  readonly expectsRecommendations: boolean;
  /** Relative ordering assertions, checked per profile in P4. */
  readonly ranksAboveUnderQuickWins?: readonly string[];
  readonly ranksAboveUnderStrategic?: readonly string[];
}

const V = (o: Record<string, Band>) => o;

/** Every value dimension gets a band; the engine must never see a hole. */
const flatValue = (b: Band): Record<string, Band> => ({
  BUSINESS_IMPACT: b, PRODUCTIVITY: b, COST_REDUCTION: b, REVENUE: b,
  EMPLOYEE_EXPERIENCE: b, CUSTOMER_IMPACT: b, OPERATIONAL: b,
  PROBLEM_SEVERITY: b, PROBLEM_FREQUENCY: b,
});

const flatFeasibility = (b: Band): Record<string, Band> => ({
  TECHNICAL: b, DATA: b, INFRASTRUCTURE: b, INTEGRATION: b, SECURITY: b, PRIVACY: b,
  COMPLIANCE: b, EXPERTISE: b, RESOURCES: b, COST: b, EXTERNAL_DEPENDENCY: b,
});

export const IDEA_FIXTURES: readonly IdeaFixture[] = [
  // ─────────────────────── STRONG ───────────────────────
  {
    key: "expense-receipt-ocr",
    archetype: "STRONG",
    title: "Automatic receipt extraction for expense claims",
    problemStatement:
      "Staff retype receipt totals into the expense tool by hand; finance rejects ~15% for transcription errors.",
    expectedUsers: "All staff who claim expenses, plus the finance review team.",
    expectedOutcome: "Claim submission time falls and rejection-for-typo goes to near zero.",
    optionalFieldsProvided: ["existingProcess", "expectedBenefits", "suggestedTechnology", "references"],
    factors: {
      value: V({ ...flatValue("MODERATE"), PRODUCTIVITY: "HIGH", PROBLEM_FREQUENCY: "VERY_HIGH", EMPLOYEE_EXPERIENCE: "HIGH" }),
      feasibility: V({ ...flatFeasibility("HIGH"), DATA: "VERY_HIGH", TECHNICAL: "HIGH" }),
      feasibilityStatus: "HIGHLY_FEASIBLE",
      constraintCitations: [],
      useCases: [
        { kind: "DIRECT", horizon: "SHORT", reachBand: "B1K_10K", isSpeculative: false },
        { kind: "INDIRECT", horizon: "MEDIUM", reachBand: "B100_1K", isSpeculative: false },
      ],
      riskLevels: ["LOW", "MEDIUM"],
      effortClass: "MEDIUM", costClass: "LOW", timelineWeeks: { min: 8, max: 14 },
    },
    expectations: { maturityLevel: 4, isRankable: true, expectsRecommendations: false },
  },
  {
    key: "onboarding-checklist-automation",
    archetype: "STRONG",
    title: "Automated onboarding checklist across IT, HR and facilities",
    problemStatement: "New joiners wait days for accounts because three teams track setup separately.",
    expectedUsers: "Every new joiner, their manager, and the three onboarding teams.",
    expectedOutcome: "Day-one readiness rises; manual chasing disappears.",
    optionalFieldsProvided: ["existingProcess", "existingSolutions", "expectedBenefits"],
    factors: {
      value: V({ ...flatValue("MODERATE"), OPERATIONAL: "HIGH", EMPLOYEE_EXPERIENCE: "VERY_HIGH" }),
      feasibility: V({ ...flatFeasibility("MODERATE"), INTEGRATION: "LOW", TECHNICAL: "HIGH" }),
      feasibilityStatus: "FEASIBLE_WITH_CONDITIONS",
      constraintCitations: [],
      useCases: [{ kind: "DIRECT", horizon: "SHORT", reachBand: "B100_1K", isSpeculative: false }],
      riskLevels: ["MEDIUM", "MEDIUM"],
      effortClass: "MEDIUM", costClass: "MEDIUM", timelineWeeks: { min: 10, max: 18 },
    },
    expectations: { maturityLevel: 2, isRankable: true, expectsRecommendations: true },
  },
  {
    key: "meeting-room-noshow",
    archetype: "STRONG",
    title: "Auto-release booked meeting rooms after 10 minutes of no-show",
    problemStatement: "Rooms sit empty while staff hunt for space; ~20% of bookings are never used.",
    expectedUsers: "Everyone who books a room; facilities.",
    expectedOutcome: "Effective room capacity rises without new space.",
    optionalFieldsProvided: ["existingProcess", "suggestedTechnology", "expectedBenefits", "estimatedCostNote"],
    factors: {
      value: V({ ...flatValue("LOW"), OPERATIONAL: "MODERATE", PROBLEM_FREQUENCY: "HIGH" }),
      feasibility: V(flatFeasibility("VERY_HIGH")),
      feasibilityStatus: "HIGHLY_FEASIBLE",
      constraintCitations: [],
      useCases: [{ kind: "DIRECT", horizon: "SHORT", reachBand: "B1K_10K", isSpeculative: false }],
      riskLevels: ["LOW"],
      effortClass: "LOW", costClass: "LOW", timelineWeeks: { min: 3, max: 6 },
    },
    // The canonical quick win: must beat the strategic ideas under `quick_wins`.
    expectations: {
      maturityLevel: 3, isRankable: true, expectsRecommendations: false,
      ranksAboveUnderQuickWins: ["unified-knowledge-graph", "predictive-capacity-planning"],
    },
  },

  // ─────────────────────── VAGUE ───────────────────────
  {
    key: "better-internal-search",
    archetype: "VAGUE",
    title: "Make internal search better",
    problemStatement: "It is hard to find things.",
    expectedUsers: "Everyone.",
    expectedOutcome: "People find things faster.",
    optionalFieldsProvided: [],
    factors: {
      value: V(flatValue("MODERATE")),
      feasibility: V({ ...flatFeasibility("MODERATE"), DATA: "LOW", EXPERTISE: "LOW" }),
      feasibilityStatus: "REQUIRES_INVESTIGATION",
      constraintCitations: [],
      useCases: [{ kind: "DIRECT", horizon: "MEDIUM", reachBand: "B1K_10K", isSpeculative: true }],
      riskLevels: ["MEDIUM"],
      effortClass: "HIGH", costClass: "HIGH", timelineWeeks: { min: 16, max: 40 },
    },
    // Level 1 with a mid composite: the case that proves maturity never feeds the score (P-5).
    expectations: { maturityLevel: 1, isRankable: true, expectsRecommendations: true },
  },
  {
    key: "ai-for-reports",
    archetype: "VAGUE",
    title: "Use AI for our reports",
    problemStatement: "Reports take a long time to write.",
    expectedUsers: "Report writers.",
    expectedOutcome: "Faster reports.",
    optionalFieldsProvided: ["suggestedTechnology"],
    factors: {
      value: V({ ...flatValue("MODERATE"), PRODUCTIVITY: "HIGH" }),
      feasibility: V({ ...flatFeasibility("MODERATE"), PRIVACY: "LOW", COMPLIANCE: "LOW" }),
      feasibilityStatus: "REQUIRES_INVESTIGATION",
      constraintCitations: [],
      useCases: [{ kind: "DIRECT", horizon: "MEDIUM", reachBand: "B100_1K", isSpeculative: true }],
      riskLevels: ["HIGH", "MEDIUM"],
      effortClass: "MEDIUM", costClass: "MEDIUM", timelineWeeks: { min: 8, max: 24 },
    },
    expectations: { maturityLevel: 1, isRankable: true, expectsRecommendations: true },
  },
  {
    key: "team-morale-app",
    archetype: "VAGUE",
    title: "An app to improve team morale",
    problemStatement: "Morale in some teams is low.",
    expectedUsers: "Staff.",
    expectedOutcome: "Better morale.",
    optionalFieldsProvided: [],
    factors: {
      value: V({ ...flatValue("LOW"), EMPLOYEE_EXPERIENCE: "MODERATE" }),
      feasibility: V({ ...flatFeasibility("MODERATE"), PRIVACY: "LOW" }),
      feasibilityStatus: "REQUIRES_INVESTIGATION",
      constraintCitations: [],
      useCases: [{ kind: "INDIRECT", horizon: "LONG", reachBand: "B100_1K", isSpeculative: true }],
      riskLevels: ["MEDIUM", "LOW"],
      effortClass: "MEDIUM", costClass: "LOW", timelineWeeks: { min: 6, max: 20 },
    },
    expectations: { maturityLevel: 1, isRankable: true, expectsRecommendations: true },
  },

  // ─────────────────────── INFEASIBLE ───────────────────────
  {
    key: "customer-pii-training-set",
    archetype: "INFEASIBLE",
    title: "Train a model on raw customer records to predict churn",
    problemStatement: "We cannot tell which customers are about to leave.",
    expectedUsers: "Account management.",
    expectedOutcome: "Earlier intervention on at-risk accounts.",
    optionalFieldsProvided: ["expectedBenefits", "suggestedTechnology"],
    factors: {
      value: V({ ...flatValue("HIGH"), REVENUE: "VERY_HIGH", CUSTOMER_IMPACT: "HIGH" }),
      feasibility: V({ ...flatFeasibility("MODERATE"), PRIVACY: "NEGLIGIBLE", COMPLIANCE: "NEGLIGIBLE" }),
      feasibilityStatus: "NOT_CURRENTLY_FEASIBLE",
      // FR-06: the absolute verdict is only storable WITH these. Empty here = DB rejects.
      constraintCitations: [
        "Data Handling Policy §4.2 prohibits use of identifiable customer records for model training.",
        "No lawful basis recorded for secondary processing of customer contact data.",
      ],
      useCases: [{ kind: "DIRECT", horizon: "MEDIUM", reachBand: "LT10", isSpeculative: false }],
      riskLevels: ["CRITICAL", "HIGH"],
      effortClass: "HIGH", costClass: "HIGH", timelineWeeks: { min: 20, max: 48 },
    },
    // High value + infeasible: must still rank, and must still get guidance (P-4).
    expectations: { maturityLevel: 3, isRankable: true, expectsRecommendations: true },
  },
  {
    key: "realtime-erp-writeback",
    archetype: "INFEASIBLE",
    title: "Real-time write-back to the core ERP from a mobile app",
    problemStatement: "Field staff cannot update stock counts until they return to a desk.",
    expectedUsers: "Field operations.",
    expectedOutcome: "Stock accuracy improves same-day.",
    optionalFieldsProvided: ["existingProcess", "existingSolutions"],
    factors: {
      value: V({ ...flatValue("MODERATE"), OPERATIONAL: "HIGH" }),
      feasibility: V({ ...flatFeasibility("LOW"), EXTERNAL_DEPENDENCY: "NEGLIGIBLE", INTEGRATION: "NEGLIGIBLE" }),
      feasibilityStatus: "NOT_CURRENTLY_FEASIBLE",
      constraintCitations: [
        "ERP vendor contract forbids third-party write access until the 2027 platform upgrade.",
      ],
      useCases: [{ kind: "DIRECT", horizon: "LONG", reachBand: "B10_100", isSpeculative: false }],
      riskLevels: ["HIGH", "MEDIUM", "MEDIUM"],
      effortClass: "VERY_HIGH", costClass: "VERY_HIGH", timelineWeeks: { min: 26, max: 52 },
    },
    expectations: { maturityLevel: 2, isRankable: true, expectsRecommendations: true },
  },
  {
    key: "public-salary-benchmarks",
    archetype: "INFEASIBLE",
    title: "Publish internal salary bands against live market data",
    problemStatement: "Staff cannot see how their pay compares to market.",
    expectedUsers: "All staff, HR.",
    expectedOutcome: "Greater pay transparency.",
    optionalFieldsProvided: ["expectedBenefits"],
    factors: {
      value: V({ ...flatValue("MODERATE"), EMPLOYEE_EXPERIENCE: "HIGH" }),
      feasibility: V({ ...flatFeasibility("MODERATE"), COMPLIANCE: "NEGLIGIBLE", PRIVACY: "LOW" }),
      feasibilityStatus: "NOT_CURRENTLY_FEASIBLE",
      constraintCitations: [
        "Reward policy requires works-council consultation before any pay-band disclosure.",
      ],
      useCases: [{ kind: "DIRECT", horizon: "LONG", reachBand: "B1K_10K", isSpeculative: true }],
      riskLevels: ["HIGH", "MEDIUM"],
      effortClass: "MEDIUM", costClass: "LOW", timelineWeeks: { min: 8, max: 30 },
    },
    expectations: { maturityLevel: 2, isRankable: true, expectsRecommendations: true },
  },

  // ─────────────────────── STRATEGIC ───────────────────────
  {
    key: "unified-knowledge-graph",
    archetype: "STRATEGIC",
    title: "Unified knowledge graph across products, customers and documentation",
    problemStatement:
      "Every team rebuilds the same joins between product, customer and doc data; nobody has one view.",
    expectedUsers: "Engineering, support, product, sales enablement — eventually most of the company.",
    expectedOutcome: "One queryable substrate that new internal tools build on rather than re-deriving.",
    optionalFieldsProvided: ["existingProcess", "existingSolutions", "suggestedTechnology", "expectedBenefits", "references"],
    factors: {
      value: V({ ...flatValue("HIGH"), BUSINESS_IMPACT: "VERY_HIGH", OPERATIONAL: "HIGH" }),
      feasibility: V({ ...flatFeasibility("LOW"), EXPERTISE: "LOW", RESOURCES: "LOW", TECHNICAL: "MODERATE" }),
      feasibilityStatus: "FEASIBLE_WITH_CONDITIONS",
      constraintCitations: [],
      useCases: [
        { kind: "DIRECT", horizon: "LONG", reachBand: "GT10K", isSpeculative: false },
        { kind: "INDIRECT", horizon: "LONG", reachBand: "B1K_10K", isSpeculative: true },
        { kind: "INDIRECT", horizon: "MEDIUM", reachBand: "B100_1K", isSpeculative: false },
      ],
      riskLevels: ["HIGH", "MEDIUM", "MEDIUM"],
      effortClass: "VERY_HIGH", costClass: "HIGH", timelineWeeks: { min: 30, max: 60 },
    },
    // THE FR-11 assertion: beats the quick win under strategic, loses under quick_wins.
    expectations: {
      maturityLevel: 4, isRankable: true, expectsRecommendations: true,
      ranksAboveUnderStrategic: ["meeting-room-noshow", "expense-receipt-ocr"],
    },
  },
  {
    key: "predictive-capacity-planning",
    archetype: "STRATEGIC",
    title: "Predictive capacity planning across delivery teams",
    problemStatement: "Staffing decisions are made on last quarter's numbers and gut feel.",
    expectedUsers: "Delivery leadership, resourcing, finance.",
    expectedOutcome: "Capacity decisions made against a forecast rather than hindsight.",
    optionalFieldsProvided: ["existingProcess", "expectedBenefits", "references"],
    factors: {
      value: V({ ...flatValue("HIGH"), COST_REDUCTION: "HIGH", BUSINESS_IMPACT: "HIGH" }),
      feasibility: V({ ...flatFeasibility("MODERATE"), DATA: "LOW", EXPERTISE: "LOW" }),
      feasibilityStatus: "FEASIBLE_WITH_CONDITIONS",
      constraintCitations: [],
      useCases: [
        { kind: "DIRECT", horizon: "LONG", reachBand: "B10_100", isSpeculative: false },
        { kind: "INDIRECT", horizon: "LONG", reachBand: "B100_1K", isSpeculative: true },
      ],
      riskLevels: ["MEDIUM", "MEDIUM"],
      effortClass: "HIGH", costClass: "HIGH", timelineWeeks: { min: 20, max: 44 },
    },
    expectations: {
      maturityLevel: 2, isRankable: true, expectsRecommendations: true,
      ranksAboveUnderStrategic: ["meeting-room-noshow"],
    },
  },
  {
    key: "self-serve-data-products",
    archetype: "STRATEGIC",
    title: "Self-serve data products with governed access",
    problemStatement:
      "Every data question becomes a ticket to the data team; the queue is the bottleneck for decisions.",
    expectedUsers: "Analysts and managers across every function.",
    expectedOutcome: "Most routine data questions answered without a ticket.",
    optionalFieldsProvided: ["existingProcess", "existingSolutions", "expectedBenefits", "suggestedTechnology"],
    factors: {
      value: V({ ...flatValue("HIGH"), PRODUCTIVITY: "VERY_HIGH", OPERATIONAL: "HIGH" }),
      feasibility: V({ ...flatFeasibility("MODERATE"), SECURITY: "LOW", COMPLIANCE: "LOW", RESOURCES: "LOW" }),
      feasibilityStatus: "FEASIBLE_WITH_CONDITIONS",
      constraintCitations: [],
      useCases: [
        { kind: "DIRECT", horizon: "MEDIUM", reachBand: "B1K_10K", isSpeculative: false },
        { kind: "INDIRECT", horizon: "LONG", reachBand: "GT10K", isSpeculative: true },
      ],
      riskLevels: ["HIGH", "MEDIUM", "LOW"],
      effortClass: "HIGH", costClass: "MEDIUM", timelineWeeks: { min: 18, max: 40 },
    },
    expectations: { maturityLevel: 3, isRankable: true, expectsRecommendations: true },
  },
];

export const FIXTURES_BY_KEY: Readonly<Record<string, IdeaFixture>> = Object.fromEntries(
  IDEA_FIXTURES.map((f) => [f.key, f]),
);

export function fixturesByArchetype(a: Archetype): readonly IdeaFixture[] {
  return IDEA_FIXTURES.filter((f) => f.archetype === a);
}

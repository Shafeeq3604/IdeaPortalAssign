import { z } from "zod";

/**
 * Shared enums. FROZEN AT P0 (SPEC §14).
 * These mirror packages/db/prisma/schema.prisma exactly — a drift test asserts it.
 * Adding a member is additive (SPEC §14.1). Removing or renaming one is BREAKING.
 */

export const Role = z.enum(["EMPLOYEE", "REVIEWER", "ADMIN", "MANAGEMENT"]);
export type Role = z.infer<typeof Role>;

export const IdeaStatus = z.enum([
  "DRAFT",
  "SUBMITTED",
  "AI_ANALYSIS",
  "NEEDS_CLARIFICATION",
  "EVALUATED",
  "RANKED",
  "UNDER_REVIEW",
  "PROTOTYPE_CANDIDATE",
  "PILOT",
  "PRODUCTION_CANDIDATE",
  "IMPLEMENTED",
  "PARKED",
  "BLOCKED",
  "REJECTED",
  "ARCHIVED",
]);
export type IdeaStatus = z.infer<typeof IdeaStatus>;

/** Reachable in M1. Later states exist in the enum but are unreachable until M3 (SPEC §5.4). */
export const M1_REACHABLE_STATUSES: readonly IdeaStatus[] = [
  "DRAFT", "SUBMITTED", "AI_ANALYSIS", "NEEDS_CLARIFICATION", "EVALUATED",
  "RANKED", "UNDER_REVIEW", "PROTOTYPE_CANDIDATE",
  "PARKED", "BLOCKED", "REJECTED", "ARCHIVED",
] as const;

export const AnalysisStep = z.enum([
  "STRUCTURE", "USE_CASES", "VALUE", "FEASIBILITY", "RISK", "EFFORT_TIMELINE",
  "EXPLANATION",
]);
export type AnalysisStep = z.infer<typeof AnalysisStep>;

/** The six steps of the submission pipeline, in order (SPEC §3.3). Drives the UI stepper. */
export const PIPELINE_STEPS = [
  "STRUCTURE", "USE_CASES", "VALUE", "FEASIBILITY", "RISK", "EFFORT_TIMELINE",
] as const satisfies readonly AnalysisStep[];

export const AnalysisStatus = z.enum(["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "SKIPPED"]);
export type AnalysisStatus = z.infer<typeof AnalysisStatus>;

/** Ordinal band. The AI emits these — never a number (ADR-005). */
export const Band = z.enum(["NEGLIGIBLE", "LOW", "MODERATE", "HIGH", "VERY_HIGH"]);
export type Band = z.infer<typeof Band>;

export const Confidence = z.enum(["LOW", "MEDIUM", "HIGH"]);
export type Confidence = z.infer<typeof Confidence>;

export const ScoreSource = z.enum(["AI", "HUMAN", "SIGNAL", "FALLBACK"]);
export type ScoreSource = z.infer<typeof ScoreSource>;

export const UseCaseKind = z.enum(["DIRECT", "INDIRECT"]);
export type UseCaseKind = z.infer<typeof UseCaseKind>;

export const Horizon = z.enum(["SHORT", "MEDIUM", "LONG"]);
export type Horizon = z.infer<typeof Horizon>;

export const UserCountBand = z.enum(["LT10", "B10_100", "B100_1K", "B1K_10K", "GT10K"]);
export type UserCountBand = z.infer<typeof UserCountBand>;

export const FeasibilityStatus = z.enum([
  "HIGHLY_FEASIBLE", "FEASIBLE_WITH_CONDITIONS", "REQUIRES_INVESTIGATION", "NOT_CURRENTLY_FEASIBLE",
]);
export type FeasibilityStatus = z.infer<typeof FeasibilityStatus>;

export const RiskLevel = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export type RiskLevel = z.infer<typeof RiskLevel>;

export const EffortClass = z.enum(["LOW", "MEDIUM", "HIGH", "VERY_HIGH"]);
export type EffortClass = z.infer<typeof EffortClass>;

export const TimelinePhase = z.enum(["DISCOVERY", "PROTOTYPE", "MVP", "TESTING", "DEPLOYMENT"]);
export type TimelinePhase = z.infer<typeof TimelinePhase>;

export const RequirementKind = z.enum(["PEOPLE", "TECHNOLOGY", "DATA", "ORG"]);
export type RequirementKind = z.infer<typeof RequirementKind>;

export const DependencyKind = z.enum(["INTERNAL", "EXTERNAL", "VENDOR", "DATA"]);
export type DependencyKind = z.infer<typeof DependencyKind>;

export const ValueDimension = z.enum([
  "BUSINESS_IMPACT", "PRODUCTIVITY", "COST_REDUCTION", "REVENUE", "EMPLOYEE_EXPERIENCE",
  "CUSTOMER_IMPACT", "OPERATIONAL", "PROBLEM_SEVERITY", "PROBLEM_FREQUENCY",
]);
export type ValueDimension = z.infer<typeof ValueDimension>;

export const FeasibilityDimension = z.enum([
  "TECHNICAL", "DATA", "INFRASTRUCTURE", "INTEGRATION", "SECURITY", "PRIVACY",
  "COMPLIANCE", "EXPERTISE", "RESOURCES", "COST", "EXTERNAL_DEPENDENCY",
]);
export type FeasibilityDimension = z.infer<typeof FeasibilityDimension>;

export const RiskCategory = z.enum([
  "TECHNICAL", "SECURITY", "PRIVACY", "COMPLIANCE", "FINANCIAL",
  "OPERATIONAL", "ADOPTION", "DATA", "VENDOR",
]);
export type RiskCategory = z.infer<typeof RiskCategory>;

export const CriterionGroup = z.enum([
  "VALUE", "FEASIBILITY", "EFFORT", "STRATEGIC", "RISK", "DEMAND",
]);
export type CriterionGroup = z.infer<typeof CriterionGroup>;

export const CriterionDirection = z.enum(["HIGHER_IS_BETTER", "LOWER_IS_BETTER"]);
export type CriterionDirection = z.infer<typeof CriterionDirection>;

export const CriterionSourceKind = z.enum(["AI_FACTOR", "SIGNAL", "HUMAN"]);
export type CriterionSourceKind = z.infer<typeof CriterionSourceKind>;

export const ExplanationSource = z.enum(["ENGINE", "ENGINE_PLUS_AI_NARRATIVE"]);
export type ExplanationSource = z.infer<typeof ExplanationSource>;

export const RankingEffect = z.enum(["LIKELY_UP", "POSSIBLY_UP", "NEUTRAL", "UNKNOWN"]);
export type RankingEffect = z.infer<typeof RankingEffect>;

export const RecommendationState = z.enum(["OPEN", "ADDRESSED", "DISMISSED"]);
export type RecommendationState = z.infer<typeof RecommendationState>;

export const ReviewDecision = z.enum([
  "VALIDATED", "NEEDS_CLARIFICATION", "OVERRIDDEN",
  "APPROVED_FOR_PROTOTYPE", "REJECTED", "PARKED",
]);
export type ReviewDecision = z.infer<typeof ReviewDecision>;

/** Maturity is independent of score and never feeds it (SPEC §5.3, P-5). */
export const MaturityLevel = z.union([
  z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5),
]);
export type MaturityLevel = z.infer<typeof MaturityLevel>;

export const MATURITY_LABELS: Record<MaturityLevel, string> = {
  1: "Concept",
  2: "Defined Problem",
  3: "Defined Solution",
  4: "Validated",
  5: "Implementation Ready",
};

export const ModelTier = z.enum(["A", "B", "C"]);
export type ModelTier = z.infer<typeof ModelTier>;

export const ThinkingMode = z.enum(["ADAPTIVE", "BUDGETED", "NONE"]);
export type ThinkingMode = z.infer<typeof ThinkingMode>;

/** Band → 0..100 anchor points. Used by the engine; NOT by the AI (ADR-005). */
export const BAND_ANCHORS: Record<Band, number> = {
  NEGLIGIBLE: 5,
  LOW: 27.5,
  MODERATE: 50,
  HIGH: 72.5,
  VERY_HIGH: 95,
};

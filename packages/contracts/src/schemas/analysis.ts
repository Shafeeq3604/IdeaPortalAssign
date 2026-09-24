import { z } from "zod";
import {
  AnalysisStatus, AnalysisStep, Band, DependencyKind, EffortClass, FeasibilityDimension,
  FeasibilityStatus, Horizon, MarketDimension, RequirementKind, RiskCategory, RiskLevel,
  TimelinePhase, UseCaseKind, UserCountBand, ValueDimension,
} from "../enums.js";
import { Id, Provenance, Timestamp } from "./common.js";

/**
 * AI analysis results (FR-03..FR-11).
 *
 * ADR-005 holds at the API boundary too: nothing here carries a score, a rank or a
 * weight. Bands and classes are ordinal labels; the numbers live in evaluation.ts and
 * are produced by the deterministic engine.
 */

const Evidence = z.array(z.string()).min(1);

export const AnalysisStepState = z.object({
  step: AnalysisStep,
  status: AnalysisStatus,
  startedAt: Timestamp.nullable(),
  finishedAt: Timestamp.nullable(),
  /** Populated on FAILED. A client-safe code — never provider or stack detail (§4.4). */
  errorCode: z.string().nullable(),
  /** True when the non-AI fallback supplied this step's factors (SPEC §12.3). */
  usedFallback: z.boolean(),
});
export type AnalysisStepState = z.infer<typeof AnalysisStepState>;

/** Drives the six-step determinate stepper (SPEC §8.4). Real state, never a fake %. */
export const AnalysisRunStatus = z.object({
  analysisRunId: Id,
  ideaVersionId: Id,
  overall: z.enum(["PENDING", "RUNNING", "SUCCEEDED", "PARTIAL", "FAILED"]),
  steps: z.array(AnalysisStepState),
  startedAt: Timestamp.nullable(),
  finishedAt: Timestamp.nullable(),
});
export type AnalysisRunStatus = z.infer<typeof AnalysisRunStatus>;

export const StructuredProposal = z.object({
  problemStatement: z.string(),
  proposedSolution: z.string(),
  targetUsers: z.string(),
  assumptions: z.array(z.string()),
  missingInformation: z.array(z.string()),
  clarificationQuestions: z.array(z.string()),
  provenance: Provenance,
});
export type StructuredProposal = z.infer<typeof StructuredProposal>;

export const UseCase = z.object({
  id: Id,
  kind: UseCaseKind,
  horizon: Horizon,
  title: z.string(),
  description: z.string(),
  departmentScope: z.array(z.string()),
  estimatedUserCountBand: UserCountBand,
  /** FR-04: realistic-now vs. potential-future must stay distinguishable. */
  isSpeculative: z.boolean(),
});
export type UseCase = z.infer<typeof UseCase>;

export const ValueFinding = z.object({
  dimension: ValueDimension,
  band: Band,
  rationale: z.string(),
  evidence: Evidence,
});
export type ValueFinding = z.infer<typeof ValueFinding>;

/** Same shape as `ValueFinding` — see `MarketDimension`'s own comment for why this is
 *  unscored AI analysis, not a new weighted criterion. */
export const MarketFinding = z.object({
  dimension: MarketDimension,
  band: Band,
  rationale: z.string(),
  evidence: Evidence,
});
export type MarketFinding = z.infer<typeof MarketFinding>;

export const FeasibilityFinding = z.object({
  dimension: FeasibilityDimension,
  band: Band,
  finding: z.string(),
  /** What would make it feasible — improvement over rejection (P-4). */
  condition: z.string().nullable(),
});
export type FeasibilityFinding = z.infer<typeof FeasibilityFinding>;

export const FeasibilityAssessment = z.object({
  status: FeasibilityStatus,
  summary: z.string(),
  /** FR-06: non-empty whenever status is NOT_CURRENTLY_FEASIBLE. DB CHECK enforces it. */
  constraintCitations: z.array(z.string()),
  findings: z.array(FeasibilityFinding),
  provenance: Provenance,
});
export type FeasibilityAssessment = z.infer<typeof FeasibilityAssessment>;

export const Risk = z.object({
  id: Id,
  category: RiskCategory,
  description: z.string(),
  level: RiskLevel,
  potentialImpact: z.string(),
  /** FR-10: never null. */
  mitigation: z.string(),
});
export type Risk = z.infer<typeof Risk>;

export const Dependency = z.object({
  id: Id,
  kind: DependencyKind,
  description: z.string(),
  blocking: z.boolean(),
});
export type Dependency = z.infer<typeof Dependency>;

export const ImplementationRequirement = z.object({
  id: Id,
  kind: RequirementKind,
  item: z.string(),
  detail: z.string().nullable(),
  isMandatory: z.boolean(),
});
export type ImplementationRequirement = z.infer<typeof ImplementationRequirement>;

export const TimelineEstimate = z.object({
  phase: TimelinePhase,
  minWeeks: z.number().int().min(1),
  maxWeeks: z.number().int().min(1),
  /**
   * FR-08. Always true — the DB CHECK makes the false value unstorable, and it is in the
   * response so a client physically cannot render an estimate without the caveat.
   */
  isPreliminary: z.literal(true),
});
export type TimelineEstimate = z.infer<typeof TimelineEstimate>;

export const ImplementationPlan = z.object({
  effortClass: EffortClass,
  costClass: EffortClass,
  operationalComplexity: EffortClass,
  notes: z.string().nullable(),
  requirements: z.array(ImplementationRequirement),
  timeline: z.array(TimelineEstimate),
  provenance: Provenance,
});
export type ImplementationPlan = z.infer<typeof ImplementationPlan>;

/**
 * ADR-026: a formal, advisory synthesis of the run's own prior findings — never a
 * decision. `recommendation` names the recommended ACTION for a human to weigh, not a
 * verdict on the idea's worth (P-1) and not an authority to act on its own (P-3). The
 * actual go/no-go is `LeadershipDecision` (leadership.ts), a separate, human-authored record.
 */
export const ImplementationRecommendationAction = z.enum([
  "RECOMMEND",
  "RECOMMEND_WITH_CONDITIONS",
  "DO_NOT_RECOMMEND",
  "INSUFFICIENT_DATA",
]);
export type ImplementationRecommendationAction = z.infer<
  typeof ImplementationRecommendationAction
>;

export const ImplementationRecommendation = z.object({
  /** What a `LeadershipDecision` (review.ts) references via `recommendationId`. */
  id: Id,
  recommendation: ImplementationRecommendationAction,
  rationale: z.string(),
  supportingEvidence: z.array(z.string()),
  risks: z.array(z.string()),
  assumptions: z.array(z.string()),
  validationNeeds: z.array(z.string()),
  /** When this recommendation was produced — shown on the UI card (ADR-026). */
  generatedAt: Timestamp,
  provenance: Provenance,
});
export type ImplementationRecommendation = z.infer<typeof ImplementationRecommendation>;

/** Everything the Analysis tab needs, in one request. */
export const IdeaAnalysisResponse = z.object({
  ideaId: Id,
  ideaVersionId: Id,
  versionNo: z.number().int().min(1),
  run: AnalysisRunStatus,
  proposal: StructuredProposal.nullable(),
  useCases: z.array(UseCase),
  valueFindings: z.array(ValueFinding),
  marketFindings: z.array(MarketFinding),
  feasibility: FeasibilityAssessment.nullable(),
  risks: z.array(Risk),
  dependencies: z.array(Dependency),
  plan: ImplementationPlan.nullable(),
  recommendation: ImplementationRecommendation.nullable(),
});
export type IdeaAnalysisResponse = z.infer<typeof IdeaAnalysisResponse>;

/** SSE frame for live progress. Documented here so the client contract is explicit. */
export const AnalysisProgressEvent = z.object({
  analysisRunId: Id,
  step: AnalysisStep,
  status: AnalysisStatus,
  at: Timestamp,
});
export type AnalysisProgressEvent = z.infer<typeof AnalysisProgressEvent>;

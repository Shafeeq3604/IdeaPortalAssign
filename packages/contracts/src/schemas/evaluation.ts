import { z } from "zod";
import {
  Band, Confidence, CriterionDirection, CriterionGroup, CriterionSourceKind,
  ExplanationSource, MaturityLevel, ScoreSource,
} from "../enums.js";
import { ActorRef, Id, PageQuery, Timestamp, paginated } from "./common.js";

/**
 * Evaluation, ranking, explanation and improvement (FR-12..FR-17).
 *
 * Every number in this file is produced by `packages/scoring`, never by a model
 * (ADR-005). Every score arrives with its evidence, and no ranking arrives without
 * its explanation — P-2 is a property of the response shape, not a UI convention.
 */

const Score = z.number().min(0).max(100);
const Weight = z.number().min(0).max(1);
const Evidence = z.array(z.string()).min(1);

export const ScoreOverrideInfo = z.object({
  reviewer: ActorRef,
  previousNormalized: Score,
  newNormalized: Score,
  reason: z.string().min(1),
  at: Timestamp,
});
export type ScoreOverrideInfo = z.infer<typeof ScoreOverrideInfo>;

export const CriterionScore = z.object({
  criterionKey: z.string(),
  criterionLabel: z.string(),
  group: CriterionGroup,
  direction: CriterionDirection,
  rawBand: Band.nullable(),
  normalized: Score,
  weight: Weight,
  /** normalized × weight — what this criterion actually contributed. */
  contribution: z.number(),
  source: ScoreSource,
  confidence: Confidence,
  rationale: z.string(),
  /** Non-empty: P-7, enforced by DB CHECK and re-stated here. */
  evidence: Evidence,
  override: ScoreOverrideInfo.nullable(),
});
export type CriterionScore = z.infer<typeof CriterionScore>;

export const ExplanationItem = z.object({
  criterionKey: z.string(),
  criterionLabel: z.string(),
  contribution: z.number(),
  shareOfTotal: z.number().min(0).max(1),
  text: z.string(),
  evidence: z.array(z.string()),
});
export type ExplanationItem = z.infer<typeof ExplanationItem>;

export const PeerComparison = z.object({
  peerIdeaId: Id,
  peerTitle: z.string(),
  peerRank: z.number().int().min(1),
  text: z.string(),
  divergentCriteria: z.array(
    z.object({ criterionKey: z.string(), self: Score, peer: Score }),
  ),
});
export type PeerComparison = z.infer<typeof PeerComparison>;

/** FR-14. Both lists non-empty — a rank is never returned as a bare number (P-2). */
export const RankingExplanation = z.object({
  strengths: z.array(ExplanationItem).min(1),
  constraints: z.array(ExplanationItem).min(1),
  peerComparisons: z.array(PeerComparison),
  tieBreakNote: z.string().nullable(),
  generatedBy: ExplanationSource,
});
export type RankingExplanation = z.infer<typeof RankingExplanation>;

export const RankingPosition = z.object({
  runId: Id,
  rank: z.number().int().min(1),
  previousRank: z.number().int().min(1).nullable(),
  percentile: z.number().min(0).max(100),
  cohortSize: z.number().int().min(1),
  computedAt: Timestamp,
  /** Required, not optional. The type makes an unexplained rank unrepresentable. */
  explanation: RankingExplanation,
});
export type RankingPosition = z.infer<typeof RankingPosition>;

export const IdeaEvaluationResponse = z.object({
  ideaId: Id,
  ideaVersionId: Id,
  versionNo: z.number().int().min(1),
  profile: z.object({ key: z.string(), name: z.string() }),
  engineVersion: z.string(),
  compositeScore: Score,
  /** Independent of compositeScore and never an input to it (P-5, FR-17). */
  maturityLevel: MaturityLevel,
  criterionScores: z.array(CriterionScore).min(1),
  ranking: RankingPosition.nullable(),
  computedAt: Timestamp,
});
export type IdeaEvaluationResponse = z.infer<typeof IdeaEvaluationResponse>;

export const OverrideScoreRequest = z.object({
  criterionKey: z.string().min(1),
  newNormalized: Score,
  /** FR-22: mandatory. Rejected without it, and audited with it. */
  reason: z.string().trim().min(1).max(2_000),
});
export type OverrideScoreRequest = z.infer<typeof OverrideScoreRequest>;

/* ── Ranked board ── */

export const RankingEntry = z.object({
  rank: z.number().int().min(1),
  previousRank: z.number().int().min(1).nullable(),
  ideaId: Id,
  title: z.string(),
  compositeScore: Score,
  percentile: z.number().min(0).max(100),
  maturityLevel: MaturityLevel,
  feasibilityStatus: z.string().nullable(),
  department: z.string().nullable(),
  submitter: ActorRef,
  /** The board shows why inline — never a bare ordered list (P-2). */
  topStrength: ExplanationItem.nullable(),
  topConstraint: ExplanationItem.nullable(),
});
export type RankingEntry = z.infer<typeof RankingEntry>;

export const RankingRunMeta = z.object({
  runId: Id,
  profileKey: z.string(),
  profileName: z.string(),
  engineVersion: z.string(),
  cohortSize: z.number().int().min(0),
  computedAt: Timestamp,
  triggerReason: z.string(),
});
export type RankingRunMeta = z.infer<typeof RankingRunMeta>;

export const ListRankingsQuery = PageQuery.extend({
  profile: z.string().min(1).optional(),
  departmentId: Id.optional(),
  categoryId: Id.optional(),
  rankBand: z.enum(["top10", "top25", "top50", "all"]).default("all"),
  sort: z.enum(["rank", "delta", "recent"]).default("rank"),
});
export type ListRankingsQuery = z.infer<typeof ListRankingsQuery>;

export const ListRankingsResponse = paginated(RankingEntry).extend({ run: RankingRunMeta });
export type ListRankingsResponse = z.infer<typeof ListRankingsResponse>;

export const CompareQuery = z.object({
  ids: z.array(Id).min(2).max(4),
  profile: z.string().min(1).optional(),
});
export type CompareQuery = z.infer<typeof CompareQuery>;

export const CompareResponse = z.object({
  run: RankingRunMeta,
  ideas: z.array(
    z.object({
      ideaId: Id,
      title: z.string(),
      rank: z.number().int().min(1).nullable(),
      compositeScore: Score,
      maturityLevel: MaturityLevel,
      criterionScores: z.array(CriterionScore),
    }),
  ),
  /** Where they actually differ — a comparison must compare, not list (SPEC §7.7). */
  divergentCriteria: z.array(
    z.object({
      criterionKey: z.string(),
      criterionLabel: z.string(),
      spread: z.number(),
      byIdea: z.array(z.object({ ideaId: Id, normalized: Score })),
    }),
  ),
});
export type CompareResponse = z.infer<typeof CompareResponse>;

export const RecomputeRequest = z.object({
  profileKey: z.string().min(1),
  reason: z.string().trim().min(1).max(500),
});
export type RecomputeRequest = z.infer<typeof RecomputeRequest>;

/* ── Config, read-only in M1 (FR-13, SPEC §9.10) ── */

export const CriterionDefinition = z.object({
  key: z.string(),
  label: z.string(),
  description: z.string(),
  group: CriterionGroup,
  direction: CriterionDirection,
  sourceKind: CriterionSourceKind,
  isActive: z.boolean(),
  usedInProfiles: z.array(z.string()),
});
export type CriterionDefinition = z.infer<typeof CriterionDefinition>;

export const ProfileDefinition = z.object({
  key: z.string(),
  name: z.string(),
  description: z.string(),
  isDefault: z.boolean(),
  isActive: z.boolean(),
  weights: z.array(
    z.object({ criterionKey: z.string(), criterionLabel: z.string(), weight: Weight }),
  ),
});
export type ProfileDefinition = z.infer<typeof ProfileDefinition>;

export const ListCriteriaResponse = z.object({ items: z.array(CriterionDefinition) });
export const ListProfilesResponse = z.object({ items: z.array(ProfileDefinition) });
export type ListCriteriaResponse = z.infer<typeof ListCriteriaResponse>;
export type ListProfilesResponse = z.infer<typeof ListProfilesResponse>;

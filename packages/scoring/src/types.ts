import type {
  Band, Confidence, EffortClass, FeasibilityStatus, Horizon, MaturityLevel,
  RiskLevel, ScoreSource, UserCountBand,
} from "@iep/contracts";
import type { CriterionDef, ProfileDef } from "@iep/contracts";

/**
 * Engine interfaces (SPEC §14 P0.8). Signatures FROZEN AT P0; implementations are P4.
 *
 * packages/scoring is PURE: no I/O, no network, no clock, no randomness. Everything it
 * needs arrives as an argument. That is what makes the ranking reproducible byte-for-byte
 * and testable to 100% branch coverage (SPEC §11.1).
 *
 * ── ADR-005, structurally ──
 * The FactorSet below is the ONLY input. Note what it does not contain: a score, a rank,
 * or any number the model produced. Bands and classes are ordinal labels; the engine maps
 * them to numbers. There is no path from model output to a score column.
 */

// ───────────────────────────── INPUT: factors ─────────────────────────────

export interface EvidencedFactor<T> {
  readonly value: T;
  /** Non-empty. P-7 is enforced at the DB too, but the engine refuses empty evidence first. */
  readonly evidence: readonly string[];
  readonly rationale: string;
  readonly source: ScoreSource;
  readonly confidence: Confidence;
}

export interface UseCaseFactor {
  readonly kind: "DIRECT" | "INDIRECT";
  readonly horizon: Horizon;
  readonly reachBand: UserCountBand;
  readonly isSpeculative: boolean;
  readonly departmentScope: readonly string[];
}

export interface RiskFactor {
  readonly category: string;
  readonly level: RiskLevel;
  /** FR-10: every risk has one. The engine treats a mitigated risk as lower exposure. */
  readonly hasMitigation: boolean;
}

export interface FactorSet {
  readonly ideaVersionId: string;
  readonly value: Readonly<Record<string, EvidencedFactor<Band>>>;
  readonly feasibility: Readonly<Record<string, EvidencedFactor<Band>>>;
  readonly feasibilityStatus: EvidencedFactor<FeasibilityStatus>;
  readonly useCases: readonly UseCaseFactor[];
  readonly risks: readonly RiskFactor[];
  readonly effortClass: EvidencedFactor<EffortClass>;
  readonly costClass: EvidencedFactor<EffortClass>;
  readonly timelineTotalWeeks: EvidencedFactor<{ min: number; max: number }>;
  /** M2 (P11). Empty in M1 — the SIGNAL source kind exists so no engine change is needed. */
  readonly signals: Readonly<Record<string, EvidencedFactor<number>>>;
  /** Field completeness, for maturity classification only. Never feeds the composite. */
  readonly completeness: CompletenessInput;
}

export interface CompletenessInput {
  readonly hasProblemStatement: boolean;
  readonly hasExpectedUsers: boolean;
  readonly hasExpectedOutcome: boolean;
  readonly hasUseCases: boolean;
  readonly hasSuggestedTechnology: boolean;
  readonly hasEvidenceOfDemand: boolean;
  readonly hasPrototypeEvidence: boolean;
  readonly hasImplementationPlan: boolean;
  readonly hasRisks: boolean;
  readonly hasKpis: boolean;
}

// ───────────────────────────── OUTPUT: scores ─────────────────────────────

export interface CriterionScoreResult {
  readonly criterionKey: string;
  readonly rawBand: Band | null;
  /** 0..100 */
  readonly normalized: number;
  readonly weight: number;
  /** normalized × weight */
  readonly contribution: number;
  readonly source: ScoreSource;
  readonly confidence: Confidence;
  readonly rationale: string;
  readonly evidence: readonly string[];
}

export interface EvaluationResult {
  readonly ideaVersionId: string;
  readonly profileKey: string;
  readonly engineVersion: string;
  readonly compositeScore: number;
  readonly maturityLevel: MaturityLevel;
  readonly criterionScores: readonly CriterionScoreResult[];
}

export interface RankingEntryResult {
  readonly ideaId: string;
  readonly evaluationId: string;
  readonly rank: number;
  readonly compositeScore: number;
  readonly percentile: number;
  readonly previousRank: number | null;
  /** Which rule broke a tie, if one did. Surfaced in the explanation (SPEC §9.4). */
  readonly tieBreakApplied: TieBreakRule | null;
}

export type TieBreakRule = "FEASIBILITY" | "MATURITY" | "SUBMITTED_EARLIER";

export interface RankingResult {
  readonly profileKey: string;
  readonly engineVersion: string;
  readonly cohortKey: Readonly<Record<string, unknown>>;
  readonly entries: readonly RankingEntryResult[];
}

// ───────────────────────────── OUTPUT: explanation ─────────────────────────────

export interface ExplanationItem {
  readonly criterionKey: string;
  readonly criterionLabel: string;
  readonly contribution: number;
  /** Share of the composite this criterion accounts for, 0..1. */
  readonly shareOfTotal: number;
  readonly text: string;
  readonly evidence: readonly string[];
}

export interface PeerComparison {
  readonly peerIdeaId: string;
  readonly peerRank: number;
  readonly text: string;
  readonly divergentCriteria: readonly {
    readonly criterionKey: string;
    readonly self: number;
    readonly peer: number;
  }[];
}

export interface ExplanationResult {
  readonly strengths: readonly ExplanationItem[];
  readonly constraints: readonly ExplanationItem[];
  readonly peerComparisons: readonly PeerComparison[];
  readonly tieBreakNote: string | null;
}

// ───────────────────────────── THE FOUR ENTRY POINTS ─────────────────────────────

export interface EngineConfig {
  readonly criteria: readonly CriterionDef[];
  readonly profile: ProfileDef;
  /** Below this composite, improvement recommendations are generated (P-4, D-13). */
  readonly attentionThreshold: number;
  readonly engineVersion: string;
}

export interface Engine {
  evaluate(factors: FactorSet, config: EngineConfig): EvaluationResult;

  rank(
    evaluations: readonly EvaluationResult[],
    context: {
      readonly ideaIdByVersionId: Readonly<Record<string, string>>;
      readonly evaluationIdByVersionId: Readonly<Record<string, string>>;
      readonly submittedAtByIdeaId: Readonly<Record<string, string>>;
      readonly feasibilityByVersionId: Readonly<Record<string, FeasibilityStatus>>;
      readonly previousRunEntries?: readonly RankingEntryResult[] | undefined;
      readonly cohortKey: Readonly<Record<string, unknown>>;
    },
  ): RankingResult;

  /**
   * ADR-006: deterministic. Reads the contribution vector, not the idea text.
   * Every claim it makes is therefore true by construction — faithfulness is a
   * 100% deterministic, PR-blocking check (SPEC §12.4), not an eval target.
   */
  explain(
    entry: RankingEntryResult,
    evaluation: EvaluationResult,
    peers: readonly { entry: RankingEntryResult; evaluation: EvaluationResult }[],
    config: EngineConfig,
  ): ExplanationResult;

  /** FR-17. Independent of composite score and never an input to it (P-5). */
  classifyMaturity(completeness: CompletenessInput): MaturityLevel;
}

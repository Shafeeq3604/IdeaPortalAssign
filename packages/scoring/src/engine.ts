import { BAND_ANCHORS } from "@iep/contracts";
import type { Band, CriterionDef, EffortClass, MaturityLevel, RiskLevel } from "@iep/contracts";
import type {
  CompletenessInput, CriterionScoreResult, Engine, EngineConfig, EvaluationResult,
  ExplanationItem, ExplanationResult, FactorSet, PeerComparison, RankingEntryResult,
  RankingResult, TieBreakRule, UseCaseFactor, EvidencedFactor,
} from "./types.js";

/**
 * The evaluation, ranking and explanation engine (P4).
 *
 * PURE. No I/O, no clock, no randomness — see the architecture test that enforces it.
 * That is what makes a ranking reproducible byte-for-byte and lets `engineVersion` mean
 * something: the same factors and the same config always give the same answer.
 *
 * ADR-005 in practice: the input is ordinal bands and classes. Every NUMBER in the output
 * originates here, never from a model.
 */

const round = (n: number, dp = 3): number => Number(n.toFixed(dp));
const clamp = (n: number): number => Math.min(100, Math.max(0, n));

/** Ordinal → 0..100. The single place a band becomes a number. */
const bandToScore = (band: Band): number => BAND_ANCHORS[band];

const EFFORT_SCORE: Record<EffortClass, number> = {
  LOW: 95, MEDIUM: 65, HIGH: 35, VERY_HIGH: 10,
};

const RISK_WEIGHT: Record<RiskLevel, number> = { LOW: 1, MEDIUM: 3, HIGH: 7, CRITICAL: 14 };

const REACH_SCORE: Record<UseCaseFactor["reachBand"], number> = {
  LT10: 10, B10_100: 30, B100_1K: 55, B1K_10K: 80, GT10K: 95,
};

/** Used when a factor is absent entirely: neutral, low confidence, and SAID so. */
const MISSING_NOTE = "not analysed — reviewer input required";

interface Derived {
  readonly score: number;
  readonly band: Band | null;
  readonly evidence: readonly string[];
  readonly rationale: string;
  readonly source: CriterionScoreResult["source"];
  readonly confidence: CriterionScoreResult["confidence"];
}

const fromFactor = (f: EvidencedFactor<Band>): Derived => ({
  score: bandToScore(f.value),
  band: f.value,
  evidence: f.evidence,
  rationale: f.rationale,
  source: f.source,
  confidence: f.confidence,
});

const missing = (): Derived => ({
  score: 50,
  band: null,
  evidence: [MISSING_NOTE],
  rationale: MISSING_NOTE,
  source: "FALLBACK",
  confidence: "LOW",
});

/** Aggregate risk → an exposure score. Mitigated risks weigh less, they do not vanish. */
function riskExposure(factors: FactorSet): Derived {
  if (factors.risks.length === 0) return missing();
  const total = factors.risks.reduce(
    (acc, r) => acc + RISK_WEIGHT[r.level] * (r.hasMitigation ? 0.6 : 1),
    0,
  );
  return {
    // LOWER_IS_BETTER: this is exposure, inverted later by `direction`.
    score: clamp(Math.min(100, total * 4)),
    band: null,
    evidence: [`${factors.risks.length} risk(s) identified, weighted by level and mitigation`],
    rationale: `Aggregate exposure across ${factors.risks.length} risk(s)`,
    source: "AI",
    confidence: "MEDIUM",
  };
}

function useCaseDerived(factors: FactorSet, kind: "reach" | "breadth" | "scalability" | "long"): Derived {
  const real = factors.useCases.filter((u) => !u.isSpeculative);
  if (factors.useCases.length === 0) return missing();

  switch (kind) {
    case "reach": {
      const best = Math.max(...factors.useCases.map((u) => REACH_SCORE[u.reachBand]));
      return {
        score: best, band: null,
        evidence: [`widest reach band across ${factors.useCases.length} use case(s)`],
        rationale: "Largest plausible audience among identified use cases",
        source: "AI", confidence: "MEDIUM",
      };
    }
    case "breadth": {
      // Currently-realistic use cases count fully; speculative ones count for less (FR-04).
      const weighted = real.length + (factors.useCases.length - real.length) * 0.4;
      return {
        score: clamp(weighted * 18), band: null,
        evidence: [`${real.length} realistic and ${factors.useCases.length - real.length} speculative use case(s)`],
        rationale: "Breadth of currently realistic applications",
        source: "AI", confidence: "MEDIUM",
      };
    }
    case "scalability": {
      const departments = new Set(factors.useCases.flatMap((u) => u.departmentScope)).size;
      const indirect = factors.useCases.filter((u) => u.kind === "INDIRECT").length;
      return {
        score: clamp(30 + departments * 12 + indirect * 15), band: null,
        evidence: [`${indirect} indirect use case(s) across ${departments} department scope(s)`],
        rationale: "Growth beyond the first use case without a rebuild",
        source: "AI", confidence: "MEDIUM",
      };
    }
    case "long": {
      const long = factors.useCases.filter((u) => u.horizon === "LONG").length;
      const medium = factors.useCases.filter((u) => u.horizon === "MEDIUM").length;
      return {
        // FR-11: long-horizon value is independent of today's feasibility.
        score: clamp(25 + long * 28 + medium * 12), band: null,
        evidence: [`${long} long-horizon and ${medium} medium-horizon use case(s)`],
        rationale: "Value beyond the immediate horizon",
        source: "AI", confidence: "MEDIUM",
      };
    }
  }
}

function timeToValue(factors: FactorSet): Derived {
  const { min, max } = factors.timelineTotalWeeks.value;
  const midpoint = (min + max) / 2;
  return {
    // 4 weeks ≈ 95, 52 weeks ≈ 10. Preliminary by definition (FR-08, D-11).
    score: clamp(100 - (midpoint - 4) * 1.8),
    band: null,
    evidence: factors.timelineTotalWeeks.evidence,
    rationale: `Preliminary estimate of ${min}–${max} weeks to first value`,
    source: factors.timelineTotalWeeks.source,
    confidence: factors.timelineTotalWeeks.confidence,
  };
}

/**
 * factor → criterion mapping. Hand-authored config (risk R1 in SPEC §17.9) and therefore
 * kept in ONE readable place rather than scattered through the calculation.
 */
function deriveForCriterion(criterion: CriterionDef, factors: FactorSet): Derived {
  const value = (key: string): Derived => {
    const f = factors.value[key];
    return f ? fromFactor(f) : missing();
  };
  const feas = (key: string): Derived => {
    const f = factors.feasibility[key];
    return f ? fromFactor(f) : missing();
  };

  switch (criterion.key) {
    case "business_impact": return value("BUSINESS_IMPACT");
    case "problem_severity": return value("PROBLEM_SEVERITY");
    case "strategic_alignment": return value("OPERATIONAL");
    case "user_reach": return useCaseDerived(factors, "reach");
    case "use_case_breadth": return useCaseDerived(factors, "breadth");
    case "scalability": return useCaseDerived(factors, "scalability");
    case "long_term_potential": return useCaseDerived(factors, "long");
    case "technical_feasibility": return feas("TECHNICAL");
    case "data_availability": return feas("DATA");
    case "risk_exposure": return riskExposure(factors);
    case "time_to_value": return timeToValue(factors);

    case "implementation_effort": {
      const f = factors.effortClass;
      return {
        // LOWER_IS_BETTER: store the effort magnitude; `direction` inverts it below.
        score: 100 - EFFORT_SCORE[f.value],
        band: null, evidence: f.evidence,
        rationale: `Estimated effort: ${f.value}`,
        source: f.source, confidence: f.confidence,
      };
    }
    case "cost_efficiency": {
      const f = factors.costClass;
      return {
        score: EFFORT_SCORE[f.value], band: null, evidence: f.evidence,
        rationale: `Estimated cost: ${f.value}`,
        source: f.source, confidence: f.confidence,
      };
    }
    case "demonstrated_demand": {
      const signal = factors.signals["demonstrated_demand"];
      // M2 (P11). Weighted 0 in M1, so a neutral value cannot distort a rank.
      if (!signal) {
        return {
          score: 0, band: null,
          evidence: ["demand signals are collected from M2"],
          rationale: "Not yet collected",
          source: "SIGNAL", confidence: "LOW",
        };
      }
      return {
        score: clamp(signal.value), band: null, evidence: signal.evidence,
        rationale: signal.rationale, source: "SIGNAL", confidence: signal.confidence,
      };
    }
    default:
      return missing();
  }
}

function evaluate(factors: FactorSet, config: EngineConfig): EvaluationResult {
  const active = config.criteria.filter((c) => c.isActive !== false);
  const scores: CriterionScoreResult[] = [];

  for (const criterion of active) {
    const weight = config.profile.weights[criterion.key] ?? 0;
    const derived = deriveForCriterion(criterion, factors);

    // Direction is applied HERE, once. "Lower is better" means a high raw magnitude
    // produces a low normalized score — it never means a negative contribution.
    const normalized = clamp(
      criterion.direction === "LOWER_IS_BETTER" ? 100 - derived.score : derived.score,
    );

    scores.push({
      criterionKey: criterion.key,
      rawBand: derived.band,
      normalized: round(normalized),
      weight: round(weight, 4),
      contribution: round(normalized * weight),
      source: derived.source,
      confidence: derived.confidence,
      rationale: derived.rationale,
      evidence: derived.evidence.length > 0 ? derived.evidence : [MISSING_NOTE],
    });
  }

  const composite = round(scores.reduce((acc, s) => acc + s.contribution, 0));

  return {
    ideaVersionId: factors.ideaVersionId,
    profileKey: config.profile.key,
    engineVersion: config.engineVersion,
    compositeScore: clamp(composite),
    maturityLevel: classifyMaturity(factors.completeness),
    criterionScores: scores,
  };
}

/**
 * FR-17. Derived from completeness and evidence only — never from the score, and never
 * an input to it. An immature idea is not a bad idea (REQUIREMENTS §20).
 */
function classifyMaturity(c: CompletenessInput): MaturityLevel {
  const level5 = c.hasImplementationPlan && c.hasRisks && c.hasKpis;
  const level4 = c.hasEvidenceOfDemand || c.hasPrototypeEvidence;
  const level3 = c.hasUseCases && c.hasSuggestedTechnology;
  const level2 = c.hasProblemStatement && c.hasExpectedUsers;

  if (level5 && level4 && level3 && level2) return 5;
  if (level4 && level3 && level2) return 4;
  if (level3 && level2) return 3;
  if (level2) return 2;
  return 1;
}

const FEASIBILITY_ORDER: Record<string, number> = {
  HIGHLY_FEASIBLE: 4,
  FEASIBLE_WITH_CONDITIONS: 3,
  REQUIRES_INVESTIGATION: 2,
  NOT_CURRENTLY_FEASIBLE: 1,
};

function rank(
  evaluations: readonly EvaluationResult[],
  context: Parameters<Engine["rank"]>[1],
): RankingResult {
  const previousByIdea = new Map(
    (context.previousRunEntries ?? []).map((e) => [e.ideaId, e.rank]),
  );

  const rows = evaluations.map((evaluation) => {
    const ideaId = context.ideaIdByVersionId[evaluation.ideaVersionId] ?? evaluation.ideaVersionId;
    return {
      evaluation,
      ideaId,
      evaluationId: context.evaluationIdByVersionId[evaluation.ideaVersionId] ?? "",
      feasibility: FEASIBILITY_ORDER[context.feasibilityByVersionId[evaluation.ideaVersionId] ?? ""] ?? 0,
      submittedAt: context.submittedAtByIdeaId[ideaId] ?? "",
    };
  });

  /** Tie-breaks in SPEC §9.4 order, reported so the explanation can say which applied. */
  const compare = (a: typeof rows[number], b: typeof rows[number]): { d: number; rule: TieBreakRule | null } => {
    const byScore = b.evaluation.compositeScore - a.evaluation.compositeScore;
    if (Math.abs(byScore) > 1e-9) return { d: byScore, rule: null };

    const byFeasibility = b.feasibility - a.feasibility;
    if (byFeasibility !== 0) return { d: byFeasibility, rule: "FEASIBILITY" };

    const byMaturity = b.evaluation.maturityLevel - a.evaluation.maturityLevel;
    if (byMaturity !== 0) return { d: byMaturity, rule: "MATURITY" };

    // Earlier submission wins. Comparing ISO strings is safe and keeps the engine
    // clock-free — no Date construction anywhere in this package.
    if (a.submittedAt !== b.submittedAt) {
      return { d: a.submittedAt < b.submittedAt ? -1 : 1, rule: "SUBMITTED_EARLIER" };
    }
    // Final fallback so ordering is total, not merely mostly-defined.
    return { d: a.ideaId < b.ideaId ? -1 : 1, rule: "SUBMITTED_EARLIER" };
  };

  const sorted = [...rows].sort((a, b) => compare(a, b).d);
  const n = sorted.length;

  const entries: RankingEntryResult[] = sorted.map((row, index) => {
    const rankNo = index + 1;
    // A tie-break applies to BOTH rows it separated, not just the one placed second —
    // the winner's position was equally decided by it, and its explanation should say so.
    const previous = sorted[index - 1];
    const next = sorted[index + 1];
    const rule =
      (previous ? compare(previous, row).rule : null) ??
      (next ? compare(row, next).rule : null);

    return {
      ideaId: row.ideaId,
      evaluationId: row.evaluationId,
      rank: rankNo,
      compositeScore: row.evaluation.compositeScore,
      percentile: n === 1 ? 100 : round(((n - rankNo) / (n - 1)) * 100, 2),
      previousRank: previousByIdea.get(row.ideaId) ?? null,
      tieBreakApplied: rule,
    };
  });

  return {
    profileKey: evaluations[0]?.profileKey ?? "",
    engineVersion: evaluations[0]?.engineVersion ?? "",
    cohortKey: context.cohortKey,
    entries,
  };
}

/**
 * ADR-006 — explanations are DERIVED, not generated.
 *
 * Reads the contribution vector and nothing else, so every claim is true by construction.
 * That is why faithfulness is a deterministic, PR-blocking check rather than an eval
 * target: the engine cannot cite a factor that did not move the score.
 */
function explain(
  entry: RankingEntryResult,
  evaluation: EvaluationResult,
  peers: readonly { entry: RankingEntryResult; evaluation: EvaluationResult }[],
  config: EngineConfig,
): ExplanationResult {
  const labelOf = (key: string): string =>
    config.criteria.find((c) => c.key === key)?.label ?? key;

  const total = evaluation.compositeScore || 1;
  const scored = evaluation.criterionScores.filter((s) => s.weight > 0);

  const toItem = (s: CriterionScoreResult, text: string): ExplanationItem => ({
    criterionKey: s.criterionKey,
    criterionLabel: labelOf(s.criterionKey),
    contribution: s.contribution,
    shareOfTotal: Math.min(1, Math.max(0, round(s.contribution / total, 4))),
    text,
    evidence: s.evidence,
  });

  // Strengths: real positive contributors, largest first. Never a criterion at zero.
  const strengths = scored
    .filter((s) => s.contribution > 0)
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 4)
    .map((s) =>
      toItem(
        s,
        `${labelOf(s.criterionKey)} scored ${s.normalized} of 100 and carries ` +
          `${Math.round(s.weight * 100)}% of this profile, adding ${s.contribution.toFixed(1)} points.`,
      ),
    );

  // Constraints: the largest gaps between what a criterion contributed and what it could
  // have. This is what "held the rank back" actually means, rather than "scored low".
  const constraints = scored
    .filter((s) => s.normalized < 100)
    .map((s) => ({ s, shortfall: (100 - s.normalized) * s.weight }))
    .sort((a, b) => b.shortfall - a.shortfall)
    .slice(0, 4)
    .map(({ s, shortfall }) =>
      toItem(
        s,
        `${labelOf(s.criterionKey)} scored ${s.normalized} of 100; closing that gap would ` +
          `add up to ${shortfall.toFixed(1)} points under this profile.`,
      ),
    );

  const peerComparisons: PeerComparison[] = peers.map(({ entry: peerEntry, evaluation: peerEval }) => {
    const byKey = new Map(peerEval.criterionScores.map((s) => [s.criterionKey, s]));
    const divergent = scored
      .map((s) => ({ s, peer: byKey.get(s.criterionKey) }))
      .filter((x): x is { s: CriterionScoreResult; peer: CriterionScoreResult } => x.peer !== undefined)
      .map(({ s, peer }) => ({
        criterionKey: s.criterionKey,
        self: s.normalized,
        peer: peer.normalized,
        gap: Math.abs(s.normalized - peer.normalized) * s.weight,
      }))
      .filter((x) => x.gap > 0.01)
      .sort((a, b) => b.gap - a.gap)
      .slice(0, 3);

    const ahead = entry.rank < peerEntry.rank;
    const lead = divergent.filter((d) => (ahead ? d.self > d.peer : d.peer > d.self));
    const named = lead.map((d) => labelOf(d.criterionKey));

    return {
      peerIdeaId: peerEntry.ideaId,
      peerRank: peerEntry.rank,
      text:
        named.length > 0
          ? `Ranked ${ahead ? "above" : "below"} #${peerEntry.rank} mainly on ` +
            `${named.join(" and ")}.`
          : `Ranked ${ahead ? "above" : "below"} #${peerEntry.rank}; the two score closely across criteria.`,
      divergentCriteria: divergent.map(({ criterionKey, self, peer }) => ({ criterionKey, self, peer })),
    };
  });

  const tieBreakNote =
    entry.tieBreakApplied === null
      ? null
      : {
          FEASIBILITY: "Tied on score; placed by the stronger feasibility assessment.",
          MATURITY: "Tied on score and feasibility; placed by the higher maturity level.",
          SUBMITTED_EARLIER: "Tied on score, feasibility and maturity; the earlier submission was placed first.",
        }[entry.tieBreakApplied];

  return { strengths, constraints, peerComparisons, tieBreakNote };
}

export function createEngine(): Engine {
  return { evaluate, rank, explain, classifyMaturity };
}

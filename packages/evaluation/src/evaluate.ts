import type { PrismaClient } from "@iep/db";
import { createEngine } from "@iep/scoring";
import type { EvaluationResult } from "@iep/scoring";
import { buildFactorSet, loadEngineConfig } from "./factors.js";

/**
 * Evaluate one idea version and persist the result (FR-12, FR-17).
 *
 * Deterministic and re-runnable: the unique key on `evaluations` is
 * (version, profile, engineVersion), so re-evaluating the same version under the same
 * engine REPLACES its scores rather than accumulating a second opinion.
 *
 * Human overrides live in `score_overrides` and are re-applied after the engine writes,
 * so a recompute never silently discards a reviewer's decision (FR-22).
 */

const engine = createEngine();

export interface EvaluateOutcome {
  readonly evaluationId: string;
  readonly compositeScore: number;
  readonly maturityLevel: number;
  readonly overridesReapplied: number;
}

export async function evaluateVersion(
  db: PrismaClient,
  ideaVersionId: string,
  profileKey?: string,
): Promise<EvaluateOutcome | null> {
  const factors = await buildFactorSet(db, ideaVersionId);
  if (!factors) return null;

  const { config, profileId, criterionIdByKey } = await loadEngineConfig(db, profileKey);
  const result = engine.evaluate(factors, config);

  return persistEvaluation(db, { result, profileId, criterionIdByKey });
}

export async function persistEvaluation(
  db: PrismaClient,
  input: {
    result: EvaluationResult;
    profileId: string;
    criterionIdByKey: ReadonlyMap<string, string>;
  },
): Promise<EvaluateOutcome> {
  const { result, profileId, criterionIdByKey } = input;

  return db.$transaction(async (tx) => {
    const evaluation = await tx.evaluation.upsert({
      where: {
        ideaVersionId_profileId_engineVersion: {
          ideaVersionId: result.ideaVersionId,
          profileId,
          engineVersion: result.engineVersion,
        },
      },
      update: {
        compositeScore: result.compositeScore,
        maturityLevel: result.maturityLevel,
        computedAt: new Date(),
      },
      create: {
        ideaVersionId: result.ideaVersionId,
        profileId,
        engineVersion: result.engineVersion,
        compositeScore: result.compositeScore,
        maturityLevel: result.maturityLevel,
      },
    });

    /**
     * Overrides are read BEFORE the scores are rewritten and re-applied after.
     *
     * The alternative — delete and recreate — would drop every reviewer adjustment on
     * the next recompute, which is the kind of data loss nobody notices until a
     * reviewer asks why their decision disappeared.
     */
    const priorOverrides = await tx.scoreOverride.findMany({
      where: { criterionScore: { evaluationId: evaluation.id } },
      include: { criterionScore: { select: { criterionId: true } } },
      orderBy: { createdAt: "asc" },
    });
    const latestByCriterion = new Map(
      priorOverrides.map((o) => [o.criterionScore.criterionId, o]),
    );

    for (const score of result.criterionScores) {
      const criterionId = criterionIdByKey.get(score.criterionKey);
      if (!criterionId) continue; // a criterion the catalogue no longer has

      const override = latestByCriterion.get(criterionId);
      const normalized = override ? Number(override.newNormalized) : score.normalized;

      await tx.criterionScore.upsert({
        where: { evaluationId_criterionId: { evaluationId: evaluation.id, criterionId } },
        update: {
          rawBand: score.rawBand,
          normalized,
          weight: score.weight,
          contribution: round(normalized * score.weight),
          // An overridden score is sourced HUMAN, whatever the engine derived it from.
          source: override ? "HUMAN" : score.source,
          confidence: override ? "HIGH" : score.confidence,
          rationale: override ? override.reason : score.rationale,
          evidence: score.evidence.length > 0 ? [...score.evidence] : ["no evidence recorded"],
        },
        create: {
          evaluationId: evaluation.id,
          criterionId,
          rawBand: score.rawBand,
          normalized,
          weight: score.weight,
          contribution: round(normalized * score.weight),
          source: score.source,
          confidence: score.confidence,
          rationale: score.rationale,
          evidence: score.evidence.length > 0 ? [...score.evidence] : ["no evidence recorded"],
        },
      });
    }

    // With overrides re-applied the composite has moved, so it is recomputed from what
    // was actually stored rather than from what the engine originally returned.
    const stored = await tx.criterionScore.findMany({
      where: { evaluationId: evaluation.id },
      select: { contribution: true },
    });
    const composite = round(stored.reduce((acc, s) => acc + Number(s.contribution), 0));

    await tx.evaluation.update({
      where: { id: evaluation.id },
      data: { compositeScore: Math.min(100, Math.max(0, composite)) },
    });

    return {
      evaluationId: evaluation.id,
      compositeScore: composite,
      maturityLevel: result.maturityLevel,
      overridesReapplied: latestByCriterion.size,
    };
  });
}

const round = (n: number, dp = 3): number => Number(n.toFixed(dp));

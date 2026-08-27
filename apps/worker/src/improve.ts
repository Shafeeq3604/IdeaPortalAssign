import type { PrismaClient } from "@iep/db";
import { analyseStep, type AiProvider, type ImprovementOutput } from "@iep/ai";
import type { ModelRoute } from "@iep/ai";
import type { AnalysisStep, RankingEffect } from "@iep/contracts";
import { ATTENTION_THRESHOLD, loadEngineConfig } from "./factors.js";

/**
 * AI-08 — improvement recommendations (FR-15, SPEC §9.6, P-4).
 *
 * The one place the product tells someone what to DO. Two things make it trustworthy:
 *
 *  - It runs on the CONTRIBUTION VECTOR, not on the idea text. The model is told which
 *    criteria cost this idea the most and by how much, so its advice is aimed at the
 *    weaknesses the engine actually found rather than at whatever reads badly.
 *  - The vector is TRUSTED CONTEXT, not the untrusted block. It came from our own engine.
 *    The submission still goes in delimited and untrusted.
 *
 * A strong idea gets nothing, and that is a correct result (D-13) — padding the list to
 * look helpful would teach people to ignore it.
 */

export interface ImproveDeps {
  readonly db: PrismaClient;
  readonly provider: AiProvider;
  readonly budgetUsd: number;
  readonly redactionEnabled: boolean;
}

export interface ImproveOutcome {
  readonly generated: number;
  readonly skippedReason: string | null;
}

/** How many of the weakest criteria the model is shown. More is noise, not insight. */
const WEAKEST_SHOWN = 6;

export async function generateRecommendations(
  deps: ImproveDeps,
  input: { ideaId: string; ideaVersionId: string },
): Promise<ImproveOutcome> {
  const { db } = deps;

  const evaluation = await db.evaluation.findFirst({
    where: { ideaVersionId: input.ideaVersionId },
    orderBy: { computedAt: "desc" },
    include: { criterionScores: { include: { criterion: true } } },
  });
  if (!evaluation) return { generated: 0, skippedReason: "not evaluated yet" };

  const composite = Number(evaluation.compositeScore);
  if (composite >= ATTENTION_THRESHOLD) {
    /**
     * Not a failure. An idea above the attention threshold has no weak criterion worth
     * writing six paragraphs about, and inventing advice for it would make every other
     * recommendation on the platform less credible.
     */
    return { generated: 0, skippedReason: `composite ${composite} is above the attention threshold` };
  }

  const version = await db.ideaVersion.findUnique({ where: { id: input.ideaVersionId } });
  if (!version) return { generated: 0, skippedReason: "version no longer exists" };

  /**
   * Ranked by what each criterion COST, not by how low it scored.
   *
   * A criterion scoring 20 at weight 0.02 is almost free to fix and changes nothing. One
   * scoring 55 at weight 0.15 is where the points actually went. Sorting by lost
   * contribution is what makes the advice worth acting on.
   */
  const weakest = [...evaluation.criterionScores]
    .map((s) => ({
      criterionKey: s.criterion.key,
      criterionLabel: s.criterion.label,
      description: s.criterion.description,
      normalized: Number(s.normalized),
      weight: Number(s.weight),
      contribution: Number(s.contribution),
      lostContribution: Number(((100 - Number(s.normalized)) * Number(s.weight)).toFixed(3)),
      rationale: s.rationale,
      evidence: s.evidence.slice(0, 3),
    }))
    .filter((s) => s.weight > 0)
    .sort((a, b) => b.lostContribution - a.lostContribution)
    .slice(0, WEAKEST_SHOWN);

  if (weakest.length === 0) return { generated: 0, skippedReason: "no weighted criteria" };

  const routes = await loadRoutes(db);
  const ideaText = [
    version.title, version.problemStatement, version.description,
    version.expectedUsers, version.expectedOutcome,
  ].filter(Boolean).join("\n\n");

  const outcome = await analyseStep(deps.provider, {
    step: "IMPROVEMENT",
    ideaText,
    fields: { title: version.title },
    // Trusted: this is our own engine's output, not anything a submitter wrote.
    trustedContext: {
      compositeScore: composite,
      attentionThreshold: ATTENTION_THRESHOLD,
      weakestCriteria: weakest,
    },
    redactionEnabled: deps.redactionEnabled,
    budgetRemainingUsd: deps.budgetUsd,
    routes,
  });

  const data = outcome.data as ImprovementOutput;
  const items = data?.recommendations ?? [];
  if (items.length === 0) return { generated: 0, skippedReason: "the model proposed nothing" };

  const { criterionIdByKey } = await loadEngineConfig(db);

  const written = await db.$transaction(async (tx) => {
    /**
     * Replace this version's OPEN recommendations, keep everything a human has touched.
     *
     * A recommendation someone dismissed should not reappear on the next re-run — that
     * turns the Improve tab into a nag rather than a tool.
     */
    await tx.improvementRecommendation.deleteMany({
      where: { ideaVersionId: input.ideaVersionId, status: "OPEN" },
    });

    let count = 0;
    for (const item of items) {
      await tx.improvementRecommendation.create({
        data: {
          ideaVersionId: input.ideaVersionId,
          issue: item.issue,
          whyItMatters: item.whyItMatters,
          recommendation: item.recommendation,
          howToImplement: item.howToImplement,
          expectedEffect: item.expectedEffect,
          // Never a promise. The engine decides ranks; this is a direction, not a result.
          projectedRankingEffect: item.projectedRankingEffect as RankingEffect,
          targetCriterionId: item.targetCriterionKey
            ? criterionIdByKey.get(item.targetCriterionKey) ?? null
            : null,
          priority: item.priority,
        },
      });
      count += 1;
    }
    return count;
  });

  return { generated: written, skippedReason: null };
}

async function loadRoutes(db: PrismaClient): Promise<readonly ModelRoute[]> {
  const rows = await db.aiModelRoute.findMany({ where: { enabled: true } });
  return rows.map((r) => ({
    storyKey: r.storyKey as AnalysisStep,
    tier: r.tier,
    modelId: r.modelId,
    effort: (r.effort ?? null) as ModelRoute["effort"],
    thinkingMode: r.thinkingMode,
    thinkingBudgetTokens: r.thinkingBudgetTokens,
    maxTokens: r.maxTokens,
    enabled: r.enabled,
  }));
}

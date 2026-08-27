import { can } from "@iep/contracts";
import type { IdeaStatus } from "@iep/contracts";
import type { Handler } from "../../server.js";
import { sendError } from "../../server.js";
import { presentCriterionScore, presentExplanation, tieBreakNoteFor } from "./present.js";

/**
 * Evaluation reads (P5 — FR-12, FR-14, FR-17) and the improvement list (FR-15).
 *
 * Writes — overrides — are P6 and live in review/routes.ts alongside the audit trail they
 * belong to.
 */

const NOT_FOUND = "No idea with that id";

/** The same read guard every idea-scoped route uses: invisible reads as absent. */
async function readableIdea(
  request: Parameters<Handler>[0],
  ctx: Parameters<Handler>[2],
  ideaId: string,
) {
  const idea = await ctx.db.idea.findUnique({
    where: { id: ideaId },
    include: { currentVersion: { select: { id: true, versionNo: true } } },
  });
  if (!idea?.currentVersion) return null;
  const allowed = can(request.actor!, "idea:read", {
    ideaId: idea.id, submitterId: idea.submitterId, status: idea.status as IdeaStatus,
  }).allowed;
  return allowed ? idea : null;
}

export function registerEvaluationRoutes(handlers: Map<string, Handler>): void {
  handlers.set("getIdeaEvaluation", async (request, reply, ctx) => {
    const { ideaId } = request.params as { ideaId: string };
    const idea = await readableIdea(request, ctx, ideaId);
    if (!idea?.currentVersion) return sendError(reply, "NOT_FOUND", NOT_FOUND);

    const versionId = idea.currentVersion.id;

    const evaluation = await ctx.db.evaluation.findFirst({
      where: { ideaVersionId: versionId },
      orderBy: { computedAt: "desc" },
      include: {
        profile: { select: { key: true, name: true } },
        criterionScores: {
          include: {
            criterion: { select: { key: true, label: true, group: true, direction: true } },
            overrides: {
              include: {
                reviewer: {
                  select: { id: true, displayName: true, department: { select: { name: true } } },
                },
              },
              orderBy: { createdAt: "asc" },
            },
          },
        },
      },
    });

    /**
     * 404, not an empty evaluation.
     *
     * An idea that has not been scored has no evaluation — returning zeros would put a
     * number on screen that no engine produced, which is the one thing ADR-005 forbids.
     * The client shows "not evaluated yet" from the idea's own status.
     */
    if (!evaluation) {
      return sendError(reply, "NOT_FOUND", "This idea has not been evaluated yet");
    }

    /** The most recent run that included this idea. Older runs stay readable by id. */
    const entry = await ctx.db.rankingEntry.findFirst({
      where: { ideaId: idea.id, run: { profileId: evaluation.profileId } },
      orderBy: { run: { computedAt: "desc" } },
      include: {
        run: { select: { id: true, computedAt: true } },
        explanation: true,
      },
    });

    let ranking = null;
    if (entry) {
      const siblings = await ctx.db.rankingEntry.findMany({
        where: { runId: entry.runId },
        select: { ideaId: true, rank: true, compositeScore: true, idea: { select: { currentVersion: { select: { title: true } } } } },
      });

      const titleByIdeaId = new Map(
        siblings.map((s) => [s.ideaId, s.idea.currentVersion?.title ?? "Another idea"]),
      );

      ranking = {
        runId: entry.run.id,
        rank: entry.rank,
        previousRank: entry.previousRank,
        percentile: Number(entry.percentile),
        cohortSize: siblings.length,
        computedAt: entry.run.computedAt.toISOString(),
        explanation: presentExplanation(
          entry.explanation,
          titleByIdeaId,
          tieBreakNoteFor(siblings, entry.rank, entry.compositeScore),
        ),
      };
    }

    return {
      ideaId: idea.id,
      ideaVersionId: versionId,
      versionNo: idea.currentVersion.versionNo,
      profile: { key: evaluation.profile.key, name: evaluation.profile.name },
      engineVersion: evaluation.engineVersion,
      compositeScore: Number(evaluation.compositeScore),
      maturityLevel: evaluation.maturityLevel,
      criterionScores: evaluation.criterionScores
        .map(presentCriterionScore)
        // Heaviest contribution first: the explanation reads top-down, and the thing that
        // moved the score most should not be somewhere in the middle of an alphabet.
        .sort((a, b) => b.contribution - a.contribution),
      ranking,
      computedAt: evaluation.computedAt.toISOString(),
    };
  });

  handlers.set("listRecommendations", async (request, reply, ctx) => {
    const { ideaId } = request.params as { ideaId: string };
    const idea = await readableIdea(request, ctx, ideaId);
    if (!idea?.currentVersion) return sendError(reply, "NOT_FOUND", NOT_FOUND);

    const items = await ctx.db.improvementRecommendation.findMany({
      where: { ideaVersionId: idea.currentVersion.id },
      include: {
        targetCriterion: { select: { key: true } },
        resolvedInVersion: { select: { versionNo: true } },
      },
      // Priority 1 first, and open work above resolved work.
      orderBy: [{ status: "asc" }, { priority: "asc" }, { createdAt: "asc" }],
    });

    return {
      ideaId: idea.id,
      ideaVersionId: idea.currentVersion.id,
      // Legitimately empty for a strong idea (D-13). The UI has a real empty state for
      // it rather than treating "no advice" as a failure to produce advice.
      items: items.map((r) => ({
        id: r.id,
        issue: r.issue,
        whyItMatters: r.whyItMatters,
        recommendation: r.recommendation,
        howToImplement: r.howToImplement,
        expectedEffect: r.expectedEffect,
        projectedRankingEffect: r.projectedRankingEffect,
        targetCriterionKey: r.targetCriterion?.key ?? null,
        priority: r.priority,
        status: r.status,
        resolvedInVersionNo: r.resolvedInVersion?.versionNo ?? null,
      })),
    };
  });
}

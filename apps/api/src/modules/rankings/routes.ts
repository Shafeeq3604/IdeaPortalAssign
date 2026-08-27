import { recomputeRankings } from "@iep/evaluation";
import type { ExplanationItem, IdeaStatus } from "@iep/contracts";
import type { Handler } from "../../server.js";
import { sendError } from "../../server.js";
import { writeAudit } from "../../lib/audit.js";
import { presentCriterionScore } from "../evaluation/present.js";

/**
 * The ranked board, comparison and recompute (P7 — FR-26, ADR-008).
 *
 * Reads always come from a RUN, never from a live re-sort of `evaluations`. A board
 * computed on the fly would change under a reader mid-scroll and make "you moved from
 * 12th to 9th" unprovable. A run is a snapshot with a timestamp and a reason.
 */

/** Top strength and top constraint travel with every row — the board explains inline (P-2). */
function topOf(value: unknown): ExplanationItem | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  return value[0] as ExplanationItem;
}

const RANK_BAND_LIMIT: Record<string, number | null> = {
  top10: 10, top25: 25, top50: 50, all: null,
};

export function registerRankingRoutes(handlers: Map<string, Handler>): void {
  /** Shared by `listRankings` and `getRankingRun`: the same board, a different run. */
  async function presentRun(
    ctx: Parameters<Handler>[2],
    runId: string,
    options: { page: number; perPage: number; rankBand: string; departmentId?: string | undefined },
  ) {
    const run = await ctx.db.rankingRun.findUnique({
      where: { id: runId },
      include: { profile: { select: { key: true, name: true } } },
    });
    if (!run) return null;

    const limit = RANK_BAND_LIMIT[options.rankBand] ?? null;

    const where = {
      runId,
      ...(limit ? { rank: { lte: limit } } : {}),
      ...(options.departmentId ? { idea: { departmentId: options.departmentId } } : {}),
    };

    const [entries, total, cohortSize] = await Promise.all([
      ctx.db.rankingEntry.findMany({
        where,
        include: {
          explanation: true,
          evaluation: { select: { maturityLevel: true, ideaVersionId: true } },
          idea: {
            select: {
              id: true,
              submitter: {
                select: { id: true, displayName: true, department: { select: { name: true } } },
              },
              department: { select: { name: true } },
              currentVersion: {
                select: { title: true, feasibility: { select: { status: true } } },
              },
            },
          },
        },
        orderBy: { rank: "asc" },
        skip: (options.page - 1) * options.perPage,
        take: options.perPage,
      }),
      ctx.db.rankingEntry.count({ where }),
      ctx.db.rankingEntry.count({ where: { runId } }),
    ]);

    return {
      items: entries.map((entry) => ({
        rank: entry.rank,
        previousRank: entry.previousRank,
        ideaId: entry.ideaId,
        title: entry.idea.currentVersion?.title ?? "Untitled",
        compositeScore: Number(entry.compositeScore),
        percentile: Number(entry.percentile),
        maturityLevel: entry.evaluation.maturityLevel,
        feasibilityStatus: entry.idea.currentVersion?.feasibility?.status ?? null,
        department: entry.idea.department?.name ?? null,
        submitter: {
          id: entry.idea.submitter.id,
          displayName: entry.idea.submitter.displayName,
          departmentName: entry.idea.submitter.department?.name ?? null,
        },
        topStrength: topOf(entry.explanation?.strengths),
        topConstraint: topOf(entry.explanation?.constraints),
      })),
      meta: {
        page: options.page,
        perPage: options.perPage,
        total,
        totalPages: Math.max(1, Math.ceil(total / options.perPage)),
      },
      run: {
        runId: run.id,
        profileKey: run.profile.key,
        profileName: run.profile.name,
        engineVersion: run.engineVersion,
        cohortSize,
        computedAt: run.computedAt.toISOString(),
        triggerReason: run.triggerReason,
      },
    };
  }

  handlers.set("listRankings", async (request, reply, ctx) => {
    const q = request.query as {
      page?: string; profile?: string; departmentId?: string; rankBand?: string;
    };
    const page = Math.max(1, Number(q.page ?? 1));

    const profile = q.profile
      ? await ctx.db.evaluationProfile.findUnique({ where: { key: q.profile } })
      : await ctx.db.evaluationProfile.findFirst({ where: { isDefault: true } });

    if (!profile) {
      return sendError(reply, "VALIDATION_FAILED", `No evaluation profile named "${q.profile}"`);
    }

    const latest = await ctx.db.rankingRun.findFirst({
      where: { profileId: profile.id },
      orderBy: { computedAt: "desc" },
      select: { id: true },
    });

    /**
     * No run yet is an empty board, not an error.
     *
     * It happens on a fresh install and after a profile is added, and the client shows an
     * empty state that explains why. A 404 here would look like the page was broken.
     */
    if (!latest) {
      return {
        items: [],
        meta: { page: 1, perPage: 25, total: 0, totalPages: 1 },
        run: {
          runId: "00000000-0000-0000-0000-000000000000",
          profileKey: profile.key,
          profileName: profile.name,
          engineVersion: "—",
          cohortSize: 0,
          computedAt: new Date(0).toISOString(),
          triggerReason: "no ranking run has been computed for this profile yet",
        },
      };
    }

    return presentRun(ctx, latest.id, {
      page,
      perPage: 25,
      rankBand: q.rankBand ?? "all",
      departmentId: q.departmentId,
    });
  });

  handlers.set("getRankingRun", async (request, reply, ctx) => {
    const { runId } = request.params as { runId: string };
    const q = request.query as { page?: string; rankBand?: string };
    const result = await presentRun(ctx, runId, {
      page: Math.max(1, Number(q.page ?? 1)),
      perPage: 25,
      rankBand: q.rankBand ?? "all",
      departmentId: undefined,
    });
    // Old runs stay readable forever (ADR-008), so a miss really is a wrong id.
    return result ?? sendError(reply, "NOT_FOUND", "No ranking run with that id");
  });

  handlers.set("compareIdeas", async (request, reply, ctx) => {
    const q = request.query as { ids?: string[] | string; profile?: string };
    const ids = (Array.isArray(q.ids) ? q.ids : q.ids ? [q.ids] : []).filter(Boolean);

    if (ids.length < 2 || ids.length > 4) {
      // Two is the minimum for a comparison to mean anything; above four the table stops
      // being readable and starts being a spreadsheet (SPEC §7.7).
      return sendError(reply, "VALIDATION_FAILED", "Compare between two and four ideas");
    }

    const profile = q.profile
      ? await ctx.db.evaluationProfile.findUnique({ where: { key: q.profile } })
      : await ctx.db.evaluationProfile.findFirst({ where: { isDefault: true } });
    if (!profile) return sendError(reply, "VALIDATION_FAILED", "No such evaluation profile");

    const run = await ctx.db.rankingRun.findFirst({
      where: { profileId: profile.id },
      orderBy: { computedAt: "desc" },
      include: { entries: { select: { ideaId: true, rank: true } } },
    });

    const ideas = await ctx.db.idea.findMany({
      where: { id: { in: ids } },
      include: {
        currentVersion: {
          select: {
            title: true,
            evaluations: {
              where: { profileId: profile.id },
              orderBy: { computedAt: "desc" },
              take: 1,
              include: {
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
            },
          },
        },
      },
    });

    if (ideas.length !== ids.length) {
      return sendError(reply, "NOT_FOUND", "One of those ideas does not exist or is not visible");
    }

    const rankByIdea = new Map((run?.entries ?? []).map((e) => [e.ideaId, e.rank]));

    const shaped = ideas.map((idea) => {
      const evaluation = idea.currentVersion?.evaluations[0];
      return {
        ideaId: idea.id,
        title: idea.currentVersion?.title ?? "Untitled",
        rank: rankByIdea.get(idea.id) ?? null,
        compositeScore: evaluation ? Number(evaluation.compositeScore) : 0,
        maturityLevel: evaluation?.maturityLevel ?? 1,
        criterionScores: (evaluation?.criterionScores ?? []).map(presentCriterionScore),
      };
    });

    /**
     * Where they actually DIFFER, sorted by how much.
     *
     * A comparison that lists every criterion for every idea is a table, not a
     * comparison — the reader is left to do the diffing (SPEC §9.9). Spread is the
     * answer to "what is this decision really about".
     */
    const keys = new Set(shaped.flatMap((i) => i.criterionScores.map((s) => s.criterionKey)));
    const divergentCriteria = [...keys]
      .map((key) => {
        const byIdea = shaped
          .map((idea) => {
            const score = idea.criterionScores.find((s) => s.criterionKey === key);
            return score ? { ideaId: idea.ideaId, normalized: score.normalized } : null;
          })
          .filter((x): x is { ideaId: string; normalized: number } => x !== null);
        const values = byIdea.map((b) => b.normalized);
        const label =
          shaped
            .flatMap((i) => i.criterionScores)
            .find((s) => s.criterionKey === key)?.criterionLabel ?? key;
        return {
          criterionKey: key,
          criterionLabel: label,
          spread: values.length > 0 ? Number((Math.max(...values) - Math.min(...values)).toFixed(3)) : 0,
          byIdea,
        };
      })
      .filter((d) => d.spread > 0)
      .sort((a, b) => b.spread - a.spread);

    return {
      run: {
        runId: run?.id ?? "00000000-0000-0000-0000-000000000000",
        profileKey: profile.key,
        profileName: profile.name,
        engineVersion: run?.engineVersion ?? "—",
        cohortSize: run?.entries.length ?? 0,
        computedAt: (run?.computedAt ?? new Date(0)).toISOString(),
        triggerReason: run?.triggerReason ?? "no ranking run yet",
      },
      ideas: shaped,
      divergentCriteria,
    };
  });

  handlers.set("recomputeRankings", async (request, reply, ctx) => {
    const body = request.body as { profileKey?: string; reason?: string };
    const reason = body?.reason?.trim() ?? "";
    if (!body?.profileKey || reason.length === 0) {
      // FR-13: a recompute is a config-level act, so the run records why it happened.
      return sendError(reply, "VALIDATION_FAILED", "A profile and a reason are required");
    }

    const actor = request.actor!;

    /**
     * Run synchronously and answer with the run that was actually produced.
     *
     * The contract says 202, and 202 is right — the caller is asking for work, not
     * reading. But ranking makes no provider call and is arithmetic over rows already in
     * the database, so making the caller poll to discover a `runId` we could have handed
     * them buys nothing. The status code keeps its meaning; the body is honest.
     */
    let result;
    try {
      result = await recomputeRankings(ctx.db, {
        profileKey: body.profileKey,
        triggeredById: actor.userId,
        triggerReason: reason,
      });
    } catch (error) {
      return sendError(
        reply, "VALIDATION_FAILED",
        error instanceof Error ? error.message : "Could not recompute",
      );
    }

    if (!result) {
      return sendError(
        reply, "VALIDATION_FAILED",
        "Nothing to rank — no idea has been evaluated under this profile yet",
      );
    }

    const run = await ctx.db.rankingRun.findUniqueOrThrow({
      where: { id: result.runId },
      include: { profile: { select: { key: true, name: true } } },
    });

    await ctx.db.$transaction((tx) =>
      writeAudit(tx, {
        actorId: actor.userId,
        action: "ranking.recompute",
        entityType: "ranking_run",
        entityId: run.id,
        after: { profileKey: run.profile.key, cohortSize: result.cohortSize },
        reason,
        requestId: request.id,
      }),
    );

    return reply.status(202).send({
      runId: run.id,
      profileKey: run.profile.key,
      profileName: run.profile.name,
      engineVersion: run.engineVersion,
      cohortSize: result.cohortSize,
      computedAt: run.computedAt.toISOString(),
      triggerReason: run.triggerReason,
    });
  });

  handlers.set("getDashboard", async (request, _reply, ctx) => {
    const q = request.query as { departmentId?: string };
    const scope = q.departmentId ? { departmentId: q.departmentId } : {};
    const dept = q.departmentId ? `&departmentId=${q.departmentId}` : "";

    const count = (status: IdeaStatus | IdeaStatus[]) =>
      ctx.db.idea.count({
        where: { ...scope, status: Array.isArray(status) ? { in: status } : status },
      });

    /**
     * The nine counts (FR-26).
     *
     * REQUIREMENTS.md is not in this repository, so §29's exact list could not be checked
     * against the source. These nine are the lifecycle stages the M1 data model actually
     * supports, each one linkable to a real filtered list — which is the part §6.2 row 40
     * makes non-negotiable. If §29 names different counts, this is the file to correct.
     */
    const [
      submitted, analysing, awaitingReview, ranked, needsClarification,
      underReview, prototypes, pilots, implemented, contributors,
    ] = await Promise.all([
      ctx.db.idea.count({ where: { ...scope, NOT: { status: "DRAFT" } } }),
      count("AI_ANALYSIS"),
      count(["EVALUATED", "RANKED"]),
      ctx.db.rankingEntry.count({
        where: { run: { id: (await ctx.db.rankingRun.findFirst({ orderBy: { computedAt: "desc" }, select: { id: true } }))?.id ?? "" } },
      }),
      count("NEEDS_CLARIFICATION"),
      count("UNDER_REVIEW"),
      count("PROTOTYPE_CANDIDATE"),
      count("PILOT"),
      count("IMPLEMENTED"),
      ctx.db.user.count({ where: { ideas: { some: { NOT: { status: "DRAFT" } } } } }),
    ]);

    // Every tile is a link (§6.2 row 40). The href is part of the contract, not a client
    // convention, so a tile physically cannot ship without a destination.
    const tiles = [
      { key: "submitted", label: "Ideas submitted", count: submitted, href: `/ideas?sort=recent${dept}` },
      { key: "analysing", label: "Being analysed", count: analysing, href: `/ideas?status=AI_ANALYSIS${dept}` },
      { key: "awaiting_review", label: "Awaiting review", count: awaitingReview, href: "/review" },
      { key: "ranked", label: "On the current board", count: ranked, href: "/rankings" },
      { key: "needs_clarification", label: "Needs clarification", count: needsClarification, href: `/ideas?status=NEEDS_CLARIFICATION${dept}` },
      { key: "under_review", label: "Under review", count: underReview, href: `/ideas?status=UNDER_REVIEW${dept}` },
      { key: "prototype", label: "Prototype candidates", count: prototypes, href: `/ideas?status=PROTOTYPE_CANDIDATE${dept}` },
      { key: "pilot", label: "In pilot", count: pilots, href: `/ideas?status=PILOT${dept}` },
      { key: "implemented", label: "Implemented", count: implemented, href: `/ideas?status=IMPLEMENTED${dept}` },
      { key: "contributors", label: "People who have contributed", count: contributors, href: "/admin/users" },
    ];

    return { tiles, generatedAt: new Date().toISOString() };
  });
}

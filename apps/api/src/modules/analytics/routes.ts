import { AnalyticsQuery, IdeaStatus, ReviewDecision, ideaListScope } from "@iep/contracts";
import type { AnalyticsCycleTime, AnalyticsResponse } from "@iep/contracts";
import type { Prisma } from "@iep/db";
import type { Handler } from "../../server.js";
import { requireActor, sendError } from "../../server.js";
import { scopeToWhere } from "../idea/repo.js";
import { bucketByMonth, earliestBy, mean, median, pairedDurations, startOfMonthUtc } from "./aggregate.js";

/**
 * P14 — organisational analytics (FR-27). Read-only; writes nothing, enqueues nothing.
 *
 * Every figure is an aggregate of rows earlier phases already store: ideas and
 * status_history (P2), evaluations/criterion_scores/ranking_runs (P4), reviews,
 * score_overrides and leadership_decisions (P6), idea_versions (P8). No new table, no
 * cached rollup — at this product's scale a direct read is honest and fast enough, and a
 * rollup table is one more thing that can silently disagree with the source.
 *
 * Scope: `dashboard:read` (MANAGEMENT/ADMIN) to open the page, and then the SAME idea
 * visibility `/ideas` applies (`ideaListScope`, SPEC §4.2) to every figure on it. A
 * manager may read ideas only from EVALUATED onward, so an unscoped count would both
 * disclose ideas they cannot open (permission matrix, P-1) and break the page's own
 * promise that every count opens a list of the same size — found by the F-12 flow, which
 * compares each count with its list. Department/category filters then narrow every
 * section consistently, because every query below starts from the same `ideaWhere`.
 */

/** The four human-approved delivery stages — the same set the dashboard's outcome tiles count. */
const DELIVERY_STAGES = ["PROTOTYPE_CANDIDATE", "PILOT", "PRODUCTION_CANDIDATE", "IMPLEMENTED"] as const;

export function registerAnalyticsRoutes(handlers: Map<string, Handler>): void {
  handlers.set("getAnalytics", async (request, reply, ctx) => {
    const parsed = AnalyticsQuery.safeParse(request.query);
    if (!parsed.success) return sendError(reply, "VALIDATION_FAILED", "Invalid filters");
    const { departmentId, categoryId } = parsed.data;

    const ideaWhere: Prisma.IdeaWhereInput = {
      AND: [
        scopeToWhere(ideaListScope(requireActor(request))),
        { NOT: { status: "DRAFT" } },
        ...(departmentId ? [{ departmentId }] : []),
        ...(categoryId ? [{ categoryId }] : []),
      ],
    };

    /** A `/ideas` link carrying the page's own filters plus `extra` — so the list agrees. */
    const listHref = (extra: { status?: string; department?: string; category?: string }) => {
      const p = new URLSearchParams();
      if (extra.status) p.set("status", extra.status);
      const dept = extra.department ?? departmentId;
      const cat = extra.category ?? categoryId;
      if (dept) p.set("department", dept);
      if (cat) p.set("category", cat);
      const s = p.toString();
      return s ? `/ideas?${s}` : "/ideas";
    };

    const now = new Date();

    const [
      totalIdeas, byStatus, submitted, byDept, byDeptSubmitter, reviewedByDept, advancedByDept,
      byCat, reviews, reviewsByDecision, scoreOverrides, leadershipDecisions,
    ] = await Promise.all([
      ctx.db.idea.count({ where: ideaWhere }),
      ctx.db.idea.groupBy({ by: ["status"], where: ideaWhere, _count: { _all: true } }),
      ctx.db.idea.findMany({
        where: { ...ideaWhere, submittedAt: { gte: startOfMonthUtc(now, 11) } },
        select: { submittedAt: true },
      }),
      ctx.db.idea.groupBy({ by: ["departmentId"], where: ideaWhere, _count: { _all: true } }),
      ctx.db.idea.groupBy({ by: ["departmentId", "submitterId"], where: ideaWhere }),
      ctx.db.idea.groupBy({
        by: ["departmentId"], where: { ...ideaWhere, reviews: { some: {} } }, _count: { _all: true },
      }),
      ctx.db.idea.groupBy({
        by: ["departmentId"], where: { ...ideaWhere, status: { in: [...DELIVERY_STAGES] } }, _count: { _all: true },
      }),
      ctx.db.idea.groupBy({ by: ["categoryId"], where: ideaWhere, _count: { _all: true } }),
      ctx.db.review.count({ where: { idea: ideaWhere } }),
      ctx.db.review.groupBy({ by: ["decision"], where: { idea: ideaWhere }, _count: { _all: true } }),
      ctx.db.scoreOverride.count({
        where: { criterionScore: { evaluation: { ideaVersion: { idea: ideaWhere } } } },
      }),
      ctx.db.leadershipDecision.count({ where: { idea: ideaWhere } }),
    ]);

    /* ── Ideas by status (REQUIREMENTS §18), in lifecycle order, non-zero only ── */
    const statusCounts = new Map(byStatus.map((r) => [r.status, r._count._all]));
    const statusBreakdown = IdeaStatus.options
      .filter((s) => s !== "DRAFT" && (statusCounts.get(s) ?? 0) > 0)
      .map((status) => ({ status, count: statusCounts.get(status) ?? 0, href: listHref({ status }) }));

    /* ── Participation by department ── */
    const deptIds = byDept.map((r) => r.departmentId).filter((id): id is string => id !== null);
    const catIds = byCat.map((r) => r.categoryId).filter((id): id is string => id !== null);
    const [departments, categories] = await Promise.all([
      ctx.db.department.findMany({ where: { id: { in: deptIds } }, select: { id: true, name: true } }),
      ctx.db.ideaCategory.findMany({ where: { id: { in: catIds } }, select: { id: true, label: true } }),
    ]);
    const deptName = new Map(departments.map((d) => [d.id, d.name]));
    const catLabel = new Map(categories.map((c) => [c.id, c.label]));
    const countOf = (rows: { departmentId: string | null; _count: { _all: number } }[], id: string | null) =>
      rows.find((r) => r.departmentId === id)?._count._all ?? 0;

    const byDepartment = byDept
      .map((r) => ({
        departmentId: r.departmentId,
        name: r.departmentId ? (deptName.get(r.departmentId) ?? "Unknown department") : "No department",
        ideas: r._count._all,
        contributors: byDeptSubmitter.filter((s) => s.departmentId === r.departmentId).length,
        reviewed: countOf(reviewedByDept, r.departmentId),
        advanced: countOf(advancedByDept, r.departmentId),
        href: r.departmentId ? listHref({ department: r.departmentId }) : null,
      }))
      .sort((a, b) => b.ideas - a.ideas || a.name.localeCompare(b.name));

    const byCategory = byCat
      .map((r) => ({
        categoryId: r.categoryId,
        label: r.categoryId ? (catLabel.get(r.categoryId) ?? "Unknown category") : "Uncategorised",
        ideas: r._count._all,
        href: r.categoryId ? listHref({ category: r.categoryId }) : null,
      }))
      .sort((a, b) => b.ideas - a.ideas || a.label.localeCompare(b.label));

    /* ── Cycle times (P2 → P4 → P6) ── */
    const [ideasSubmitted, evalTimes, reviewTimes, deliveryTimes] = await Promise.all([
      ctx.db.idea.findMany({ where: { ...ideaWhere, submittedAt: { not: null } }, select: { id: true, submittedAt: true } }),
      ctx.db.evaluation.findMany({
        where: { ideaVersion: { idea: ideaWhere } },
        select: { computedAt: true, ideaVersion: { select: { ideaId: true } } },
      }),
      ctx.db.review.findMany({ where: { idea: ideaWhere }, select: { ideaId: true, createdAt: true } }),
      ctx.db.statusHistory.findMany({
        where: { idea: ideaWhere, toStatus: { in: [...DELIVERY_STAGES] } },
        select: { ideaId: true, at: true },
      }),
    ]);
    const submittedAt = new Map<string, Date>();
    for (const i of ideasSubmitted) if (i.submittedAt) submittedAt.set(i.id, i.submittedAt);
    const firstScore = earliestBy(evalTimes, (e) => e.ideaVersion.ideaId, (e) => e.computedAt);
    const firstReview = earliestBy(reviewTimes, (r) => r.ideaId, (r) => r.createdAt);
    const firstDelivery = earliestBy(deliveryTimes, (s) => s.ideaId, (s) => s.at);

    const cycle = (key: AnalyticsCycleTime["key"], label: string, d: number[]): AnalyticsCycleTime => ({
      key, label, medianDays: median(d), sampleSize: d.length,
    });
    const cycleTimes = [
      cycle("SUBMITTED_TO_FIRST_SCORE", "Submitted → first scored", pairedDurations(submittedAt, firstScore)),
      cycle("FIRST_SCORE_TO_FIRST_REVIEW", "First scored → first human review", pairedDurations(firstScore, firstReview)),
      cycle("SUBMITTED_TO_DELIVERY_STAGE", "Submitted → delivery stage", pairedDurations(submittedAt, firstDelivery)),
    ];

    /* ── Review activity (P6) ── */
    const decisionCounts = new Map(reviewsByDecision.map((r) => [r.decision, r._count._all]));
    const reviewActivity = {
      reviews,
      byDecision: ReviewDecision.options
        .map((decision) => ({ decision, count: decisionCounts.get(decision) ?? 0 }))
        .filter((r) => r.count > 0),
      scoreOverrides,
      leadershipDecisions,
    };

    /* ── Re-evaluation outcomes (P8), default profile ── */
    const defaultProfile = await ctx.db.evaluationProfile.findFirst({
      where: { isDefault: true }, select: { id: true, name: true },
    });
    let revisions: AnalyticsResponse["revisions"] = {
      profileName: defaultProfile?.name ?? null,
      revisedIdeas: 0, improved: 0, declined: 0, unchanged: 0, medianCompositeDelta: null,
    };
    if (defaultProfile) {
      const evals = await ctx.db.evaluation.findMany({
        where: { profileId: defaultProfile.id, ideaVersion: { idea: ideaWhere } },
        select: {
          compositeScore: true, computedAt: true,
          ideaVersion: { select: { ideaId: true, versionNo: true } },
        },
      });
      // Latest evaluation per (idea, version) — a version may be re-scored by a newer engine.
      const perVersion = new Map<string, { ideaId: string; versionNo: number; score: number; at: Date }>();
      for (const e of evals) {
        const k = `${e.ideaVersion.ideaId}:${e.ideaVersion.versionNo}`;
        const prev = perVersion.get(k);
        if (!prev || e.computedAt > prev.at) {
          perVersion.set(k, {
            ideaId: e.ideaVersion.ideaId, versionNo: e.ideaVersion.versionNo,
            score: Number(e.compositeScore), at: e.computedAt,
          });
        }
      }
      const byIdea = new Map<string, { versionNo: number; score: number }[]>();
      for (const v of perVersion.values()) {
        const list = byIdea.get(v.ideaId) ?? [];
        list.push({ versionNo: v.versionNo, score: v.score });
        byIdea.set(v.ideaId, list);
      }
      const deltas: number[] = [];
      for (const versions of byIdea.values()) {
        if (versions.length < 2) continue;
        versions.sort((a, b) => a.versionNo - b.versionNo);
        const first = versions[0];
        const latest = versions[versions.length - 1];
        if (!first || !latest) continue;
        deltas.push(Math.round((latest.score - first.score) * 1000) / 1000);
      }
      const md = median(deltas);
      revisions = {
        profileName: defaultProfile.name,
        revisedIdeas: deltas.length,
        improved: deltas.filter((d) => d > 0).length,
        declined: deltas.filter((d) => d < 0).length,
        unchanged: deltas.filter((d) => d === 0).length,
        medianCompositeDelta: md === null ? null : Math.round(md * 10) / 10,
      };
    }

    /* ── Impact vs effort (REQUIREMENTS §19), latest ranking run (P4) ── */
    const latestRun = await ctx.db.rankingRun.findFirst({
      orderBy: { computedAt: "desc" },
      select: { id: true, computedAt: true, profile: { select: { name: true } } },
    });
    let impactVsEffort: AnalyticsResponse["impactVsEffort"] = {
      runId: null, profileName: null, computedAt: null, points: [],
    };
    if (latestRun) {
      const entries = await ctx.db.rankingEntry.findMany({
        where: { runId: latestRun.id, idea: ideaWhere },
        orderBy: { rank: "asc" },
        take: 200,
        select: {
          ideaId: true, rank: true,
          idea: { select: { currentVersion: { select: { title: true } } } },
          evaluation: {
            select: {
              criterionScores: {
                where: { criterion: { group: { in: ["VALUE", "EFFORT"] } } },
                select: { normalized: true, criterion: { select: { group: true } } },
              },
            },
          },
        },
      });
      const points = [];
      for (const e of entries) {
        const scores = e.evaluation.criterionScores;
        const impact = mean(scores.filter((s) => s.criterion.group === "VALUE").map((s) => Number(s.normalized)));
        const ease = mean(scores.filter((s) => s.criterion.group === "EFFORT").map((s) => Number(s.normalized)));
        // An idea missing either group is left off the chart rather than plotted at 0.
        if (impact === null || ease === null) continue;
        points.push({
          ideaId: e.ideaId,
          title: e.idea.currentVersion?.title ?? "Untitled idea",
          rank: e.rank,
          impact,
          ease,
          href: `/ideas/${e.ideaId}`,
        });
      }
      impactVsEffort = {
        runId: latestRun.id,
        profileName: latestRun.profile.name,
        computedAt: latestRun.computedAt.toISOString(),
        points,
      };
    }

    const body: AnalyticsResponse = {
      generatedAt: now.toISOString(),
      totalIdeas,
      statusBreakdown,
      submissionsByMonth: bucketByMonth(
        submitted.map((s) => s.submittedAt).filter((d): d is Date => d !== null),
        now,
      ),
      byDepartment,
      byCategory,
      cycleTimes,
      reviewActivity,
      revisions,
      impactVsEffort,
    };
    return body;
  });
}

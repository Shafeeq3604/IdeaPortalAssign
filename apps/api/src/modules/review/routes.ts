import { CreateReviewRequest, OverrideScoreRequest, can } from "@iep/contracts";
import type { IdeaStatus } from "@iep/contracts";
import type { Handler } from "../../server.js";
import { sendError } from "../../server.js";
import { writeAudit } from "../../lib/audit.js";

/**
 * Human review, overrides and their audit trail (P6 — FR-22, FR-23, FR-29, SPEC §9.8).
 *
 * Every write here is a DECISION, so each one: requires a reason where the requirement
 * says so, records who made it, and lands in `audit_log` in the same transaction as the
 * change itself. P-3 — humans decide, the AI never does — is enforced at this boundary.
 */

const NOT_FOUND = "No idea with that id";

/** Statuses that put an idea in front of a reviewer. */
const AWAITING_REVIEW: readonly IdeaStatus[] = [
  "EVALUATED", "RANKED", "UNDER_REVIEW", "NEEDS_CLARIFICATION",
];

const daysSince = (date: Date | null): number =>
  date === null ? 0 : Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000));


/**
 * One shape for a queue row, whichever ordering produced it.
 *
 * The rank-sorted path fetches by id list and the default path fetches by `orderBy`;
 * without a shared include and mapper the two would drift and only one would be tested.
 */
const QUEUE_INCLUDE = {
  currentVersion: {
    select: {
      title: true,
      // "Has AI nobody has checked" is the whole point of a review queue, so it is
      // computed here rather than left for the client to infer from absence.
      analyses: { select: { id: true } },
      evaluations: {
        orderBy: { computedAt: "desc" }, take: 1,
        select: { compositeScore: true },
      },
    },
  },
  submitter: { select: { id: true, displayName: true, department: { select: { name: true } } } },
  department: { select: { id: true, name: true } },
  rankingEntries: {
    orderBy: { run: { computedAt: "desc" } }, take: 1,
    select: { rank: true },
  },
  reviews: { select: { id: true }, take: 1 },
} as const;

type QueueRow = {
  id: string;
  status: string;
  submittedAt: Date | null;
  currentVersion: {
    title: string;
    analyses: { id: string }[];
    evaluations: { compositeScore: unknown }[];
  } | null;
  submitter: { id: string; displayName: string; department: { name: string } | null };
  department: { id: string; name: string } | null;
  rankingEntries: { rank: number }[];
  reviews: { id: string }[];
};

function toQueueItem(idea: QueueRow) {
  return {
    ideaId: idea.id,
    title: idea.currentVersion?.title ?? "Untitled",
    status: idea.status,
    submitter: {
      id: idea.submitter.id,
      displayName: idea.submitter.displayName,
      departmentName: idea.submitter.department?.name ?? null,
    },
    department: idea.department ? { id: idea.department.id, name: idea.department.name } : null,
    rank: idea.rankingEntries[0]?.rank ?? null,
    compositeScore: idea.currentVersion?.evaluations[0]
      ? Number(idea.currentVersion.evaluations[0].compositeScore)
      : null,
    submittedAt: idea.submittedAt?.toISOString() ?? null,
    waitingDays: daysSince(idea.submittedAt),
    hasUnvalidatedAi:
      (idea.currentVersion?.analyses.length ?? 0) > 0 && idea.reviews.length === 0,
  };
}

export function registerReviewRoutes(handlers: Map<string, Handler>): void {
  handlers.set("getReviewQueue", async (request, _reply, ctx) => {
    const query = request.query as {
      page?: string; status?: string[] | string; departmentId?: string; sort?: string;
    };
    const page = Math.max(1, Number(query.page ?? 1));
    const perPage = 20;
    const statuses = query.status
      ? (Array.isArray(query.status) ? query.status : [query.status]) as IdeaStatus[]
      : [...AWAITING_REVIEW];

    const where = {
      status: { in: statuses },
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
    };

    /**
     * "By rank" now actually sorts by rank.
     *
     * It used to fall through to `createdAt asc` — a control that offered an ordering and
     * quietly gave you a different one, which is worse than not offering it. Rank lives
     * on a ranking ENTRY, not on the idea, so it cannot be an `orderBy`: the order is
     * built here from the latest run, with unranked ideas after the ranked ones rather
     * than dropped.
     */
    if (query.sort === "rank") {
      const latestRun = await ctx.db.rankingRun.findFirst({
        orderBy: { computedAt: "desc" }, select: { id: true },
      });
      const ranked = latestRun
        ? await ctx.db.rankingEntry.findMany({
            where: { runId: latestRun.id, idea: where },
            orderBy: { rank: "asc" },
            select: { ideaId: true },
          })
        : [];
      const rankedIds = ranked.map((e) => e.ideaId);

      const unranked = await ctx.db.idea.findMany({
        where: { ...where, id: { notIn: rankedIds } },
        orderBy: { submittedAt: "asc" },
        select: { id: true },
      });

      const ordered = [...rankedIds, ...unranked.map((i) => i.id)];
      const pageIds = ordered.slice((page - 1) * perPage, page * perPage);
      const fetched = await ctx.db.idea.findMany({
        where: { id: { in: pageIds } },
        include: QUEUE_INCLUDE,
      });
      // `findMany` does not preserve the order of an `in` list, so it is reimposed here.
      const byId = new Map(fetched.map((i) => [i.id, i]));
      const items = pageIds
        .map((id) => byId.get(id))
        .filter((i): i is NonNullable<typeof i> => i !== undefined)
        .map(toQueueItem);

      return {
        items,
        meta: {
          page, perPage, total: ordered.length,
          totalPages: Math.max(1, Math.ceil(ordered.length / perPage)),
        },
      };
    }

    const [rows, total] = await Promise.all([
      ctx.db.idea.findMany({
        where,
        include: QUEUE_INCLUDE,
        // Oldest first by default: a queue sorted by score quietly buries the ideas that
        // have been waiting longest, which is the failure a queue exists to prevent.
        orderBy:
          query.sort === "recent" ? { submittedAt: "desc" } : { submittedAt: "asc" },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      ctx.db.idea.count({ where }),
    ]);

    return {
      items: rows.map(toQueueItem),
      // Under `meta`, matching the `paginated()` helper every other list uses. Returning
      // these flat rendered a 200 the client could not read: `data.meta.total` threw and
      // the whole queue page fell into the error boundary.
      meta: {
        page,
        perPage,
        total,
        totalPages: Math.max(1, Math.ceil(total / perPage)),
      },
    };
  });

  handlers.set("listReviews", async (request, reply, ctx) => {
    const { ideaId } = request.params as { ideaId: string };
    const idea = await ctx.db.idea.findUnique({ where: { id: ideaId } });
    if (!idea) return sendError(reply, "NOT_FOUND", NOT_FOUND);
    if (!can(request.actor!, "idea:read", {
      ideaId: idea.id, submitterId: idea.submitterId, status: idea.status as IdeaStatus,
    }).allowed) return sendError(reply, "NOT_FOUND", NOT_FOUND);

    const items = await ctx.db.review.findMany({
      where: { ideaId },
      include: {
        reviewer: { select: { id: true, displayName: true, department: { select: { name: true } } } },
      },
      orderBy: { createdAt: "desc" },
    });

    return {
      items: items.map((r) => ({
        id: r.id,
        reviewer: {
          id: r.reviewer.id,
          displayName: r.reviewer.displayName,
          departmentName: r.reviewer.department?.name ?? null,
        },
        decision: r.decision,
        comment: r.comment,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  });

  handlers.set("createReview", async (request, reply, ctx) => {
    const parsed = CreateReviewRequest.safeParse(request.body);
    if (!parsed.success) {
      // The refinement carries FR-23's wording; surfacing it beats a generic 400.
      const first = parsed.error.issues[0];
      return sendError(reply, "VALIDATION_FAILED", first?.message ?? "Invalid review");
    }

    const { ideaId } = request.params as { ideaId: string };
    const actor = request.actor!;
    const idea = await ctx.db.idea.findUnique({ where: { id: ideaId } });
    if (!idea) return sendError(reply, "NOT_FOUND", NOT_FOUND);

    const resource = {
      ideaId: idea.id, submitterId: idea.submitterId, status: idea.status as IdeaStatus,
    };
    const verdict = can(actor, "review:create", resource);
    if (!verdict.allowed) {
      // A reviewer reviewing their own idea is a governance failure, not a permission
      // one, so it gets its own code rather than a flat 403 (P-3).
      return verdict.reason === "CANNOT_REVIEW_OWN_IDEA"
        ? sendError(reply, "CANNOT_REVIEW_OWN_IDEA",
            "You cannot review an idea you submitted. Another reviewer has to look at it.")
        : sendError(reply, "ROLE_NOT_PERMITTED", "Your role cannot review ideas");
    }

    const created = await ctx.db.$transaction(async (tx) => {
      const review = await tx.review.create({
        data: {
          ideaId,
          reviewerId: actor.userId,
          decision: parsed.data.decision,
          comment: parsed.data.comment?.trim() || null,
        },
        include: {
          reviewer: { select: { id: true, displayName: true, department: { select: { name: true } } } },
        },
      });

      await writeAudit(tx, {
        actorId: actor.userId,
        action: "idea.review",
        entityType: "idea",
        entityId: ideaId,
        before: { status: idea.status },
        after: { decision: review.decision },
        reason: review.comment,
        requestId: request.id,
      });

      return review;
    });

    /**
     * The review is recorded; moving the idea is a SEPARATE, explicit act.
     *
     * Auto-transitioning on a decision would make the lifecycle a side effect of a
     * comment, and the transition table exists precisely so every move is deliberate and
     * separately authorised (SPEC §5.4).
     */
    return reply.status(201).send({
      id: created.id,
      reviewer: {
        id: created.reviewer.id,
        displayName: created.reviewer.displayName,
        departmentName: created.reviewer.department?.name ?? null,
      },
      decision: created.decision,
      comment: created.comment,
      createdAt: created.createdAt.toISOString(),
    });
  });

  handlers.set("overrideCriterionScore", async (request, reply, ctx) => {
    const parsed = OverrideScoreRequest.safeParse(request.body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      // FR-22: the reason is the requirement, not a nicety.
      return first?.path[0] === "reason"
        ? sendError(reply, "REASON_REQUIRED", "An override needs a reason. It is shown to the submitter.")
        : sendError(reply, "VALIDATION_FAILED", first?.message ?? "Invalid override");
    }

    const { ideaId } = request.params as { ideaId: string };
    const actor = request.actor!;
    const idea = await ctx.db.idea.findUnique({
      where: { id: ideaId },
      include: { currentVersion: { select: { id: true } } },
    });
    if (!idea?.currentVersion) return sendError(reply, "NOT_FOUND", NOT_FOUND);

    const verdict = can(actor, "score:override", {
      ideaId: idea.id, submitterId: idea.submitterId, status: idea.status as IdeaStatus,
    });
    if (!verdict.allowed) {
      return verdict.reason === "CANNOT_REVIEW_OWN_IDEA"
        ? sendError(reply, "CANNOT_REVIEW_OWN_IDEA", "You cannot adjust the score of your own idea.")
        : sendError(reply, "ROLE_NOT_PERMITTED", "Your role cannot adjust scores");
    }

    const score = await ctx.db.criterionScore.findFirst({
      where: {
        evaluation: { ideaVersionId: idea.currentVersion.id },
        criterion: { key: parsed.data.criterionKey },
      },
      include: { evaluation: { select: { id: true } }, criterion: { select: { key: true } } },
    });
    if (!score) {
      return sendError(reply, "NOT_FOUND", `No score for criterion "${parsed.data.criterionKey}"`);
    }

    const previous = Number(score.normalized);

    await ctx.db.$transaction(async (tx) => {
      await tx.scoreOverride.create({
        data: {
          criterionScoreId: score.id,
          reviewerId: actor.userId,
          previousNormalized: previous,
          newNormalized: parsed.data.newNormalized,
          reason: parsed.data.reason,
        },
      });

      await tx.criterionScore.update({
        where: { id: score.id },
        data: {
          normalized: parsed.data.newNormalized,
          contribution: Number((parsed.data.newNormalized * Number(score.weight)).toFixed(3)),
          // The provenance shifts with the value. A number a human set must never keep
          // reading as AI-derived (SPEC §7.4).
          source: "HUMAN",
          confidence: "HIGH",
          rationale: parsed.data.reason,
        },
      });

      // Recomputed from what is stored, so the composite and its parts cannot disagree.
      const stored = await tx.criterionScore.findMany({
        where: { evaluationId: score.evaluationId },
        select: { contribution: true },
      });
      const composite = Math.min(
        100,
        Math.max(0, Number(stored.reduce((acc, s) => acc + Number(s.contribution), 0).toFixed(3))),
      );
      await tx.evaluation.update({
        where: { id: score.evaluationId },
        data: { compositeScore: composite },
      });

      await writeAudit(tx, {
        actorId: actor.userId,
        action: "score.override",
        entityType: "evaluation",
        entityId: idea.id,
        before: { criterionKey: score.criterion.key, normalized: previous },
        after: { criterionKey: score.criterion.key, normalized: parsed.data.newNormalized, composite },
        reason: parsed.data.reason,
        requestId: request.id,
      });
    });

    /**
     * The RANK is now stale, and recomputing it is cohort-wide work that belongs on the
     * queue (ADR-008). Asking for it here rather than making the reviewer press a second
     * button is the difference between an override that lands and one that half-lands.
     */
    await ctx.ranking.enqueue({
      triggeredById: actor.userId,
      triggerReason: `score override on idea ${idea.id}`,
    });

    // Re-read through the same handler so the response is byte-identical to a GET.
    return handlers.get("getIdeaEvaluation")!(request, reply, ctx);
  });
}

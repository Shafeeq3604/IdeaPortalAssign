import type { PrismaClient } from "@iep/db";
import {
  CreateIdeaRequest, CreateVersionRequest, ListIdeasQuery, TransitionRequest,
  UpdateDraftRequest, canTransition, can, ideaListScope,
  type IdeaStatus, type Role,
} from "@iep/contracts";
import { RANKABLE_STATUSES } from "@iep/evaluation";
import type { Handler } from "../../server.js";
import type { AppContext } from "../../context.js";
import { requireActor, sendError } from "../../server.js";
import {
  makeIdeaRepo, IDEA_DETAIL_INCLUDE, TransitionConflict, DraftEditConflict,
  type IdeaListFilterParams,
} from "./repo.js";
import { toIdeaDetail, toIdeaSummary, toVersionDetail, toVersionSummary, toStatusEntry } from "./present.js";
import { commentCountsFor, socialFor } from "../social/queries.js";

/**
 * Start analysis. Deliberately fire-and-forget: a queue outage must not fail a
 * submission that is already safely stored (P3).
 */
async function startAnalysis(
  ctx: AppContext,
  ideaId: string,
  ideaVersionId: string,
): Promise<void> {
  const version = await ctx.db.ideaVersion.findUnique({
    where: { id: ideaVersionId },
    select: { contentHash: true },
  });
  if (!version) return;
  // The return value is deliberately ignored: false means the queue was unavailable,
  // which is a degraded run, not a failed submission.
  await ctx.analysis.enqueue({ ideaId, ideaVersionId, contentHash: version.contentHash });
}

/**
 * Idea capture and lifecycle (P2 — FR-02, FR-16, FR-23, FR-24).
 *
 * Every handler follows the same shape, and the ORDER matters:
 *   1. parse with the contract schema (never trust the body)
 *   2. load the resource
 *   3. `can()` — resource policy, AFTER loading, so ownership and status can be checked
 *   4. act
 *
 * Route-level permissions were already checked by the registration guard; this is the
 * second layer (SPEC §4.2), and it is what stops one employee editing another's draft.
 */

/**
 * Score and rank for one page of ideas, in two queries rather than two per row.
 *
 * Both are read against the idea's CURRENT version. An older version keeps its own score
 * on the History tab (FR-24); a list showing "this idea" means the version it is now.
 *
 * Rank comes from the most recent run that included the idea, because rank is a property
 * of a run and not of an idea (ADR-008). An idea evaluated but not yet in any run has a
 * score and no rank, which is a real state and renders as one.
 */
async function scoresForCurrentVersions(
  ctx: { db: PrismaClient },
  rows: readonly { id: string; currentVersionId?: string | null }[],
): Promise<Map<string, { compositeScore: number | null; rank: number | null }>> {
  const out = new Map<string, { compositeScore: number | null; rank: number | null }>();
  const versionIds = rows.map((r) => r.currentVersionId).filter((v): v is string => Boolean(v));
  if (versionIds.length === 0) return out;

  const [evaluations, entries] = await Promise.all([
    ctx.db.evaluation.findMany({
      where: { ideaVersionId: { in: versionIds } },
      orderBy: { computedAt: "desc" },
      select: { ideaVersionId: true, compositeScore: true },
    }),
    ctx.db.rankingEntry.findMany({
      where: { ideaId: { in: rows.map((r) => r.id) } },
      orderBy: { run: { computedAt: "desc" } },
      select: { ideaId: true, rank: true, evaluation: { select: { ideaVersionId: true } } },
    }),
  ]);

  // Newest first, so the first hit for a key is the one to keep.
  const scoreByVersion = new Map<string, number>();
  for (const e of evaluations) {
    if (!scoreByVersion.has(e.ideaVersionId)) {
      scoreByVersion.set(e.ideaVersionId, Number(e.compositeScore));
    }
  }

  /**
   * `rows.some(...)` per entry used to make this O(entries × rows) — cheap on a normal
   * paginated page (`rows` bounded to `perPage`), but `listIdeasByRank` below calls this
   * with `rows` = every matching idea, unpaginated, so it scaled with the FULL cohort on
   * every `sort=rank` request. A single `ideaId -> currentVersionId` map, built once,
   * turns the lookup into O(1) per entry.
   */
  const currentVersionByIdea = new Map(rows.map((r) => [r.id, r.currentVersionId]));
  const rankByIdea = new Map<string, number>();
  for (const entry of entries) {
    // Only a run entry for the CURRENT version counts. A rank earned by v1 is not the
    // rank of v2, and showing it as one would be a quietly wrong number.
    const isCurrent = currentVersionByIdea.get(entry.ideaId) === entry.evaluation.ideaVersionId;
    if (isCurrent && !rankByIdea.has(entry.ideaId)) rankByIdea.set(entry.ideaId, entry.rank);
  }

  for (const row of rows) {
    out.set(row.id, {
      compositeScore: row.currentVersionId
        ? scoreByVersion.get(row.currentVersionId) ?? null
        : null,
      rank: rankByIdea.get(row.id) ?? null,
    });
  }
  return out;
}

/**
 * Vote totals and the caller's own vote, for a page of ideas in two queries rather than
 * `useFeedback(ideaId)` firing once per `IdeaCard` — the same N+1 `scoresForCurrentVersions`
 * above already avoids for scores, now applied to feedback (found live: a 20-idea page was
 * making 20+ separate round trips just to render vote counts).
 */
async function feedbackForIdeas(
  ctx: { db: PrismaClient },
  rows: readonly { id: string }[],
  userId: string,
): Promise<Map<string, { up: number; down: number; myVote: "UP" | "DOWN" | null }>> {
  const out = new Map<string, { up: number; down: number; myVote: "UP" | "DOWN" | null }>();
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return out;

  const [counts, mine] = await Promise.all([
    ctx.db.feedback.groupBy({
      by: ["ideaId", "type"],
      where: { ideaId: { in: ids } },
      _count: { _all: true },
    }),
    ctx.db.feedback.findMany({
      where: { ideaId: { in: ids }, userId, type: { in: ["WOULD_USE", "SEE_RISK"] } },
      select: { ideaId: true, type: true },
    }),
  ]);

  const countsByIdea = new Map<string, { up: number; down: number }>();
  for (const c of counts) {
    const entry = countsByIdea.get(c.ideaId) ?? { up: 0, down: 0 };
    if (c.type === "WOULD_USE") entry.up = c._count._all;
    else if (c.type === "SEE_RISK") entry.down = c._count._all;
    countsByIdea.set(c.ideaId, entry);
  }

  const myVoteByIdea = new Map<string, "UP" | "DOWN">();
  for (const m of mine) {
    myVoteByIdea.set(m.ideaId, m.type === "WOULD_USE" ? "UP" : "DOWN");
  }

  for (const row of rows) {
    out.set(row.id, {
      ...(countsByIdea.get(row.id) ?? { up: 0, down: 0 }),
      myVote: myVoteByIdea.get(row.id) ?? null,
    });
  }
  return out;
}

/**
 * P12 (FR-20/FR-21) — single-idea only (`getIdea`), not batched across a list: the
 * similar-idea banner and existing-solution assessment are detail-page content, same
 * scope as `getIdeaHistory`, not something a list row needs.
 *
 * Matches are per-viewer: detection searches every idea (a reviewer should hear about a
 * duplicate still in the queue), so each match goes back through `idea:read` before its
 * title leaves the API. Without that, the banner named ideas the viewer cannot open — a
 * colleague's private draft (via the trigram fallback), or a submitted-but-unranked idea
 * an employee may not see yet (assumption A5).
 */
async function detectionForIdea(
  ctx: { db: PrismaClient },
  idea: { id: string; currentVersionId?: string | null },
  actor: Parameters<typeof can>[0],
): Promise<{
  similarIdeas: readonly {
    ideaId: string; title: string; similarity: number; differenceSummary: string | null;
  }[];
  existingSolutionAssessment: {
    recommendation: "BUILD" | "BUY" | "EXTEND" | "INTEGRATE" | null;
    rationale: string | null;
    confidence: "LOW" | "MEDIUM" | "HIGH" | null;
    matches: readonly { name: string; kind: string; similarity: number }[];
  } | null;
}> {
  if (!idea.currentVersionId) return { similarIdeas: [], existingSolutionAssessment: null };

  const [similar, assessment] = await Promise.all([
    ctx.db.similarIdea.findMany({ where: { ideaId: idea.id }, orderBy: { similarity: "desc" } }),
    ctx.db.existingSolutionAssessment.findUnique({
      where: { ideaVersionId: idea.currentVersionId },
      include: { matches: { include: { existingSolution: true } } },
    }),
  ]);

  // No Prisma relation exists from `similar_to` to `ideas` (SimilarIdea is a bare
  // reserved-at-P0 table, no FK) — a plain second lookup instead of an `include`.
  const matchedIdeas = similar.length > 0
    ? await ctx.db.idea.findMany({
        where: { id: { in: similar.map((s) => s.similarTo) } },
        select: { id: true, submitterId: true, status: true, currentVersion: { select: { title: true } } },
      })
    : [];
  const readable = matchedIdeas.filter((i) =>
    can(actor, "idea:read", { ideaId: i.id, submitterId: i.submitterId, status: i.status as IdeaStatus }).allowed,
  );
  const titleByIdeaId = new Map(readable.map((i) => [i.id, i.currentVersion?.title ?? "(untitled)"]));

  return {
    // A match whose idea is gone or unreadable is dropped, never shown as "(untitled)".
    similarIdeas: similar.filter((s) => titleByIdeaId.has(s.similarTo)).map((s) => ({
      ideaId: s.similarTo,
      title: titleByIdeaId.get(s.similarTo) ?? "",
      similarity: Number(s.similarity),
      differenceSummary: s.differenceSummary,
    })),
    existingSolutionAssessment: assessment
      ? {
          recommendation: assessment.recommendation,
          rationale: assessment.rationale,
          confidence: assessment.confidence,
          matches: assessment.matches.map((m) => ({
            name: m.existingSolution.name,
            kind: m.existingSolution.kind,
            similarity: Number(m.similarity),
          })),
        }
      : null,
  };
}

/**
 * `sort: "rank"`, the whole page (SPEC row 25).
 *
 * Rank cannot be an ORDER BY: it lives on `RankingEntry`, one per run, not on `Idea`
 * (ADR-008). Sorting by it means knowing every candidate's rank BEFORE paging, so this
 * takes a different path from the other four sorts — every matching id first, ranked ones
 * ordered best-first, unranked ones (evaluated but never in a run, or not yet evaluated —
 * both real states) kept at the end in their existing recency order, THEN the one page's
 * worth of ids is loaded in full.
 *
 * Exported (rather than inlined in the handler) so it can be exercised directly against a
 * real database, the same way the rest of this module's persistence is tested.
 */
export async function listIdeasByRank(
  db: PrismaClient,
  filters: IdeaListFilterParams,
  page: number,
  perPage: number,
  userId: string,
) {
  const repo = makeIdeaRepo(db);
  const all = await repo.listIdsForRank(filters);
  const scores = await scoresForCurrentVersions({ db }, all);
  const ordered = [...all].sort((a, b) => {
    const ra = scores.get(a.id)?.rank ?? null;
    const rb = scores.get(b.id)?.rank ?? null;
    if (ra === null && rb === null) return 0;
    if (ra === null) return 1;
    if (rb === null) return -1;
    return ra - rb;
  });

  const total = ordered.length;
  const pageIds = ordered.slice((page - 1) * perPage, page * perPage).map((r) => r.id);
  const pageRows = pageIds.length
    ? await db.idea.findMany({ where: { id: { in: pageIds } }, include: IDEA_DETAIL_INCLUDE })
    : [];
  // `findMany({ id: { in } })` does not promise result order matches the array's — put
  // the page back in rank order rather than trusting it did.
  const byId = new Map(pageRows.map((row) => [row.id, row]));
  const rows = pageIds.map((id) => byId.get(id)).filter((row): row is (typeof pageRows)[number] => Boolean(row));
  const [feedback, comments] = await Promise.all([
    feedbackForIdeas({ db }, rows, userId),
    commentCountsFor(db, rows.map((row) => row.id)),
  ]);

  return {
    items: rows.map((row) =>
      toIdeaSummary(
        row,
        scores.get(row.id) ?? { compositeScore: null, rank: null },
        feedback.get(row.id),
        comments.get(row.id) ?? 0,
      ),
    ),
    meta: { page, perPage, total, totalPages: Math.ceil(total / perPage) },
  };
}

/** 404, not 403, for a resource the actor may not see — existence is not disclosed. */
const NOT_FOUND = "No idea with that id";

export function registerIdeaRoutes(handlers: Map<string, Handler>): void {
  handlers.set("listIdeas", async (request, reply, ctx) => {
    const parsed = ListIdeasQuery.safeParse(request.query);
    if (!parsed.success) return sendError(reply, "VALIDATION_FAILED", "Invalid filters");

    const actor = requireActor(request);
    const repo = makeIdeaRepo(ctx.db);
    const filters = {
      scope: ideaListScope(actor),
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
      ...(parsed.data.departmentId ? { departmentId: parsed.data.departmentId } : {}),
      ...(parsed.data.categoryId ? { categoryId: parsed.data.categoryId } : {}),
      ...(parsed.data.submitterId ? { submitterId: parsed.data.submitterId } : {}),
      ...(parsed.data.q ? { q: parsed.data.q } : {}),
    };

    if (parsed.data.sort === "rank") {
      return listIdeasByRank(ctx.db, filters, parsed.data.page, parsed.data.perPage, actor.userId);
    }

    const { rows, total } = await repo.list({
      ...filters,
      sort: parsed.data.sort,
      page: parsed.data.page,
      perPage: parsed.data.perPage,
    });

    const [scores, feedback, comments] = await Promise.all([
      scoresForCurrentVersions(ctx, rows),
      feedbackForIdeas(ctx, rows, actor.userId),
      commentCountsFor(ctx.db, rows.map((row: { id: string }) => row.id)),
    ]);

    return {
      items: rows.map((row: { id: string }) =>
        toIdeaSummary(
          row,
          scores.get(row.id) ?? { compositeScore: null, rank: null },
          feedback.get(row.id),
          comments.get(row.id) ?? 0,
        ),
      ),
      meta: {
        page: parsed.data.page,
        perPage: parsed.data.perPage,
        total,
        totalPages: Math.ceil(total / parsed.data.perPage),
      },
    };
  });

  handlers.set("createIdea", async (request, reply, ctx) => {
    const parsed = CreateIdeaRequest.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, "VALIDATION_FAILED", "Some fields need attention");
    }

    const actor = requireActor(request);
    const repo = makeIdeaRepo(ctx.db);
    const { title, description, problemStatement, expectedUsers, expectedOutcome,
      existingProcess, existingSolutions, suggestedTechnology, expectedBenefits,
      estimatedCostNote, references, useCases, departmentId, categoryId, submit } = parsed.data;

    const { ideaId, versionId } = await repo.createWithFirstVersion({
      submitterId: actor.userId,
      departmentId: departmentId ?? null,
      categoryId: categoryId ?? null,
      submit,
      fields: {
        title, description, problemStatement, expectedUsers, expectedOutcome,
        existingProcess: existingProcess ?? null,
        existingSolutions: existingSolutions ?? null,
        suggestedTechnology: suggestedTechnology ?? null,
        expectedBenefits: expectedBenefits ?? null,
        estimatedCostNote: estimatedCostNote ?? null,
        references: references ?? null,
        useCases,
      },
    });

    // 202: the idea exists, and analysis continues asynchronously (SPEC §3.3).
    // A draft is not analysed — there is nothing to evaluate until it is submitted.
    if (submit) await startAnalysis(ctx, ideaId, versionId);
    return {
      analysisRunId: ideaId,
      ideaId,
      statusUrl: `/ideas/${ideaId}/analysis/status`,
      streamUrl: `/ideas/${ideaId}/analysis/stream`,
    };
  });

  handlers.set("getIdea", async (request, reply, ctx) => {
    const { ideaId } = request.params as { ideaId: string };
    const repo = makeIdeaRepo(ctx.db);
    const idea = await repo.findById(ideaId);
    if (!idea) return sendError(reply, "NOT_FOUND", NOT_FOUND);

    const actor = requireActor(request);
    const resource = { ideaId: idea.id, submitterId: idea.submitterId, status: idea.status as IdeaStatus };
    if (!can(actor, "idea:read", resource).allowed) {
      return sendError(reply, "NOT_FOUND", NOT_FOUND);
    }
    const [feedback, scores, detection, social] = await Promise.all([
      feedbackForIdeas(ctx, [idea], actor.userId),
      scoresForCurrentVersions(ctx, [idea]),
      detectionForIdea(ctx, idea, actor),
      socialFor(ctx.db, idea.id, actor.userId),
    ]);
    return toIdeaDetail(idea, actor, feedback.get(idea.id), detection, scores.get(idea.id), social);
  });

  handlers.set("updateDraft", async (request, reply, ctx) => {
    const parsed = UpdateDraftRequest.safeParse(request.body);
    if (!parsed.success) return sendError(reply, "VALIDATION_FAILED", "Some fields need attention");

    const { ideaId } = request.params as { ideaId: string };
    const repo = makeIdeaRepo(ctx.db);
    const idea = await repo.findById(ideaId);
    if (!idea) return sendError(reply, "NOT_FOUND", NOT_FOUND);

    const actor = requireActor(request);
    const decision = can(actor, "idea:edit", {
      ideaId: idea.id, submitterId: idea.submitterId, status: idea.status as IdeaStatus,
    });
    if (!decision.allowed) {
      // A submitted idea is immutable — say that, rather than a bare 403. The user's
      // next step is "revise", and the message should point at it.
      if (decision.reason === "WRONG_STATUS") {
        return sendError(reply, "IDEA_VERSION_IMMUTABLE",
          "This idea has been submitted. Create a new version instead of editing it.");
      }
      if (decision.reason === "NOT_SUBMITTER") {
        return sendError(reply, "NOT_SUBMITTER", "Only the author can edit this idea");
      }
      return sendError(reply, "NOT_FOUND", NOT_FOUND);
    }

    // `currentVersionId` is nullable in the schema for the deferred-FK reason repo.ts's
    // createWithFirstVersion documents, but the invariant it also documents — no idea
    // exists without one once created — means it is always set by the time a DRAFT can
    // reach this handler. Stated as a real check rather than asserted past.
    if (!idea.currentVersionId) {
      throw new Error(`Idea ${idea.id} has no current version — the create-transaction invariant was violated`);
    }
    // `departmentId`/`categoryId` live on `Idea`, not `IdeaVersion` — `UpdateDraftRequest`
    // is `IdeaVersionInput.partial()`, which carries them because `IdeaVersionInput` is
    // also what `createWithFirstVersion` reads them from at creation time. Passed straight
    // through to `updateDraftVersion` they don't match any `IdeaVersion` column, and
    // Prisma throws — so split them off onto the row they actually belong to.
    const { departmentId, categoryId, ...versionFields } = parsed.data;
    const ideaFields =
      departmentId !== undefined || categoryId !== undefined
        ? {
            ...(departmentId !== undefined ? { departmentId } : {}),
            ...(categoryId !== undefined ? { categoryId } : {}),
          }
        : undefined;
    try {
      await repo.updateDraftVersion(
        idea.id,
        idea.currentVersionId,
        versionFields as Record<string, string | readonly string[] | null>,
        ideaFields,
      );
    } catch (error) {
      // The `idea:edit` check above already confirmed DRAFT — this is the same race
      // `transitionIdea` guards against below: a concurrent submit/transition (another
      // tab, a double-click) moved the idea out of DRAFT between that check and this
      // write actually committing. See `updateDraftVersion`'s own comment.
      if (error instanceof DraftEditConflict) {
        return sendError(reply, "CONCURRENT_MODIFICATION",
          "This idea's status changed while your request was in flight. Reload and try again.");
      }
      throw error;
    }
    const fresh = await repo.findById(ideaId);
    if (!fresh) throw new Error(`Idea ${ideaId} disappeared between its own update and re-fetch`);
    const [feedback, social] = await Promise.all([
      feedbackForIdeas(ctx, [fresh], actor.userId),
      socialFor(ctx.db, fresh.id, actor.userId),
    ]);
    return toIdeaDetail(fresh, actor, feedback.get(fresh.id), undefined, undefined, social);
  });

  handlers.set("createVersion", async (request, reply, ctx) => {
    const parsed = CreateVersionRequest.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, "VALIDATION_FAILED",
        "A change summary is required, along with the six core fields");
    }

    const { ideaId } = request.params as { ideaId: string };
    const repo = makeIdeaRepo(ctx.db);
    const idea = await repo.findById(ideaId);
    if (!idea) return sendError(reply, "NOT_FOUND", NOT_FOUND);

    const actor = requireActor(request);
    const decision = can(actor, "idea:revise", {
      ideaId: idea.id, submitterId: idea.submitterId, status: idea.status as IdeaStatus,
    });
    if (!decision.allowed) {
      if (decision.reason === "NOT_SUBMITTER") {
        return sendError(reply, "NOT_SUBMITTER", "Only the author can revise this idea");
      }
      if (decision.reason === "WRONG_STATUS") {
        return sendError(reply, "IDEA_VERSION_IMMUTABLE",
          "This idea is still a draft — edit it directly rather than creating a version.");
      }
      return sendError(reply, "NOT_FOUND", NOT_FOUND);
    }

    const d = parsed.data;
    const { versionId } = await repo.createNextVersion({
      ideaId,
      authorId: actor.userId,
      changeSummary: d.changeSummary,
      addressesRecommendationIds: d.addressesRecommendationIds,
      fields: {
        title: d.title, description: d.description, problemStatement: d.problemStatement,
        expectedUsers: d.expectedUsers, expectedOutcome: d.expectedOutcome,
        existingProcess: d.existingProcess ?? null,
        existingSolutions: d.existingSolutions ?? null,
        suggestedTechnology: d.suggestedTechnology ?? null,
        expectedBenefits: d.expectedBenefits ?? null,
        estimatedCostNote: d.estimatedCostNote ?? null,
        references: d.references ?? null,
        useCases: d.useCases,
      },
      requestId: request.id,
    });

    await startAnalysis(ctx, ideaId, versionId);

    return {
      analysisRunId: ideaId,
      ideaId,
      statusUrl: `/ideas/${ideaId}/analysis/status`,
      streamUrl: `/ideas/${ideaId}/analysis/stream`,
    };
  });

  handlers.set("listVersions", async (request, reply, ctx) => {
    const { ideaId } = request.params as { ideaId: string };
    const repo = makeIdeaRepo(ctx.db);
    const idea = await repo.findById(ideaId);
    if (!idea) return sendError(reply, "NOT_FOUND", NOT_FOUND);
    if (!can(requireActor(request), "idea:read", {
      ideaId: idea.id, submitterId: idea.submitterId, status: idea.status as IdeaStatus,
    }).allowed) return sendError(reply, "NOT_FOUND", NOT_FOUND);

    return { items: (await repo.listVersions(ideaId)).map(toVersionSummary) };
  });

  handlers.set("getVersion", async (request, reply, ctx) => {
    const { ideaId, versionNo } = request.params as { ideaId: string; versionNo: string };
    const repo = makeIdeaRepo(ctx.db);
    const idea = await repo.findById(ideaId);
    if (!idea) return sendError(reply, "NOT_FOUND", NOT_FOUND);
    if (!can(requireActor(request), "idea:read", {
      ideaId: idea.id, submitterId: idea.submitterId, status: idea.status as IdeaStatus,
    }).allowed) return sendError(reply, "NOT_FOUND", NOT_FOUND);

    const version = await repo.findVersion(ideaId, Number(versionNo));
    if (!version) return sendError(reply, "NOT_FOUND", "No such version of this idea");
    return toVersionDetail(version);
  });

  handlers.set("getIdeaHistory", async (request, reply, ctx) => {
    const { ideaId } = request.params as { ideaId: string };
    const repo = makeIdeaRepo(ctx.db);
    const idea = await repo.findById(ideaId);
    if (!idea) return sendError(reply, "NOT_FOUND", NOT_FOUND);
    if (!can(requireActor(request), "idea:read", {
      ideaId: idea.id, submitterId: idea.submitterId, status: idea.status as IdeaStatus,
    }).allowed) return sendError(reply, "NOT_FOUND", NOT_FOUND);

    const [versions, history] = await Promise.all([
      repo.listVersions(ideaId),
      repo.statusHistory(ideaId),
    ]);

    /**
     * The score each version actually achieved (P8, FR-24).
     *
     * Per VERSION, not per idea: the whole point of the History tab is that v2 scored
     * differently from v1, and reporting the current score against every row would make
     * the timeline claim the idea was always where it is now.
     */
    const evaluations = await ctx.db.evaluation.findMany({
      where: { ideaVersionId: { in: versions.map((v) => v.id) } },
      orderBy: { computedAt: "desc" },
      select: { ideaVersionId: true, compositeScore: true, maturityLevel: true },
    });
    const byVersion = new Map(evaluations.map((e) => [e.ideaVersionId, e]));

    /**
     * Rank is a property of a RUN, and runs are cohort-wide, so a version's rank is the
     * one it held in the most recent run that included it. An older version's rank stays
     * frozen at whatever it was — which is exactly the comparison FR-24 asks for.
     */
    const entries = await ctx.db.rankingEntry.findMany({
      where: { ideaId },
      orderBy: { run: { computedAt: "desc" } },
      select: { rank: true, evaluation: { select: { ideaVersionId: true } } },
    });
    const rankByVersion = new Map<string, number>();
    for (const entry of entries) {
      // First hit wins: the list is newest-first, so this keeps the latest rank per version.
      if (!rankByVersion.has(entry.evaluation.ideaVersionId)) {
        rankByVersion.set(entry.evaluation.ideaVersionId, entry.rank);
      }
    }

    return {
      versions: versions.map((v) => {
        const evaluation = byVersion.get(v.id);
        return {
          ...toVersionSummary(v),
          compositeScore: evaluation ? Number(evaluation.compositeScore) : null,
          rank: rankByVersion.get(v.id) ?? null,
          // null, never 1. An unevaluated version has no maturity, and defaulting it
          // would put "Level 1 — an initial thought" against a version nobody assessed.
          maturityLevel: (evaluation?.maturityLevel ?? null) as 1 | 2 | 3 | 4 | 5 | null,
        };
      }),
      statusHistory: history.map(toStatusEntry),
    };
  });

  handlers.set("transitionIdea", async (request, reply, ctx) => {
    const parsed = TransitionRequest.safeParse(request.body);
    if (!parsed.success) return sendError(reply, "VALIDATION_FAILED", "A target status is required");

    const { ideaId } = request.params as { ideaId: string };
    const repo = makeIdeaRepo(ctx.db);
    const idea = await repo.findById(ideaId);
    if (!idea) return sendError(reply, "NOT_FOUND", NOT_FOUND);

    const actor = requireActor(request);
    const from = idea.status as IdeaStatus;
    const resource = { ideaId: idea.id, submitterId: idea.submitterId, status: from };

    if (!can(actor, "idea:transition", resource).allowed) {
      return sendError(reply, "ROLE_NOT_PERMITTED", "You cannot change this idea's status");
    }

    // The transition table is the authority — illegal moves are inexpressible, not merely
    // rejected here (SPEC §5.4).
    const check = canTransition(from, parsed.data.to, {
      actorRoles: actor.roles as Role[],
      isSubmitter: idea.submitterId === actor.userId,
      reason: parsed.data.reason,
    });

    if (!check.ok) {
      switch (check.code) {
        case "REASON_REQUIRED":
          return sendError(reply, "REASON_REQUIRED",
            `Moving an idea to ${parsed.data.to} requires a reason`);
        case "ROLE_NOT_PERMITTED":
        case "NOT_SUBMITTER":
          return sendError(reply, "ROLE_NOT_PERMITTED", "Your role cannot make that change");
        case "NOT_AVAILABLE_YET":
          return sendError(reply, "NOT_IMPLEMENTED_UNTIL_M2",
            `${parsed.data.to} becomes available in a later milestone`);
        default:
          return sendError(reply, "ILLEGAL_STATUS_TRANSITION",
            `An idea cannot move from ${from} to ${parsed.data.to}`);
      }
    }

    try {
      await repo.transition({
        ideaId, from, to: parsed.data.to, actorId: actor.userId,
        reason: parsed.data.reason ?? null,
        // Carried into the audit row so a support question about one request can be
        // traced to the exact change it made.
        requestId: request.id,
      });
    } catch (error) {
      // Someone else's transition won the race between this handler's own read of `from`
      // (above) and `repo.transition`'s guarded write — see the comment at its
      // `updateMany` call. The idea did change status, just not to the one this request
      // still thinks it's leaving.
      if (error instanceof TransitionConflict) {
        return sendError(reply, "CONCURRENT_MODIFICATION",
          "This idea's status changed while your request was in flight. Reload and try again.");
      }
      throw error;
    }

    /**
     * Submitting a DRAFT starts the analysis. This was missing entirely.
     *
     * `createIdea` with `submit: true` called `startAnalysis`; this path — save a draft,
     * then press "Submit for analysis" — only changed the status. The six-step stepper
     * appeared, said "0 of 6", and polled every two seconds forever, because no job had
     * been enqueued for it to report on. Nothing errored: the idea WAS submitted, it was
     * just never going to be analysed.
     *
     * Same fire-and-forget contract as the other path: a queue outage degrades the run,
     * it does not fail a submission that is already stored.
     */
    if (parsed.data.to === "SUBMITTED" && idea.currentVersionId) {
      await startAnalysis(ctx, ideaId, idea.currentVersionId);
    }

    /*
     * P9 (found on the redesigned dashboard): archiving or rejecting an idea took it out of
     * every count but left it on the board, because the latest ranking run is an immutable
     * snapshot taken before the change — "11 on the board" against "9 ideas". A move INTO
     * or OUT OF the rankable set changes the cohort itself, so it asks for a recompute, the
     * same fire-and-forget queue a score override already uses (ADR-008). Moves within the
     * set (e.g. RANKED → UNDER_REVIEW) change nothing the engine reads, so they don't.
     */
    const wasRankable = RANKABLE_STATUSES.includes(from);
    const isRankable = RANKABLE_STATUSES.includes(parsed.data.to);
    if (wasRankable !== isRankable) {
      await ctx.ranking.enqueue({
        triggeredById: actor.userId,
        triggerReason: `idea ${ideaId} moved ${from} → ${parsed.data.to}`,
      });
    }

    const transitioned = await repo.findById(ideaId);
    if (!transitioned) throw new Error(`Idea ${ideaId} disappeared between its own transition and re-fetch`);
    const [feedback, scores, detection, social] = await Promise.all([
      feedbackForIdeas(ctx, [transitioned], actor.userId),
      scoresForCurrentVersions(ctx, [transitioned]),
      detectionForIdea(ctx, transitioned, actor),
      socialFor(ctx.db, transitioned.id, actor.userId),
    ]);
    return toIdeaDetail(
      transitioned, actor, feedback.get(transitioned.id), detection, scores.get(transitioned.id), social,
    );
  });
}

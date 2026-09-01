import {
  CreateIdeaRequest, CreateVersionRequest, ListIdeasQuery, TransitionRequest,
  UpdateDraftRequest, canTransition, can, ideaListScope,
  type IdeaStatus, type Role,
} from "@iep/contracts";
import type { Handler } from "../../server.js";
import type { AppContext } from "../../context.js";
import { requireActor, sendError } from "../../server.js";
import { makeIdeaRepo } from "./repo.js";
import { toIdeaDetail, toIdeaSummary, toVersionDetail, toVersionSummary, toStatusEntry } from "./present.js";

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
  ctx: Parameters<Handler>[2],
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

  const rankByIdea = new Map<string, number>();
  for (const entry of entries) {
    // Only a run entry for the CURRENT version counts. A rank earned by v1 is not the
    // rank of v2, and showing it as one would be a quietly wrong number.
    const isCurrent = rows.some(
      (r) => r.id === entry.ideaId && r.currentVersionId === entry.evaluation.ideaVersionId,
    );
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

/** 404, not 403, for a resource the actor may not see — existence is not disclosed. */
const NOT_FOUND = "No idea with that id";

export function registerIdeaRoutes(handlers: Map<string, Handler>): void {
  handlers.set("listIdeas", async (request, reply, ctx) => {
    const parsed = ListIdeasQuery.safeParse(request.query);
    if (!parsed.success) return sendError(reply, "VALIDATION_FAILED", "Invalid filters");

    const actor = requireActor(request);
    const repo = makeIdeaRepo(ctx.db);
    const { rows, total } = await repo.list({
      scope: ideaListScope(actor),
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
      ...(parsed.data.departmentId ? { departmentId: parsed.data.departmentId } : {}),
      ...(parsed.data.categoryId ? { categoryId: parsed.data.categoryId } : {}),
      ...(parsed.data.submitterId ? { submitterId: parsed.data.submitterId } : {}),
      ...(parsed.data.q ? { q: parsed.data.q } : {}),
      sort: parsed.data.sort,
      page: parsed.data.page,
      perPage: parsed.data.perPage,
    });

    const scores = await scoresForCurrentVersions(ctx, rows);

    return {
      items: rows.map((row: { id: string }) =>
        toIdeaSummary(row, scores.get(row.id) ?? { compositeScore: null, rank: null }),
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
      estimatedCostNote, references, departmentId, categoryId, submit } = parsed.data;

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
    return toIdeaDetail(idea, actor);
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
    await repo.updateDraftVersion(idea.currentVersionId, parsed.data as Record<string, string | null>);
    const fresh = await repo.findById(ideaId);
    if (!fresh) throw new Error(`Idea ${ideaId} disappeared between its own update and re-fetch`);
    return toIdeaDetail(fresh, actor);
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
      },
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

    await repo.transition({
      ideaId, from, to: parsed.data.to, actorId: actor.userId,
      reason: parsed.data.reason ?? null,
      // Carried into the audit row so a support question about one request can be
      // traced to the exact change it made.
      requestId: request.id,
    });

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

    const transitioned = await repo.findById(ideaId);
    if (!transitioned) throw new Error(`Idea ${ideaId} disappeared between its own transition and re-fetch`);
    return toIdeaDetail(transitioned, actor);
  });
}

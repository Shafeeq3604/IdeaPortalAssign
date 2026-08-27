import {
  CreateIdeaRequest, CreateVersionRequest, ListIdeasQuery, TransitionRequest,
  UpdateDraftRequest, canTransition, can, ideaListScope,
  type IdeaStatus, type Role,
} from "@iep/contracts";
import type { Handler } from "../../server.js";
import type { AppContext } from "../../context.js";
import { sendError } from "../../server.js";
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

/** 404, not 403, for a resource the actor may not see — existence is not disclosed. */
const NOT_FOUND = "No idea with that id";

export function registerIdeaRoutes(handlers: Map<string, Handler>): void {
  handlers.set("listIdeas", async (request, reply, ctx) => {
    const parsed = ListIdeasQuery.safeParse(request.query);
    if (!parsed.success) return sendError(reply, "VALIDATION_FAILED", "Invalid filters");

    const actor = request.actor!;
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

    return {
      items: rows.map(toIdeaSummary),
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

    const actor = request.actor!;
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

    const actor = request.actor!;
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

    const actor = request.actor!;
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

    await repo.updateDraftVersion(idea.currentVersionId!, parsed.data as Record<string, string | null>);
    const fresh = await repo.findById(ideaId);
    return toIdeaDetail(fresh!, actor);
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

    const actor = request.actor!;
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
    if (!can(request.actor!, "idea:read", {
      ideaId: idea.id, submitterId: idea.submitterId, status: idea.status as IdeaStatus,
    }).allowed) return sendError(reply, "NOT_FOUND", NOT_FOUND);

    return { items: (await repo.listVersions(ideaId)).map(toVersionSummary) };
  });

  handlers.set("getVersion", async (request, reply, ctx) => {
    const { ideaId, versionNo } = request.params as { ideaId: string; versionNo: string };
    const repo = makeIdeaRepo(ctx.db);
    const idea = await repo.findById(ideaId);
    if (!idea) return sendError(reply, "NOT_FOUND", NOT_FOUND);
    if (!can(request.actor!, "idea:read", {
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
    if (!can(request.actor!, "idea:read", {
      ideaId: idea.id, submitterId: idea.submitterId, status: idea.status as IdeaStatus,
    }).allowed) return sendError(reply, "NOT_FOUND", NOT_FOUND);

    const [versions, history] = await Promise.all([
      repo.listVersions(ideaId),
      repo.statusHistory(ideaId),
    ]);

    return {
      // Evaluation deltas per version arrive with P4's results in P8; the shape is fixed
      // now so the History tab does not change contract when they do.
      versions: versions.map((v) => ({
        ...toVersionSummary(v),
        compositeScore: null,
        rank: null,
        maturityLevel: null,
      })),
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

    const actor = request.actor!;
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

    return toIdeaDetail((await repo.findById(ideaId))!, actor);
  });
}

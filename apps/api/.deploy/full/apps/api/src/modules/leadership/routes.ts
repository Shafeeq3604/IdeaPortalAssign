import { CreateLeadershipDecisionRequest, can } from "@iep/contracts";
import type { IdeaStatus } from "@iep/contracts";
import type { Handler } from "../../server.js";
import { requireActor, sendError } from "../../server.js";
import { writeAudit } from "../../lib/audit.js";

/**
 * The final organisational decision (ADR-026).
 *
 * Mirrors review/routes.ts's `createReview` deliberately: parse → permission check
 * (conflict-of-interest before role, same as `review:create`/`score:override`) →
 * transaction writing the decision + `writeAudit` → **no status transition**. Recording a
 * `LeadershipDecision` here never moves `idea.status` — see the comment on `createReview`
 * for why: the lifecycle table (`lifecycle.ts`) is the one, separately-gated place an
 * idea's status changes, and this stays true whether the trigger is a reviewer's comment
 * or leadership's own final call (P-3).
 */

const NOT_FOUND = "No idea with that id";
const NO_RECOMMENDATION = "This idea has no AI implementation recommendation to decide on";

export function registerLeadershipRoutes(handlers: Map<string, Handler>): void {
  handlers.set("listLeadershipDecisions", async (request, reply, ctx) => {
    const { ideaId } = request.params as { ideaId: string };
    const idea = await ctx.db.idea.findUnique({ where: { id: ideaId } });
    if (!idea) return sendError(reply, "NOT_FOUND", NOT_FOUND);
    if (!can(requireActor(request), "idea:read", {
      ideaId: idea.id, submitterId: idea.submitterId, status: idea.status as IdeaStatus,
    }).allowed) return sendError(reply, "NOT_FOUND", NOT_FOUND);

    const items = await ctx.db.leadershipDecision.findMany({
      where: { ideaId },
      include: { decidedBy: { select: { id: true, displayName: true, department: { select: { name: true } } } } },
      orderBy: { createdAt: "desc" },
    });

    return {
      items: items.map((d) => ({
        id: d.id,
        decidedBy: {
          id: d.decidedBy.id,
          displayName: d.decidedBy.displayName,
          departmentName: d.decidedBy.department?.name ?? null,
        },
        recommendationId: d.recommendationId,
        status: d.status,
        rationale: d.rationale,
        createdAt: d.createdAt.toISOString(),
      })),
    };
  });

  handlers.set("createLeadershipDecision", async (request, reply, ctx) => {
    const parsed = CreateLeadershipDecisionRequest.safeParse(request.body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return sendError(reply, "VALIDATION_FAILED", first?.message ?? "Invalid decision");
    }

    const { ideaId } = request.params as { ideaId: string };
    const actor = requireActor(request);
    const idea = await ctx.db.idea.findUnique({
      where: { id: ideaId },
      include: { currentVersion: { select: { id: true } } },
    });
    if (!idea) return sendError(reply, "NOT_FOUND", NOT_FOUND);

    const verdict = can(actor, "leadership:decide", {
      ideaId: idea.id, submitterId: idea.submitterId, status: idea.status as IdeaStatus,
    });
    if (!verdict.allowed) {
      return verdict.reason === "CANNOT_REVIEW_OWN_IDEA"
        ? sendError(reply, "CANNOT_REVIEW_OWN_IDEA",
            "You cannot record the final decision on an idea you submitted.")
        : sendError(reply, "ROLE_NOT_PERMITTED", "Your role cannot record a leadership decision");
    }

    // The recommendation must belong to THIS idea's current version — a decision
    // referencing another idea's recommendation would be a broken link, not a real record.
    const recommendation = idea.currentVersion
      ? await ctx.db.aiImplementationRecommendation.findFirst({
          where: { id: parsed.data.recommendationId, ideaVersionId: idea.currentVersion.id },
        })
      : null;
    if (!recommendation) return sendError(reply, "NOT_FOUND", NO_RECOMMENDATION);

    const created = await ctx.db.$transaction(async (tx) => {
      const decision = await tx.leadershipDecision.create({
        data: {
          ideaId,
          recommendationId: recommendation.id,
          decidedById: actor.userId,
          status: parsed.data.status,
          rationale: parsed.data.rationale,
        },
        include: { decidedBy: { select: { id: true, displayName: true, department: { select: { name: true } } } } },
      });

      await writeAudit(tx, {
        actorId: actor.userId,
        action: "idea.leadershipDecision",
        entityType: "idea",
        entityId: ideaId,
        before: { aiRecommendation: recommendation.recommendation },
        after: { status: decision.status },
        reason: decision.rationale,
        requestId: request.id,
      });

      return decision;
    });

    // No status transition here — see this file's header comment and createReview's own.
    return reply.status(201).send({
      id: created.id,
      decidedBy: {
        id: created.decidedBy.id,
        displayName: created.decidedBy.displayName,
        departmentName: created.decidedBy.department?.name ?? null,
      },
      recommendationId: created.recommendationId,
      status: created.status,
      rationale: created.rationale,
      createdAt: created.createdAt.toISOString(),
    });
  });
}

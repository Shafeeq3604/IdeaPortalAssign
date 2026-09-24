import { hasPermission } from "@iep/contracts";
import { clearExistingSolutionEmbedding, findExistingSolutionIdsWithEmbedding, type PrismaClient } from "@iep/db";
import type { Handler } from "../server.js";
import { requireActor, sendError } from "../server.js";
import { writeAudit } from "../lib/audit.js";

/** `ExistingSolution.ownerDepartmentId` is a bare column, no Prisma relation declared
 *  (same reasoning as `SimilarIdea.similarTo` — see idea/routes.ts's `detectionForIdea`):
 *  a plain lookup rather than an `include`. */
async function departmentRefsFor(
  db: PrismaClient,
  ids: readonly (string | null)[],
): Promise<Map<string, { id: string; name: string }>> {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
  if (wanted.length === 0) return new Map();
  const rows = await db.department.findMany({ where: { id: { in: wanted } }, select: { id: true, name: true } });
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * Configuration: read-only view (P9, FR-13, SPEC §9.10) plus P10's weight-write endpoint.
 *
 * These exist in M1 specifically to close the orphan found at the scoping gate (D-06):
 * without them, every score in MVP1 would be unexplainable at source. `updateProfileWeights`
 * landed in P10 — until then it answered 501, an explicit deferral, never a dead button.
 */

const NOT_FOUND = "No evaluation profile with that key";

export function registerConfigRoutes(handlers: Map<string, Handler>): void {
  handlers.set("listCriteria", async (_request, _reply, ctx) => {
    const [criteria, profiles] = await Promise.all([
      ctx.db.evaluationCriterion.findMany({ orderBy: [{ group: "asc" }, { key: "asc" }] }),
      ctx.db.evaluationProfile.findMany({ include: { weights: true } }),
    ]);

    return {
      items: criteria.map((c) => ({
        key: c.key, label: c.label, description: c.description, group: c.group,
        direction: c.direction, sourceKind: c.sourceKind, isActive: c.isActive,
        // "Used in N profiles" is a nav-map relationship (§6.2 row 42), so the API
        // supplies it rather than making the client join it client-side.
        usedInProfiles: profiles
          .filter((p) => p.weights.some((w) => w.criterionId === c.id && Number(w.weight) > 0))
          .map((p) => p.key),
      })),
    };
  });

  handlers.set("listProfiles", async (request, _reply, ctx) => {
    const profiles = await ctx.db.evaluationProfile.findMany({
      include: { weights: { include: { criterion: true } } },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    });

    return {
      items: profiles.map((p) => ({
        key: p.key, name: p.name, description: p.description,
        isDefault: p.isDefault, isActive: p.isActive,
        weights: p.weights
          .map((w) => ({
            criterionKey: w.criterion.key,
            criterionLabel: w.criterion.label,
            weight: Number(w.weight),
          }))
          .sort((a, b) => b.weight - a.weight),
      })),
      // Computed here, not re-derived client-side (D-09) — the same "server decides,
      // client reads" shape `IdeaDetail.permissions` already uses.
      canEditWeights: hasPermission(requireActor(request).roles, "config:write"),
    };
  });

  handlers.set("updateProfileWeights", async (request, reply, ctx) => {
    const { profileKey } = request.params as { profileKey: string };
    // The schema's own `.refine` already rejects a bad sum or a duplicate criterion
    // before this handler runs — see UpdateProfileWeightsRequest's doc comment.
    const { weights, reason } = request.body as {
      weights: readonly { criterionKey: string; weight: number }[];
      reason: string;
    };
    const actor = requireActor(request);

    const profile = await ctx.db.evaluationProfile.findUnique({
      where: { key: profileKey },
      include: { weights: { include: { criterion: true } } },
    });
    if (!profile) return sendError(reply, "NOT_FOUND", NOT_FOUND);

    const criteria = await ctx.db.evaluationCriterion.findMany({
      where: { key: { in: weights.map((w) => w.criterionKey) } },
    });
    const criterionByKey = new Map(criteria.map((c) => [c.key, c]));
    const unknownKeys = weights
      .map((w) => w.criterionKey)
      .filter((key) => !criterionByKey.has(key));
    if (unknownKeys.length > 0) {
      return sendError(
        reply, "VALIDATION_FAILED",
        `Unknown criterion key(s): ${unknownKeys.join(", ")}`,
      );
    }

    const before = profile.weights.map((w) => ({
      criterionKey: w.criterion.key,
      weight: Number(w.weight),
    }));

    try {
      await ctx.db.$transaction(async (tx) => {
        // Replace the whole set — a rebalance, not a patch. A criterion left out of the
        // new set simply carries no weight under this profile going forward; the
        // deferred DB trigger (packages/db/prisma/migrations) still checks the FINAL
        // state at commit, so the delete-then-recreate below never persists an
        // intermediate unbalanced state.
        await tx.profileWeight.deleteMany({ where: { profileId: profile.id } });
        await tx.profileWeight.createMany({
          data: weights.map((w) => {
            const criterionId = criterionByKey.get(w.criterionKey)?.id;
            if (!criterionId) {
              // Unreachable — the unknownKeys check above already returned for this case.
              throw new Error(`criterion vanished mid-request: ${w.criterionKey}`);
            }
            return { profileId: profile.id, criterionId, weight: w.weight };
          }),
        });
        await writeAudit(tx, {
          actorId: actor.userId,
          action: "config.profileWeights",
          entityType: "evaluation_profile",
          entityId: profile.id,
          before,
          after: weights,
          reason,
          requestId: request.id,
        });
      });
    } catch (error) {
      /*
       * The application-level refine above already enforces the sum-to-1 rule, so this
       * is defense-in-depth, not the primary gate — but if it ever fires (a rounding
       * edge case, a future caller that bypasses the schema), it must not leak the raw
       * Postgres message (SPEC §4.4), and it must not read as a generic 500 either: the
       * cause is a real, nameable client mistake.
       */
      const text = String((error as { message?: string }).message ?? "");
      if (/SPEC FR-13|check_violation/i.test(text)) {
        return sendError(
          reply, "VALIDATION_FAILED",
          "Weights do not sum to 1.0000 for this profile (FR-13)",
        );
      }
      throw error;
    }

    return { ok: true as const };
  });

  /* ── categories, write UI (P10) ── */

  handlers.set("listCategories", async (request, _reply, ctx) => {
    const categories = await ctx.db.ideaCategory.findMany({
      orderBy: { label: "asc" },
      include: { _count: { select: { ideas: true } } },
    });
    return {
      items: categories.map((c) => ({
        id: c.id, key: c.key, label: c.label, isActive: c.isActive, ideaCount: c._count.ideas,
      })),
      canWrite: hasPermission(requireActor(request).roles, "config:write"),
    };
  });

  handlers.set("createCategory", async (request, _reply, ctx) => {
    const { key, label } = request.body as { key: string; label: string };
    const actor = requireActor(request);
    const created = await ctx.db.$transaction(async (tx) => {
      const category = await tx.ideaCategory.create({ data: { key, label } });
      await writeAudit(tx, {
        actorId: actor.userId, action: "config.category", entityType: "idea_category",
        entityId: category.id, after: { key, label }, requestId: request.id,
      });
      return category;
    });
    return { id: created.id, key: created.key, label: created.label, isActive: created.isActive, ideaCount: 0 };
  });

  handlers.set("updateCategory", async (request, reply, ctx) => {
    const { categoryId } = request.params as { categoryId: string };
    const patch = request.body as { label?: string; isActive?: boolean };
    const actor = requireActor(request);

    const existing = await ctx.db.ideaCategory.findUnique({ where: { id: categoryId } });
    if (!existing) return sendError(reply, "NOT_FOUND", "No category with that id");

    const updated = await ctx.db.$transaction(async (tx) => {
      const category = await tx.ideaCategory.update({ where: { id: categoryId }, data: patch });
      await writeAudit(tx, {
        actorId: actor.userId, action: "config.category", entityType: "idea_category",
        entityId: category.id,
        before: { label: existing.label, isActive: existing.isActive },
        after: patch, requestId: request.id,
      });
      return category;
    });

    const ideaCount = await ctx.db.idea.count({ where: { categoryId } });
    return { id: updated.id, key: updated.key, label: updated.label, isActive: updated.isActive, ideaCount };
  });

  /* ── existing-solution capability catalogue (P10 — P12 prerequisite, AI-11) ── */

  handlers.set("listExistingSolutions", async (request, _reply, ctx) => {
    const [solutions, embedded] = await Promise.all([
      ctx.db.existingSolution.findMany({ orderBy: { name: "asc" } }),
      findExistingSolutionIdsWithEmbedding(ctx.db),
    ]);
    const departments = await departmentRefsFor(ctx.db, solutions.map((s) => s.ownerDepartmentId));
    return {
      items: solutions.map((s) => ({
        id: s.id, name: s.name, kind: s.kind, description: s.description,
        ownerDepartment: s.ownerDepartmentId ? departments.get(s.ownerDepartmentId) ?? null : null,
        categories: s.categories, isActive: s.isActive,
        hasEmbedding: embedded.has(s.id),
      })),
      canWrite: hasPermission(requireActor(request).roles, "config:write"),
    };
  });

  handlers.set("createExistingSolution", async (request, _reply, ctx) => {
    const body = request.body as {
      name: string; kind: string; description: string;
      ownerDepartmentId?: string | null; categories: readonly string[];
    };
    const actor = requireActor(request);
    const created = await ctx.db.$transaction(async (tx) => {
      const solution = await tx.existingSolution.create({
        data: {
          name: body.name, kind: body.kind, description: body.description,
          ownerDepartmentId: body.ownerDepartmentId ?? null, categories: [...body.categories],
        },
      });
      await writeAudit(tx, {
        actorId: actor.userId, action: "config.existingSolution", entityType: "existing_solution",
        entityId: solution.id, after: body, requestId: request.id,
      });
      return solution;
    });
    const departments = await departmentRefsFor(ctx.db, [created.ownerDepartmentId]);
    return {
      id: created.id, name: created.name, kind: created.kind, description: created.description,
      ownerDepartment: created.ownerDepartmentId ? departments.get(created.ownerDepartmentId) ?? null : null,
      categories: created.categories, isActive: created.isActive,
      hasEmbedding: false,
    };
  });

  handlers.set("updateExistingSolution", async (request, reply, ctx) => {
    const { solutionId } = request.params as { solutionId: string };
    const patch = request.body as {
      name?: string; kind?: string; description?: string;
      ownerDepartmentId?: string | null; categories?: readonly string[]; isActive?: boolean;
    };
    const actor = requireActor(request);

    const existing = await ctx.db.existingSolution.findUnique({ where: { id: solutionId } });
    if (!existing) return sendError(reply, "NOT_FOUND", "No catalogue entry with that id");

    const updated = await ctx.db.$transaction(async (tx) => {
      const solution = await tx.existingSolution.update({
        where: { id: solutionId },
        data: {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.ownerDepartmentId !== undefined ? { ownerDepartmentId: patch.ownerDepartmentId } : {}),
          ...(patch.categories !== undefined ? { categories: [...patch.categories] } : {}),
          ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
        },
      });
      await writeAudit(tx, {
        actorId: actor.userId, action: "config.existingSolution", entityType: "existing_solution",
        entityId: solution.id,
        before: { name: existing.name, description: existing.description, kind: existing.kind, isActive: existing.isActive },
        after: patch, requestId: request.id,
      });
      // A description/name/categories edit invalidates the embedding computed from the
      // old text — cleared so the next idea's detection pass (packages/evaluation's
      // opportunistic backfill) re-embeds it rather than searching on stale text.
      if (patch.name !== undefined || patch.description !== undefined || patch.categories !== undefined) {
        await clearExistingSolutionEmbedding(tx, solutionId);
      }
      return solution;
    });

    const departments = await departmentRefsFor(ctx.db, [updated.ownerDepartmentId]);
    return {
      id: updated.id, name: updated.name, kind: updated.kind, description: updated.description,
      ownerDepartment: updated.ownerDepartmentId ? departments.get(updated.ownerDepartmentId) ?? null : null,
      categories: updated.categories, isActive: updated.isActive,
      hasEmbedding: false,
    };
  });

  /* ── detection thresholds (P12) ── */

  handlers.set("getDetectionConfig", async (request, _reply, ctx) => {
    const config = await ctx.db.detectionConfig.upsert({
      where: { id: "default" }, update: {}, create: { id: "default" },
    });
    return {
      similarIdeaThreshold: Number(config.similarIdeaThreshold),
      existingSolutionThreshold: Number(config.existingSolutionThreshold),
      existingSolutionTopN: config.existingSolutionTopN,
      canWrite: hasPermission(requireActor(request).roles, "config:write"),
    };
  });

  handlers.set("updateDetectionConfig", async (request, _reply, ctx) => {
    const body = request.body as {
      similarIdeaThreshold: number; existingSolutionThreshold: number; existingSolutionTopN: number;
    };
    const actor = requireActor(request);

    const before = await ctx.db.detectionConfig.findUnique({ where: { id: "default" } });
    const updated = await ctx.db.$transaction(async (tx) => {
      const config = await tx.detectionConfig.upsert({
        where: { id: "default" },
        update: {
          similarIdeaThreshold: body.similarIdeaThreshold,
          existingSolutionThreshold: body.existingSolutionThreshold,
          existingSolutionTopN: body.existingSolutionTopN,
          updatedById: actor.userId,
        },
        create: { id: "default", ...body, updatedById: actor.userId },
      });
      await writeAudit(tx, {
        actorId: actor.userId, action: "config.detectionThresholds", entityType: "detection_config",
        entityId: "default",
        before: before && {
          similarIdeaThreshold: Number(before.similarIdeaThreshold),
          existingSolutionThreshold: Number(before.existingSolutionThreshold),
          existingSolutionTopN: before.existingSolutionTopN,
        },
        after: body, requestId: request.id,
      });
      return config;
    });

    return {
      similarIdeaThreshold: Number(updated.similarIdeaThreshold),
      existingSolutionThreshold: Number(updated.existingSolutionThreshold),
      existingSolutionTopN: updated.existingSolutionTopN,
      canWrite: true,
    };
  });
}

import type { Handler } from "../server.js";
import { sendError } from "../server.js";

/**
 * Read-only configuration (FR-13, SPEC §9.10).
 *
 * These exist in M1 specifically to close the orphan found at the scoping gate (D-06):
 * without them, every score in MVP1 would be unexplainable at source. Writes are M2 and
 * answer 501 — an explicit deferral, never a dead button.
 */
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

  handlers.set("listProfiles", async (_request, _reply, ctx) => {
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
    };
  });

  handlers.set("updateProfileWeights", (_request, reply) =>
    sendError(reply, "NOT_IMPLEMENTED_UNTIL_M2",
      "Editing weights lands in M2 (P10). The values are visible read-only until then."),
  );
}

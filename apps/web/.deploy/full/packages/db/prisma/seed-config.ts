import type { PrismaClient } from "@prisma/client";
import { CRITERIA, PROFILES, profileWeightSum } from "@iep/contracts";
import { DEFAULT_ROUTES } from "@iep/ai";

/**
 * The config half of `seed.ts` — evaluation criteria, profiles/weights, and model
 * routes — pulled out into its own module so it can run WITHOUT the demo accounts,
 * demo password, and demo ideas the rest of `seed.ts` also creates.
 *
 * Why this exists: an environment can end up with real submitted ideas but no
 * evaluation config at all (e.g. `pnpm db:seed` was never run against it, or was run
 * before a schema fix and landed in the wrong schema). `evaluateVersion` and the
 * rankings board both require a default `EvaluationProfile` to exist — without one,
 * evaluation throws right after analysis finishes and the rankings endpoint 400s for
 * every idea. Re-running the FULL seed fixes it but also creates four
 * publicly-documented demo logins and eight demo ideas, unwanted on a URL other
 * people can already reach with real content. This is the same upsert logic, minus
 * that — see `seed-config-cli.ts` for the standalone entrypoint, and this repo's
 * Dockerfiles for why it also runs automatically on every container start.
 *
 * Idempotent, like `seed.ts` itself: safe to run on every boot, and safe to run more
 * than once by hand. A pure library module — importing this file runs nothing.
 */
export async function seedEvaluationConfig(prisma: PrismaClient): Promise<void> {
  // Fail before writing anything if the config is internally inconsistent. The DB
  // trigger would also reject it, but a clear message here beats a constraint violation.
  for (const profile of PROFILES) {
    const sum = profileWeightSum(profile);
    if (Math.abs(sum - 1) > 0.0001) {
      throw new Error(`Profile "${profile.key}" weights sum to ${sum}, expected 1.0000 (FR-13)`);
    }
    for (const key of Object.keys(profile.weights)) {
      if (!CRITERIA.some((c) => c.key === key)) {
        throw new Error(`Profile "${profile.key}" references unknown criterion "${key}"`);
      }
    }
  }

  for (const c of CRITERIA) {
    await prisma.evaluationCriterion.upsert({
      where: { key: c.key },
      update: {
        label: c.label, description: c.description, group: c.group,
        direction: c.direction, sourceKind: c.sourceKind,
      },
      create: {
        key: c.key, label: c.label, description: c.description, group: c.group,
        direction: c.direction, sourceKind: c.sourceKind,
      },
    });
  }

  const criterionIds = new Map(
    (await prisma.evaluationCriterion.findMany({ select: { id: true, key: true } })).map(
      (c) => [c.key, c.id] as const,
    ),
  );

  for (const p of PROFILES) {
    const profile = await prisma.evaluationProfile.upsert({
      where: { key: p.key },
      update: { name: p.name, description: p.description, isDefault: p.isDefault },
      create: { key: p.key, name: p.name, description: p.description, isDefault: p.isDefault },
    });

    // Replace weights inside one transaction: the sum-to-1.0 trigger is DEFERRED, so an
    // intermediate unbalanced state is fine but an unbalanced COMMIT is not.
    await prisma.$transaction([
      prisma.profileWeight.deleteMany({ where: { profileId: profile.id } }),
      prisma.profileWeight.createMany({
        data: Object.entries(p.weights).map(([criterionKey, weight]) => {
          const criterionId = criterionIds.get(criterionKey);
          if (criterionId === undefined) {
            throw new Error(`Seed data is missing an expected key: ${criterionKey}`);
          }
          return { profileId: profile.id, criterionId, weight };
        }),
      }),
    ]);
  }

  // Model routing is configuration, not code (ADR-021).
  for (const r of DEFAULT_ROUTES) {
    await prisma.aiModelRoute.upsert({
      where: { storyKey: r.storyKey },
      update: {
        tier: r.tier, modelId: r.modelId, effort: r.effort,
        thinkingMode: r.thinkingMode, thinkingBudgetTokens: r.thinkingBudgetTokens,
        maxTokens: r.maxTokens, enabled: r.enabled,
      },
      create: {
        storyKey: r.storyKey, tier: r.tier, modelId: r.modelId, effort: r.effort,
        thinkingMode: r.thinkingMode, thinkingBudgetTokens: r.thinkingBudgetTokens,
        maxTokens: r.maxTokens, enabled: r.enabled,
      },
    });
  }
}

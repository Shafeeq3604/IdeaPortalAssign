import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { CRITERIA, PROFILES, profileWeightSum } from "@iep/contracts";
import { DEFAULT_ROUTES } from "@iep/ai";
import { DEMO_IDEAS } from "./demo-ideas.js";

/**
 * Seed: configuration + demo data (P0 deliverable, `pnpm db:seed`).
 *
 * Idempotent — safe to run repeatedly. Criteria, profiles and model routes are CONFIG,
 * not fixtures: they are what the engine and the router actually read at runtime.
 *
 * The 12-idea fixture corpus is deliberately NOT seeded here. It belongs to the test
 * suites (packages/contracts/src/fixtures/ideas.ts), and seeding it would make the
 * engine's own tests circular.
 */

const prisma = new PrismaClient();

const DEPARTMENTS = ["Operations", "Engineering", "Finance", "People", "Customer Support"];

const CATEGORIES = [
  { key: "automation", label: "Automation" },
  { key: "customer-experience", label: "Customer experience" },
  { key: "cost-saving", label: "Cost saving" },
  { key: "employee-experience", label: "Employee experience" },
  { key: "data-and-insight", label: "Data & insight" },
  { key: "compliance-and-risk", label: "Compliance & risk" },
];

/** Mirrors SPEC §4.2 so a developer can exercise every role locally. */
const DEMO_USERS = [
  { email: "employee@example.invalid", displayName: "Erin Employee", roles: ["EMPLOYEE"] },
  { email: "reviewer@example.invalid", displayName: "Rae Reviewer", roles: ["EMPLOYEE", "REVIEWER"] },
  { email: "admin@example.invalid", displayName: "Ash Admin", roles: ["EMPLOYEE", "ADMIN"] },
  { email: "manager@example.invalid", displayName: "Mo Manager", roles: ["EMPLOYEE", "MANAGEMENT"] },
] as const;

async function main(): Promise<void> {
  // Fail before writing anything if the config is internally inconsistent. The DB trigger
  // would also reject it, but a clear message here beats a constraint violation.
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

  const departments = new Map<string, string>();
  for (const name of DEPARTMENTS) {
    const row = await prisma.department.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    departments.set(name, row.id);
  }

  for (const c of CATEGORIES) {
    await prisma.ideaCategory.upsert({
      where: { key: c.key },
      update: { label: c.label },
      create: { key: c.key, label: c.label },
    });
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
        data: Object.entries(p.weights).map(([criterionKey, weight]) => ({
          profileId: profile.id,
          criterionId: criterionIds.get(criterionKey)!,
          weight,
        })),
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

  const deptNames = [...departments.keys()];
  for (const [i, u] of DEMO_USERS.entries()) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: { displayName: u.displayName },
      create: {
        email: u.email,
        displayName: u.displayName,
        externalSubject: `dev|${u.email}`,
        departmentId: departments.get(deptNames[i % deptNames.length]!)!,
      },
    });
    await prisma.userRole.deleteMany({ where: { userId: user.id } });
    await prisma.userRole.createMany({
      data: u.roles.map((role) => ({ userId: user.id, role })),
    });
  }

  /**
   * Demo ideas, created SUBMITTED but NOT analysed.
   *
   * The seed must not require Redis or a model provider — it is the first thing you run,
   * before anything else is up. `pnpm demo:data` walks the pipeline over whatever is
   * unanalysed afterwards, so seeding and analysing stay independently runnable and a
   * failure in one does not strand the other.
   *
   * CLAUDE.md has always documented `db:seed` as seeding ideas. Until now it did not, and
   * a fresh install opened on an empty product.
   */
  const seedUsers = await prisma.user.findMany({ orderBy: { email: "asc" } });
  const deptIds = [...departments.values()];
  let createdIdeas = 0;

  for (const [i, idea] of DEMO_IDEAS.entries()) {
    // Idempotent, like everything else here: re-running must not duplicate them.
    const existing = await prisma.ideaVersion.findFirst({ where: { title: idea.title } });
    if (existing) continue;

    const author = seedUsers[i % seedUsers.length]!;
    const row = await prisma.idea.create({
      data: {
        submitterId: author.id,
        departmentId: deptIds[i % deptIds.length]!,
        status: "SUBMITTED",
        submittedAt: new Date(),
      },
    });

    const version = await prisma.ideaVersion.create({
      data: {
        ideaId: row.id,
        versionNo: 1,
        authorId: author.id,
        contentHash: createHash("sha256")
          .update(JSON.stringify({ ...idea.optional, title: idea.title }))
          .digest("hex")
          .slice(0, 32),
        changeSummary: null, // v1 has none — the DB CHECK enforces it
        title: idea.title,
        description: idea.description,
        problemStatement: idea.problemStatement,
        expectedUsers: idea.expectedUsers,
        expectedOutcome: idea.expectedOutcome,
        existingProcess: idea.optional.existingProcess ?? null,
        existingSolutions: idea.optional.existingSolutions ?? null,
        suggestedTechnology: idea.optional.suggestedTechnology ?? null,
        expectedBenefits: idea.optional.expectedBenefits ?? null,
        estimatedCostNote: idea.optional.estimatedCostNote ?? null,
        references: idea.optional.references ?? null,
      },
    });

    await prisma.idea.update({
      where: { id: row.id },
      data: { currentVersionId: version.id },
    });
    // FR-23: a transition without a record is impossible, seed included.
    await prisma.statusHistory.create({
      data: { ideaId: row.id, fromStatus: "DRAFT", toStatus: "SUBMITTED", actorId: author.id },
    });
    createdIdeas += 1;
  }

  console.log(
    `seeded: ${DEPARTMENTS.length} departments, ${CATEGORIES.length} categories, ` +
      `${CRITERIA.length} criteria, ${PROFILES.length} profiles, ` +
      `${DEFAULT_ROUTES.length} model routes, ${DEMO_USERS.length} users, ` +
      `${createdIdeas} new demo idea(s)`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());

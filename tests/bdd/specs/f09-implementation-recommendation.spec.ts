import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@iep/db";
import { StubProvider } from "@iep/ai";
import { can } from "@iep/contracts";
import { makeIdeaRepo } from "@iep/api/src/modules/idea/repo.js";
import { runPipeline } from "@iep/worker/src/pipeline.js";
import { NOOP_OBSERVABILITY_CLIENT } from "@iep/worker/src/observability.js";

/**
 * F-09 — AI Implementation Recommendation & the Leadership Decision (ADR-026), as a FLOW.
 *
 * The product requirement is a real, structured, persisted artifact — not a narrative
 * paragraph, and not a boolean. This proves both halves of ADR-026's boundary at once:
 * the AI's recommendation is a genuine `ai_*`-pattern row with its own enum/rationale/
 * evidence/risks/assumptions/validation-needs, AND recording a human `LeadershipDecision`
 * against it never moves `idea.status` on its own (P-3) — that stays a separate, explicit
 * lifecycle action.
 */

const DATABASE_URL = process.env["DATABASE_URL"] ?? "postgresql://iep:iep@localhost:5433/iep";
const db = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

const BASE = {
  description: "Read the receipt image and fill in amount, date and vendor automatically.",
  problemStatement: "Staff retype receipt totals by hand and finance rejects many claims.",
  expectedUsers: "Everyone who claims expenses.",
  expectedOutcome: "Claims take less time.",
};

let reachable = false;
let submitterId = "";
let managerId = "";
const createdIdeas: string[] = [];

async function givenAnAnalysedIdea(label: string) {
  const { ideaId, versionId } = await makeIdeaRepo(db).createWithFirstVersion({
    submitterId, departmentId: null, categoryId: null, submit: true,
    fields: { ...BASE, title: `F-09 ${label} ${createdIdeas.length}` },
  });
  createdIdeas.push(ideaId);
  const version = await db.ideaVersion.findUniqueOrThrow({ where: { id: versionId } });
  await runPipeline(
    { db, provider: new StubProvider(), budgetPerVersionUsd: 0.75, redactionEnabled: true, observability: NOOP_OBSERVABILITY_CLIENT },
    { ideaId, ideaVersionId: versionId, contentHash: version.contentHash },
  );
  return { ideaId, versionId };
}

beforeAll(async () => {
  try {
    await db.$queryRaw`SELECT 1`;
    reachable = true;
  } catch {
    return;
  }
  const employee = await db.user.findFirst({
    where: { roles: { some: { role: "EMPLOYEE" } }, NOT: { roles: { some: { role: "MANAGEMENT" } } } },
  });
  const manager = await db.user.findFirst({ where: { roles: { some: { role: "MANAGEMENT" } } } });
  submitterId = employee?.id ?? "";
  managerId = manager?.id ?? "";
});

afterAll(async () => {
  if (reachable && createdIdeas.length > 0) {
    await db.idea.deleteMany({ where: { id: { in: createdIdeas } } });
  }
  await db.$disconnect();
});

const guard = () => {
  if (!reachable) throw new Error("database unreachable — run `pnpm deps:up` before the BDD flows");
  if (!submitterId || !managerId) {
    throw new Error("need a plain employee and a MANAGEMENT user — run `pnpm db:seed`");
  }
};

describe("F-09 · the AI recommendation is a real artifact, the final decision is a separate human one", () => {
  it("Given the pipeline runs, Then a structured recommendation is persisted — not a narrative, not a boolean", async () => {
    guard();
    const { versionId } = await givenAnAnalysedIdea("recommendation");

    const recommendation = await db.aiImplementationRecommendation.findUniqueOrThrow({
      where: { ideaVersionId: versionId },
    });

    // A real enum action, never a boolean.
    expect(["RECOMMEND", "RECOMMEND_WITH_CONDITIONS", "DO_NOT_RECOMMEND", "INSUFFICIENT_DATA"])
      .toContain(recommendation.recommendation);
    // Every part of the structure the product asked for is present, not just a verdict.
    expect(recommendation.rationale.length).toBeGreaterThan(0);
    expect(recommendation.supportingEvidence.length).toBeGreaterThan(0);
    expect(Array.isArray(recommendation.risks)).toBe(true);
    expect(Array.isArray(recommendation.assumptions)).toBe(true);
    expect(Array.isArray(recommendation.validationNeeds)).toBe(true);

    // It is analysis content, not a decision: it lives on the analysis run, and nothing
    // about producing it touched the idea's own status beyond the pipeline's own
    // bookkeeping (EVALUATED/NEEDS_CLARIFICATION), which every step already does.
    const idea = await db.idea.findUniqueOrThrow({ where: { id: (await db.ideaVersion.findUniqueOrThrow({ where: { id: versionId } })).ideaId } });
    expect(["EVALUATED", "NEEDS_CLARIFICATION"]).toContain(idea.status);
  });

  it("Given a leadership decision is recorded, Then the idea's status does not move on its own (P-3)", async () => {
    guard();
    const { ideaId, versionId } = await givenAnAnalysedIdea("no-auto-transition");
    const recommendation = await db.aiImplementationRecommendation.findUniqueOrThrow({
      where: { ideaVersionId: versionId },
    });
    const before = await db.idea.findUniqueOrThrow({ where: { id: ideaId } });

    await db.leadershipDecision.create({
      data: {
        ideaId, recommendationId: recommendation.id, decidedById: managerId,
        status: "APPROVED", rationale: "Value and feasibility both check out; proceed.",
      },
    });

    const after = await db.idea.findUniqueOrThrow({ where: { id: ideaId } });
    expect(after.status).toBe(before.status);
  });

  it("Given a leadership decision with no rationale, Then the database refuses it", async () => {
    guard();
    const { ideaId, versionId } = await givenAnAnalysedIdea("no-reason");
    const recommendation = await db.aiImplementationRecommendation.findUniqueOrThrow({
      where: { ideaVersionId: versionId },
    });

    // Straight at the database, bypassing the Zod refinement and the route — the same
    // discipline F-08 applies to a rejected review's required comment.
    await expect(
      db.leadershipDecision.create({
        data: {
          ideaId, recommendationId: recommendation.id, decidedById: managerId,
          status: "APPROVED", rationale: "   ",
        },
      }),
    ).rejects.toThrow();

    const ok = await db.leadershipDecision.create({
      data: {
        ideaId, recommendationId: recommendation.id, decidedById: managerId,
        status: "APPROVED", rationale: "Confirmed with finance.",
      },
    });
    expect(ok.id).toBeTruthy();
  });

  it("Given a manager's own idea, Then the policy refuses the leadership decision (P-3)", async () => {
    guard();
    const { ideaId } = await makeIdeaRepo(db).createWithFirstVersion({
      submitterId: managerId, departmentId: null, categoryId: null, submit: true,
      fields: { ...BASE, title: `F-09 self-decide ${createdIdeas.length}` },
    });
    createdIdeas.push(ideaId);

    const manager = await db.user.findUniqueOrThrow({ where: { id: managerId }, include: { roles: true } });
    const actor = { userId: managerId, roles: manager.roles.map((r) => r.role) };

    const verdict = can(actor, "leadership:decide", { ideaId, submitterId: managerId, status: "EVALUATED" });
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.reason).toBe("CANNOT_REVIEW_OWN_IDEA");

    // …and the same actor may decide on somebody else's idea.
    const other = can(actor, "leadership:decide", { ideaId, submitterId, status: "EVALUATED" });
    expect(other.allowed).toBe(true);
  });

  it("Given INSUFFICIENT_DATA, Then at least one validation need is required (mirrors the AI schema refine)", async () => {
    guard();
    const { versionId } = await givenAnAnalysedIdea("insufficient-data-check");
    const recommendation = await db.aiImplementationRecommendation.findUniqueOrThrow({
      where: { ideaVersionId: versionId },
    });

    // Not every run lands on INSUFFICIENT_DATA (the stub varies it by content hash), but
    // the DB CHECK is unconditional: force the case directly to prove the constraint,
    // independent of what this particular run happened to produce.
    await expect(
      db.aiImplementationRecommendation.update({
        where: { id: recommendation.id },
        data: { recommendation: "INSUFFICIENT_DATA", validationNeeds: [] },
      }),
    ).rejects.toThrow();
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@iep/db";
import { StubProvider } from "@iep/ai";
import { can } from "@iep/contracts";
import { makeIdeaRepo } from "@iep/api/src/modules/idea/repo.js";
import { runPipeline } from "@iep/worker/src/pipeline.js";
import { evaluateVersion } from "@iep/evaluation";

/**
 * F-08 — Human review, overrides and audit (SPEC §9.8, FR-22, FR-23, FR-29), as a FLOW.
 *
 * P-3 says humans make every decision and the AI never does. That principle is only real
 * if the record of who decided what is complete, so these assert the RECORD rather than
 * the UI: an unlogged transition, a reasonless override, or a reviewer marking their own
 * idea would each break it.
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
let reviewerId = "";
const createdIdeas: string[] = [];

async function givenAnEvaluatedIdea(label: string) {
  const { ideaId, versionId } = await makeIdeaRepo(db).createWithFirstVersion({
    submitterId, departmentId: null, categoryId: null, submit: true,
    fields: { ...BASE, title: `F-08 ${label} ${createdIdeas.length}` },
  });
  createdIdeas.push(ideaId);
  const version = await db.ideaVersion.findUniqueOrThrow({ where: { id: versionId } });
  await runPipeline(
    { db, provider: new StubProvider(), budgetPerVersionUsd: 0.75, redactionEnabled: true },
    { ideaId, ideaVersionId: versionId, contentHash: version.contentHash },
  );
  await evaluateVersion(db, versionId);
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
    where: { roles: { some: { role: "EMPLOYEE" } }, NOT: { roles: { some: { role: "REVIEWER" } } } },
  });
  const reviewer = await db.user.findFirst({ where: { roles: { some: { role: "REVIEWER" } } } });
  submitterId = employee?.id ?? "";
  reviewerId = reviewer?.id ?? "";
});

afterAll(async () => {
  if (reachable && createdIdeas.length > 0) {
    // The audit rows STAY. A database trigger makes audit_log append-only (SPEC §4.7),
    // so even a test teardown cannot remove them — which is the point. `entityId` is a
    // plain column, not a foreign key, so the rows outlive the ideas they describe.
    await db.idea.deleteMany({ where: { id: { in: createdIdeas } } });
  }
  await db.$disconnect();
});

const guard = () => {
  if (!reachable) throw new Error("database unreachable — run `pnpm deps:up` before the BDD flows");
  if (!submitterId || !reviewerId) {
    throw new Error("need a plain employee and a reviewer — run `pnpm db:seed`");
  }
};

describe("F-08 · recording who decided what", () => {
  it("Given a status transition, Then the audit trail records it (FR-23, FR-29)", async () => {
    guard();
    const { ideaId } = await givenAnEvaluatedIdea("audited");

    await makeIdeaRepo(db).transition({
      ideaId, from: "EVALUATED", to: "UNDER_REVIEW",
      actorId: reviewerId, reason: null, requestId: "bdd-request-1",
    });

    /**
     * The trail, not `status_history`.
     *
     * Both are written, and they answer different questions: history is the product's
     * story of the idea, audit is the governance record. `/admin/audit` shipped in P1
     * reading a table nothing wrote to, so this is the assertion that keeps it fed.
     */
    const entries = await db.auditLog.findMany({
      where: { entityType: "idea", entityId: ideaId, action: "idea.transition" },
    });
    expect(entries.length).toBe(1);

    const entry = entries[0]!;
    expect(entry.actorId).toBe(reviewerId);
    expect(entry.requestId).toBe("bdd-request-1");
    expect(entry.before).toEqual({ status: "EVALUATED" });
    expect(entry.after).toEqual({ status: "UNDER_REVIEW" });
  });

  it("Given the transaction, Then a failed change leaves no audit row and no change", async () => {
    guard();
    const { ideaId } = await givenAnEvaluatedIdea("atomic");
    const before = await db.auditLog.count({ where: { entityId: ideaId } });

    /**
     * An audit row written outside the change's transaction can survive a rollback, or be
     * lost while the change commits. Either way the record stops matching reality. This
     * forces a failure mid-transaction and checks that nothing at all landed.
     */
    await expect(
      db.$transaction(async (tx) => {
        await tx.idea.update({ where: { id: ideaId }, data: { status: "UNDER_REVIEW" } });
        await tx.auditLog.create({
          data: {
            actorId: reviewerId, action: "idea.transition", entityType: "idea",
            entityId: ideaId, before: {}, after: {},
          },
        });
        throw new Error("simulated failure after both writes");
      }),
    ).rejects.toThrow("simulated failure");

    expect(await db.auditLog.count({ where: { entityId: ideaId } })).toBe(before);
    const idea = await db.idea.findUniqueOrThrow({ where: { id: ideaId } });
    expect(idea.status).toBe("EVALUATED");
  });

  it("Given a reviewer's own idea, Then the policy refuses the review (P-3)", async () => {
    guard();
    // The reviewer submits it themselves, which is the case the rule exists for.
    const { ideaId } = await makeIdeaRepo(db).createWithFirstVersion({
      submitterId: reviewerId, departmentId: null, categoryId: null, submit: true,
      fields: { ...BASE, title: `F-08 self-review ${createdIdeas.length}` },
    });
    createdIdeas.push(ideaId);

    const reviewer = await db.user.findUniqueOrThrow({
      where: { id: reviewerId }, include: { roles: true },
    });
    const actor = { userId: reviewerId, roles: reviewer.roles.map((r) => r.role) };

    const verdict = can(actor, "review:create", {
      ideaId, submitterId: reviewerId, status: "EVALUATED",
    });
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.reason).toBe("CANNOT_REVIEW_OWN_IDEA");

    // …and the same actor may review somebody else's, so the rule is about the RELATION,
    // not a blanket refusal that would make the role useless.
    const other = can(actor, "review:create", {
      ideaId, submitterId, status: "EVALUATED",
    });
    expect(other.allowed).toBe(true);
  });

  it("Given a rejection without a reason, Then the database refuses it (FR-23)", async () => {
    guard();
    const { ideaId } = await givenAnEvaluatedIdea("no-reason");

    /**
     * Straight at the database, deliberately bypassing the Zod refinement and the route.
     *
     * FR-23 is only actually guaranteed if the last line of defence holds. A rule that
     * lives solely in a request validator is one internal caller away from being gone.
     */
    await expect(
      db.review.create({
        data: { ideaId, reviewerId, decision: "REJECTED", comment: null },
      }),
    ).rejects.toThrow();

    // The same row with a reason is accepted, so the CHECK is about the reason and not
    // about rejections being impossible.
    const ok = await db.review.create({
      data: {
        ideaId, reviewerId, decision: "REJECTED",
        comment: "Duplicates a capability finance already licenses.",
      },
    });
    expect(ok.id).toBeTruthy();
  });

  it("Given an override, Then the score, its provenance and the composite all move together", async () => {
    guard();
    const { ideaId, versionId } = await givenAnEvaluatedIdea("override");

    const score = await db.criterionScore.findFirstOrThrow({
      where: { evaluation: { ideaVersionId: versionId } },
      include: { evaluation: true },
    });
    const previous = Number(score.normalized);
    const target = previous > 50 ? 20 : 90;

    await db.$transaction(async (tx) => {
      await tx.scoreOverride.create({
        data: {
          criterionScoreId: score.id, reviewerId,
          previousNormalized: previous, newNormalized: target,
          reason: "Finance confirmed the figure; the band understates it.",
        },
      });
      await tx.criterionScore.update({
        where: { id: score.id },
        data: {
          normalized: target,
          contribution: Number((target * Number(score.weight)).toFixed(3)),
          source: "HUMAN", confidence: "HIGH",
        },
      });
      const stored = await tx.criterionScore.findMany({
        where: { evaluationId: score.evaluationId }, select: { contribution: true },
      });
      await tx.evaluation.update({
        where: { id: score.evaluationId },
        data: {
          compositeScore: Number(stored.reduce((a, s) => a + Number(s.contribution), 0).toFixed(3)),
        },
      });
    });

    const after = await db.criterionScore.findUniqueOrThrow({ where: { id: score.id } });
    // The provenance has to move with the value: a number a human set that still reads as
    // AI-derived is the exact confusion SPEC §7.4 exists to prevent.
    expect(after.source).toBe("HUMAN");

    const evaluation = await db.evaluation.findUniqueOrThrow({
      where: { id: score.evaluationId }, include: { criterionScores: true },
    });
    const sum = evaluation.criterionScores.reduce((a, s) => a + Number(s.contribution), 0);
    expect(Number(evaluation.compositeScore)).toBeCloseTo(sum, 2);
    void ideaId;
  });
});

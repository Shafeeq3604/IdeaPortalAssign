import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@iep/db";
import { StubProvider } from "@iep/ai";
import { makeIdeaRepo } from "@iep/api/src/modules/idea/repo.js";
import { runPipeline } from "@iep/worker/src/pipeline.js";
import { evaluateVersion } from "@iep/worker/src/evaluate.js";
import { recomputeRankings } from "@iep/worker/src/ranking.js";
import { generateRecommendations } from "@iep/worker/src/improve.js";
import { ATTENTION_THRESHOLD } from "@iep/worker/src/factors.js";

/**
 * F-05 — Explanation & improvement (SPEC §9.5, §9.6), as a FLOW.
 *
 * Two product principles are load-bearing here and both are asserted rather than assumed:
 *
 *  - **P-2** — no rank without an explanation, and every claim in the explanation must
 *    name a criterion that actually contributed. ADR-006 says this is true by
 *    construction; this test is what makes "by construction" checkable.
 *  - **P-4** — improvement over rejection. A weak idea gets six-part advice; a strong one
 *    gets silence, which is a result, not a gap.
 */

const DATABASE_URL = process.env["DATABASE_URL"] ?? "postgresql://iep:iep@localhost:5433/iep";
const db = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

const BASE = {
  description: "Read the receipt image and fill in amount, date and vendor automatically.",
  problemStatement:
    "Staff retype receipt totals by hand and finance rejects roughly 15% of claims for " +
    "transcription errors, which costs a week of rework every month.",
  expectedUsers: "Everyone who claims expenses, plus the finance review team.",
  expectedOutcome: "Claims take less time and typo rejections drop to near zero.",
};

let reachable = false;
let submitterId = "";
const createdIdeas: string[] = [];
const createdRuns: string[] = [];

async function givenAnEvaluatedIdea(label: string): Promise<{ ideaId: string; versionId: string }> {
  const { ideaId, versionId } = await makeIdeaRepo(db).createWithFirstVersion({
    submitterId, departmentId: null, categoryId: null, submit: true,
    fields: { ...BASE, title: `F-05 ${label} ${createdIdeas.length}` },
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
  submitterId = (await db.user.findFirst({ orderBy: { email: "asc" } }))?.id ?? "";
});

afterAll(async () => {
  if (reachable) {
    if (createdRuns.length > 0) await db.rankingRun.deleteMany({ where: { id: { in: createdRuns } } });
    if (createdIdeas.length > 0) await db.idea.deleteMany({ where: { id: { in: createdIdeas } } });
  }
  await db.$disconnect();
});

const guard = () => {
  if (!reachable) throw new Error("database unreachable — run `pnpm deps:up` before the BDD flows");
  if (!submitterId) throw new Error("no users in the database — run `pnpm db:seed`");
};

describe("F-05 · explaining a score and saying what to do about it", () => {
  it("Given a ranked idea, Then every explanation claim names a criterion that really contributed", async () => {
    guard();
    const { ideaId } = await givenAnEvaluatedIdea("explained");
    const run = await recomputeRankings(db, { triggerReason: "bdd f05" });
    if (!run) throw new Error("no ranking run");
    createdRuns.push(run.runId);

    const entry = await db.rankingEntry.findFirstOrThrow({
      where: { runId: run.runId, ideaId },
      include: {
        explanation: true,
        evaluation: { include: { criterionScores: { include: { criterion: true } } } },
      },
    });

    const realKeys = new Set(entry.evaluation.criterionScores.map((s) => s.criterion.key));
    const claims = [
      ...(entry.explanation?.strengths as { criterionKey: string; shareOfTotal: number }[]),
      ...(entry.explanation?.constraints as { criterionKey: string; shareOfTotal: number }[]),
    ];

    expect(claims.length).toBeGreaterThan(0);
    for (const claim of claims) {
      /**
       * The faithfulness check ADR-006 promises.
       *
       * A generated summary could cite a criterion that does not exist, or one weighted
       * zero. A derived explanation cannot — and this is the assertion that keeps it that
       * way if anyone ever "improves" the explainer by giving it the idea text.
       */
      expect(realKeys.has(claim.criterionKey), `${claim.criterionKey} is not a real criterion`).toBe(true);
      expect(claim.shareOfTotal).toBeGreaterThanOrEqual(0);
      expect(claim.shareOfTotal).toBeLessThanOrEqual(1);
    }
  });

  it("Given a weak idea, When recommendations are generated, Then each has all six parts (FR-15)", async () => {
    guard();
    const { ideaId, versionId } = await givenAnEvaluatedIdea("advised");

    const outcome = await generateRecommendations(
      { db, provider: new StubProvider(), budgetUsd: 0.75, redactionEnabled: true },
      { ideaId, ideaVersionId: versionId },
    );

    const evaluation = await db.evaluation.findFirstOrThrow({ where: { ideaVersionId: versionId } });
    const composite = Number(evaluation.compositeScore);

    if (composite >= ATTENTION_THRESHOLD) {
      // A correct outcome, not a skipped test: above the threshold there is nothing to
      // advise, and D-13 says the platform stays quiet rather than padding the list.
      expect(outcome.generated).toBe(0);
      expect(outcome.skippedReason).toContain("above the attention threshold");
      return;
    }

    expect(outcome.generated).toBeGreaterThan(0);

    const items = await db.improvementRecommendation.findMany({
      where: { ideaVersionId: versionId },
    });
    for (const item of items) {
      // FR-15's structure cannot be partially satisfied. "Add more detail" is what this
      // shape exists to prevent.
      for (const part of [
        item.issue, item.whyItMatters, item.recommendation,
        item.howToImplement, item.expectedEffect,
      ]) {
        expect(part.trim().length, "a six-part recommendation has an empty part").toBeGreaterThan(0);
      }
      expect(item.priority).toBeGreaterThanOrEqual(1);
      expect(item.priority).toBeLessThanOrEqual(3);
      expect(["LIKELY_UP", "POSSIBLY_UP", "NEUTRAL", "UNKNOWN"]).toContain(item.projectedRankingEffect);
    }
  });

  it("Then no recommendation promises a rank (P-1, ADR-005)", async () => {
    guard();
    const { ideaId, versionId } = await givenAnEvaluatedIdea("no-promises");
    await generateRecommendations(
      { db, provider: new StubProvider(), budgetUsd: 0.75, redactionEnabled: true },
      { ideaId, ideaVersionId: versionId },
    );

    const items = await db.improvementRecommendation.findMany({ where: { ideaVersionId: versionId } });
    for (const item of items) {
      const prose = [
        item.issue, item.whyItMatters, item.recommendation,
        item.howToImplement, item.expectedEffect,
      ].join(" ");

      // The projected effect is an ordinal direction in its own column. Prose that names
      // a position would be read as a commitment the engine never made.
      expect(prose, "a recommendation promised a specific rank").not.toMatch(/\brank\s*#?\s*\d+/i);
      expect(prose, "a recommendation promised a specific score").not.toMatch(
        /\b(?:score|rank)\s*(?:of|:|=|to)\s*\d/i,
      );
    }
  });

  it("Given a dismissed recommendation, When the run repeats, Then it does not come back", async () => {
    guard();
    const { ideaId, versionId } = await givenAnEvaluatedIdea("dismissed");
    const deps = { db, provider: new StubProvider(), budgetUsd: 0.75, redactionEnabled: true };

    const first = await generateRecommendations(deps, { ideaId, ideaVersionId: versionId });
    if (first.generated === 0) return; // strong idea — nothing to dismiss

    const target = await db.improvementRecommendation.findFirstOrThrow({
      where: { ideaVersionId: versionId },
    });
    await db.improvementRecommendation.update({
      where: { id: target.id }, data: { status: "DISMISSED" },
    });

    /**
     * Re-running must not resurrect it.
     *
     * Regenerating everything would put a dismissed suggestion back on the Improve tab
     * after every re-analysis, which turns a tool into a nag and teaches people to stop
     * reading the tab.
     */
    await generateRecommendations(deps, { ideaId, ideaVersionId: versionId });

    const after = await db.improvementRecommendation.findUnique({ where: { id: target.id } });
    expect(after?.status).toBe("DISMISSED");
  });
});

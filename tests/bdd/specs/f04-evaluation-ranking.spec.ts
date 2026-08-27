import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@iep/db";
import { StubProvider } from "@iep/ai";
import { makeIdeaRepo } from "@iep/api/src/modules/idea/repo.js";
import { runPipeline } from "@iep/worker/src/pipeline.js";
import { evaluateVersion, loadEngineConfig, recomputeRankings } from "@iep/evaluation";

/**
 * F-04 — Evaluation & ranking (SPEC §9.4), as a FLOW.
 *
 * P4 delivered `packages/scoring` with 100% branch coverage and nothing that called it.
 * These flows cover the half that was missing: analysis rows becoming a persisted
 * evaluation, and evaluations becoming an immutable ranking run.
 *
 * The engine's arithmetic is already proved by its own unit tests. What is proved here is
 * the crossing — that the right rows go in, and the right rows come out.
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
let reviewerId = "";
const createdIdeas: string[] = [];
const createdRuns: string[] = [];

/** Given an analysed idea — submitted, pipeline run, ready to evaluate. */
async function givenAnAnalysedIdea(label: string): Promise<{ ideaId: string; versionId: string }> {
  const { ideaId, versionId } = await makeIdeaRepo(db).createWithFirstVersion({
    submitterId,
    departmentId: null,
    categoryId: null,
    submit: true,
    fields: { ...BASE, title: `F-04 ${label} ${createdIdeas.length}` },
  });
  createdIdeas.push(ideaId);

  const version = await db.ideaVersion.findUniqueOrThrow({ where: { id: versionId } });
  await runPipeline(
    { db, provider: new StubProvider(), budgetPerVersionUsd: 0.75, redactionEnabled: true },
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
  const users = await db.user.findMany({ orderBy: { email: "asc" }, take: 2 });
  submitterId = users[0]?.id ?? "";
  reviewerId = users[1]?.id ?? users[0]?.id ?? "";
});

afterAll(async () => {
  if (reachable) {
    // Runs first: entries reference ideas, and the ideas are about to go.
    if (createdRuns.length > 0) await db.rankingRun.deleteMany({ where: { id: { in: createdRuns } } });
    if (createdIdeas.length > 0) await db.idea.deleteMany({ where: { id: { in: createdIdeas } } });
  }
  await db.$disconnect();
});

const guard = () => {
  if (!reachable) throw new Error("database unreachable — run `pnpm deps:up` before the BDD flows");
  if (!submitterId) throw new Error("no users in the database — run `pnpm db:seed`");
};

describe("F-04 · turning an analysis into a score", () => {
  it("Given an analysed idea, When it is evaluated, Then every active criterion is scored with evidence", async () => {
    guard();
    const { versionId } = await givenAnAnalysedIdea("scored");

    const outcome = await evaluateVersion(db, versionId);
    expect(outcome, "an analysed idea must be evaluable").not.toBeNull();

    const evaluation = await db.evaluation.findFirstOrThrow({
      where: { ideaVersionId: versionId },
      include: { criterionScores: { include: { criterion: true } } },
    });

    const activeCount = await db.evaluationCriterion.count({ where: { isActive: true } });
    expect(evaluation.criterionScores.length).toBe(activeCount);

    // P-7: no score without evidence. The DB has a CHECK for this too; the engine and
    // the bridge both have to hold it up before the CHECK ever sees the row.
    for (const score of evaluation.criterionScores) {
      expect(score.evidence.length, `${score.criterion.key} has no evidence`).toBeGreaterThan(0);
      expect(Number(score.normalized)).toBeGreaterThanOrEqual(0);
      expect(Number(score.normalized)).toBeLessThanOrEqual(100);
    }

    // The composite is the sum of contributions — the one arithmetic identity the whole
    // explainability story rests on. If it drifts, every explanation becomes a lie.
    const sum = evaluation.criterionScores.reduce((acc, s) => acc + Number(s.contribution), 0);
    expect(Number(evaluation.compositeScore)).toBeCloseTo(Math.min(100, sum), 2);
  });

  it("Then maturity is independent of the score (P-5, FR-17)", async () => {
    guard();
    const { versionId } = await givenAnAnalysedIdea("maturity");
    await evaluateVersion(db, versionId);

    const evaluation = await db.evaluation.findFirstOrThrow({ where: { ideaVersionId: versionId } });
    expect(evaluation.maturityLevel).toBeGreaterThanOrEqual(1);
    expect(evaluation.maturityLevel).toBeLessThanOrEqual(5);

    // The submission has no plan, no KPIs and no demand evidence, so it cannot be a 5 —
    // however high the model rated its value. That independence IS the requirement.
    expect(evaluation.maturityLevel).toBeLessThan(5);
  });

  it("Given evaluations exist, When rankings recompute, Then every entry has an explanation", async () => {
    guard();
    await givenAnAnalysedIdea("rank-a").then((r) => evaluateVersion(db, r.versionId));
    await givenAnAnalysedIdea("rank-b").then((r) => evaluateVersion(db, r.versionId));

    const run = await recomputeRankings(db, { triggerReason: "bdd flow" });
    expect(run, "a cohort with evaluations must produce a run").not.toBeNull();
    if (!run) return;
    createdRuns.push(run.runId);

    const entries = await db.rankingEntry.findMany({
      where: { runId: run.runId },
      include: { explanation: true },
      orderBy: { rank: "asc" },
    });

    expect(entries.length).toBeGreaterThanOrEqual(2);

    // P-2: a rank without an explanation is not a rank. The contract makes `explanation`
    // required on read, so a run that produced bare numbers would 500 rather than mislead.
    for (const entry of entries) {
      expect(entry.explanation, `rank ${entry.rank} has no explanation`).not.toBeNull();
      const strengths = entry.explanation?.strengths as unknown[];
      const constraints = entry.explanation?.constraints as unknown[];
      expect(strengths.length).toBeGreaterThan(0);
      expect(constraints.length).toBeGreaterThan(0);
      expect(entry.explanation?.generatedBy).toBe("ENGINE");
    }

    // Ranks are dense and start at 1 — a board with a gap at 3 is a bug nobody reports.
    expect(entries.map((e) => e.rank)).toEqual(entries.map((_, i) => i + 1));
  });

  it("Given a run exists, When it recomputes again, Then the old run survives untouched (ADR-008)", async () => {
    guard();
    await givenAnAnalysedIdea("immutable").then((r) => evaluateVersion(db, r.versionId));

    const first = await recomputeRankings(db, { triggerReason: "bdd first" });
    if (!first) throw new Error("no first run");
    createdRuns.push(first.runId);

    const before = await db.rankingEntry.findMany({
      where: { runId: first.runId }, orderBy: { rank: "asc" },
      select: { ideaId: true, rank: true, compositeScore: true },
    });

    const second = await recomputeRankings(db, { triggerReason: "bdd second" });
    if (!second) throw new Error("no second run");
    createdRuns.push(second.runId);

    expect(second.runId).not.toBe(first.runId);

    const after = await db.rankingEntry.findMany({
      where: { runId: first.runId }, orderBy: { rank: "asc" },
      select: { ideaId: true, rank: true, compositeScore: true },
    });
    expect(after).toEqual(before);

    // And the new run knows where everyone stood, which is what makes a delta honest.
    const newEntries = await db.rankingEntry.findMany({ where: { runId: second.runId } });
    const known = new Set(before.map((e) => e.ideaId));
    for (const entry of newEntries.filter((e) => known.has(e.ideaId))) {
      expect(entry.previousRank, "an idea in the last run must carry its previous rank").not.toBeNull();
    }
  });

  it("Given a reviewer overrode a score, When the idea is re-evaluated, Then the override survives (FR-22)", async () => {
    guard();
    const { versionId } = await givenAnAnalysedIdea("override");
    await evaluateVersion(db, versionId);

    const { criterionIdByKey } = await loadEngineConfig(db);
    const criterionId = criterionIdByKey.get("business_impact");
    if (!criterionId) throw new Error("business_impact is not in the catalogue");

    const score = await db.criterionScore.findFirstOrThrow({
      where: { evaluation: { ideaVersionId: versionId }, criterionId },
    });

    await db.scoreOverride.create({
      data: {
        criterionScoreId: score.id,
        reviewerId,
        previousNormalized: score.normalized,
        newNormalized: 91,
        reason: "Finance confirmed the rework figure — the band understates the impact.",
      },
    });
    await db.criterionScore.update({
      where: { id: score.id },
      data: { normalized: 91, source: "HUMAN", confidence: "HIGH" },
    });

    /**
     * Re-evaluating must not quietly wipe a reviewer's decision.
     *
     * This is the failure mode worth a test: the engine has no idea a human intervened,
     * so a naive "delete and recreate" would erase the override on the next analysis and
     * nobody would notice until the reviewer asked where it went.
     */
    await evaluateVersion(db, versionId);

    const after = await db.criterionScore.findFirstOrThrow({
      where: { evaluation: { ideaVersionId: versionId }, criterionId },
    });
    expect(Number(after.normalized)).toBe(91);
    expect(after.source).toBe("HUMAN");
    expect(Number(after.contribution)).toBeCloseTo(91 * Number(after.weight), 2);
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@iep/db";
import { StubProvider, stepInputHash, type AiProvider } from "@iep/ai";
import { PIPELINE_STEPS } from "@iep/contracts";
import { makeIdeaRepo } from "@iep/api/src/modules/idea/repo.js";
import { runPipeline } from "@iep/worker/src/pipeline.js";
import { evaluateVersion } from "@iep/evaluation";

/**
 * F-07 — Re-evaluation and version history (SPEC §9.7, FR-16, FR-24), as a FLOW.
 *
 * The requirement people actually feel: revise an idea, and see whether it got better.
 * That needs three things to be true, and each is asserted here — the old version keeps
 * its own score, the new one is scored independently, and re-analysing does not silently
 * re-buy work whose inputs never moved.
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
const createdIdeas: string[] = [];

const analyse = (provider: AiProvider, ideaId: string, ideaVersionId: string, contentHash: string) =>
  runPipeline(
    { db, provider, budgetPerVersionUsd: 0.75, redactionEnabled: true },
    { ideaId, ideaVersionId, contentHash },
  );

async function givenAnAnalysedIdea(label: string) {
  const { ideaId, versionId } = await makeIdeaRepo(db).createWithFirstVersion({
    submitterId, departmentId: null, categoryId: null, submit: true,
    fields: { ...BASE, title: `F-07 ${label} ${createdIdeas.length}` },
  });
  createdIdeas.push(ideaId);
  const version = await db.ideaVersion.findUniqueOrThrow({ where: { id: versionId } });
  await analyse(new StubProvider(), ideaId, versionId, version.contentHash);
  await evaluateVersion(db, versionId);
  return { ideaId, versionId, fields: { ...BASE, title: version.title } };
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
  if (reachable && createdIdeas.length > 0) {
    await db.idea.deleteMany({ where: { id: { in: createdIdeas } } });
  }
  await db.$disconnect();
});

const guard = () => {
  if (!reachable) throw new Error("database unreachable — run `pnpm deps:up` before the BDD flows");
  if (!submitterId) throw new Error("no users in the database — run `pnpm db:seed`");
};

describe("F-07 · revising an idea and seeing what changed", () => {
  it("Given a revision, Then v1 keeps its own score and v2 gets its own (FR-24)", async () => {
    guard();
    const first = await givenAnAnalysedIdea("delta");

    const v1 = await db.evaluation.findFirstOrThrow({ where: { ideaVersionId: first.versionId } });
    const v1Score = Number(v1.compositeScore);

    const { versionId: v2Id } = await makeIdeaRepo(db).createNextVersion({
      ideaId: first.ideaId,
      authorId: submitterId,
      changeSummary: "Named the OCR service and quantified the rework.",
      addressesRecommendationIds: [],
      fields: {
        ...first.fields,
        suggestedTechnology: "The document OCR service IT already licenses.",
        expectedBenefits: "About a week of finance rework recovered every month.",
      },
    });

    const v2 = await db.ideaVersion.findUniqueOrThrow({ where: { id: v2Id } });
    await analyse(new StubProvider(), first.ideaId, v2Id, v2.contentHash);
    await evaluateVersion(db, v2Id);

    /**
     * Both evaluations exist, independently.
     *
     * The failure this guards against is subtle: an upsert keyed on the IDEA rather than
     * the VERSION would overwrite v1's score, and the History tab would then show today's
     * number against every row — quietly claiming the idea was always this good.
     */
    const v1After = await db.evaluation.findFirstOrThrow({ where: { ideaVersionId: first.versionId } });
    expect(Number(v1After.compositeScore)).toBe(v1Score);

    const v2Eval = await db.evaluation.findFirst({ where: { ideaVersionId: v2Id } });
    expect(v2Eval, "the new version must be scored in its own right").not.toBeNull();
  });

  it("Given only one field changed, When re-analysed, Then untouched steps are carried forward (FR-16)", async () => {
    guard();
    const first = await givenAnAnalysedIdea("selective");

    // `estimatedCostNote` feeds EFFORT_TIMELINE and nothing else.
    const revised = { ...first.fields, estimatedCostNote: "Roughly a month of one engineer." };

    const { versionId: v2Id } = await makeIdeaRepo(db).createNextVersion({
      ideaId: first.ideaId, authorId: submitterId,
      changeSummary: "Added a cost estimate.",
      addressesRecommendationIds: [],
      fields: revised,
    });

    /**
     * A provider that throws if it is asked to do work.
     *
     * Counting cost would not prove anything against a free stub; refusing to be called
     * is the only assertion that actually says "this step was not re-run".
     */
    const calls: string[] = [];
    const watchful: AiProvider = {
      name: "stub",
      complete: (request) => {
        calls.push(request.storyKey);
        return new StubProvider().complete(request);
      },
    };

    const v2 = await db.ideaVersion.findUniqueOrThrow({ where: { id: v2Id } });
    const result = await analyse(watchful, first.ideaId, v2Id, v2.contentHash);

    // Exactly the steps whose declared inputs moved.
    const expectedToRun = PIPELINE_STEPS.filter(
      (step) => stepInputHash(step, first.fields) !== stepInputHash(step, revised),
    );
    expect(calls.sort()).toEqual([...expectedToRun].sort());
    expect(result.stepsCarriedForward).toBe(PIPELINE_STEPS.length - expectedToRun.length);
    expect(result.stepsCarriedForward, "a one-field change should reuse most steps")
      .toBeGreaterThan(0);

    // Carried-forward steps are real rows on the NEW version, not pointers at the old one.
    const rows = await db.aiAnalysis.findMany({ where: { ideaVersionId: v2Id } });
    expect(rows.length).toBe(PIPELINE_STEPS.length);
    expect(rows.every((r) => r.status === "SUCCEEDED")).toBe(true);

    // …and they cost nothing, so an idea's lifetime spend is not inflated by copies.
    const copied = rows.filter((r) => r.costUsdMicros === null);
    expect(copied.length).toBe(result.stepsCarriedForward);
  });

  it("Given the analysis fell back, Then it is NOT carried forward — the retry is the point", async () => {
    guard();
    const { ideaId, versionId } = await makeIdeaRepo(db)
      .createWithFirstVersion({
        submitterId, departmentId: null, categoryId: null, submit: true,
        fields: { ...BASE, title: `F-07 outage ${createdIdeas.length}` },
      })
      .then((r) => {
        createdIdeas.push(r.ideaId);
        return r;
      });

    const dead: AiProvider = {
      name: "stub",
      complete: async () => ({ ok: false as const, reason: { kind: "UNAVAILABLE" as const, status: 503 } }),
    };
    const v1 = await db.ideaVersion.findUniqueOrThrow({ where: { id: versionId } });
    await analyse(dead, ideaId, versionId, v1.contentHash);

    // Same content, new version — every step's inputs are identical.
    const { versionId: v2Id } = await makeIdeaRepo(db).createNextVersion({
      ideaId, authorId: submitterId,
      changeSummary: "No content change; retrying after the outage.",
      addressesRecommendationIds: [],
      fields: { ...BASE, title: v1.title },
    });

    const calls: string[] = [];
    const watchful: AiProvider = {
      name: "stub",
      complete: (request) => {
        calls.push(request.storyKey);
        return new StubProvider().complete(request);
      },
    };
    const v2 = await db.ideaVersion.findUniqueOrThrow({ where: { id: v2Id } });
    const result = await analyse(watchful, ideaId, v2Id, v2.contentHash);

    /**
     * Every step runs again despite identical inputs.
     *
     * Carrying a fallback forward would freeze an outage into the record permanently:
     * the idea would keep its degraded analysis for the rest of its life, and no revision
     * would ever recover it.
     */
    expect(calls.length).toBe(PIPELINE_STEPS.length);
    expect(result.stepsCarriedForward).toBe(0);
  });
});

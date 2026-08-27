import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@iep/db";
import { PIPELINE_STEPS } from "@iep/contracts";
import { StubProvider, type AiProvider } from "@iep/ai";
import { runPipeline } from "@iep/worker/src/pipeline.js";
import { makeIdeaRepo } from "@iep/api/src/modules/idea/repo.js";

/**
 * F-03 — Analysis pipeline & progress (SPEC §9.3), as a FLOW.
 *
 * Layer 4 (SPEC §11.4): real database, real pipeline, no browser. Every `it` below is one
 * of the acceptance criteria in §9.3, written in its own words, so a criterion cannot be
 * quietly dropped without a test going red.
 *
 * The E2E suite proves the browser renders progress. This proves the progress is true.
 *
 * Uses `StubProvider` deliberately: a flow test that spends tokens is a flow test that
 * gets skipped. Whether the ANTHROPIC path works is an eval question (§11.7), not a
 * per-PR one.
 */

const DATABASE_URL = process.env["DATABASE_URL"] ?? "postgresql://iep:iep@localhost:5433/iep";
const db = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

const FIELDS = {
  title: "BDD flow — expense receipt capture",
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

/**
 * Given an idea has been submitted.
 *
 * Through the API's OWN repo, not a hand-rolled insert: the fixture then exercises the
 * same transaction, the same content hash and the same status history the product uses.
 * A bespoke insert here would let the flow pass against a row shape production never
 * creates — which is exactly what happened on the first attempt at this file.
 */
async function givenASubmittedIdea(): Promise<{ ideaId: string; versionId: string; hash: string }> {
  const suffix = `${createdIdeas.length}`;
  const { ideaId, versionId } = await makeIdeaRepo(db).createWithFirstVersion({
    submitterId,
    departmentId: null,
    categoryId: null,
    submit: true,
    // The title varies per case so the content hash does too — otherwise case 2 would
    // be short-circuited by case 1's analysis and prove nothing.
    fields: { ...FIELDS, title: `${FIELDS.title} ${suffix}` },
  });
  createdIdeas.push(ideaId);

  const version = await db.ideaVersion.findUniqueOrThrow({ where: { id: versionId } });
  return { ideaId, versionId, hash: version.contentHash };
}

const deps = (provider: AiProvider) => ({
  db,
  provider,
  budgetPerVersionUsd: 0.75,
  redactionEnabled: true,
});

beforeAll(async () => {
  try {
    await db.$queryRaw`SELECT 1`;
    reachable = true;
  } catch {
    return;
  }
  const user = await db.user.findFirst({ orderBy: { email: "asc" } });
  submitterId = user?.id ?? "";
});

afterAll(async () => {
  if (reachable && createdIdeas.length > 0) {
    await db.idea.deleteMany({ where: { id: { in: createdIdeas } } });
  }
  await db.$disconnect();
});

const guard = () => {
  if (!reachable) {
    throw new Error("database unreachable — run `pnpm deps:up` before the BDD flows");
  }
  if (!submitterId) throw new Error("no users in the database — run `pnpm db:seed`");
};

describe("F-03 · analysing a submitted idea", () => {
  it("Given a submitted idea, When the pipeline runs, Then all six steps are recorded", async () => {
    guard();
    const { ideaId, versionId, hash } = await givenASubmittedIdea();

    const result = await runPipeline(deps(new StubProvider()), {
      ideaId, ideaVersionId: versionId, contentHash: hash,
    });

    expect(result.overall).toBe("SUCCEEDED");
    expect(result.stepsRun).toBe(PIPELINE_STEPS.length);

    const rows = await db.aiAnalysis.findMany({ where: { ideaVersionId: versionId } });
    // Every step is present, not just the ones that had something to say. The stepper is
    // determinate because this is true, not because the UI pads the list.
    expect(rows.map((r) => r.step).sort()).toEqual([...PIPELINE_STEPS].sort());
    expect(rows.every((r) => r.status === "SUCCEEDED")).toBe(true);
  });

  it("Then the analysis is complete enough to evaluate — every §9.3 artefact is present", async () => {
    guard();
    const { ideaId, versionId, hash } = await givenASubmittedIdea();
    await runPipeline(deps(new StubProvider()), { ideaId, ideaVersionId: versionId, contentHash: hash });

    const [proposal, useCases, value, feasibility, risks, plan] = await Promise.all([
      db.aiStructuredProposal.findFirst({ where: { aiAnalysis: { ideaVersionId: versionId } } }),
      db.useCase.findMany({ where: { aiAnalysis: { ideaVersionId: versionId } } }),
      db.valueFinding.findMany({ where: { aiAnalysis: { ideaVersionId: versionId } } }),
      db.feasibilityAssessment.findUnique({
        where: { ideaVersionId: versionId }, include: { findings: true },
      }),
      db.risk.findMany({ where: { ideaVersionId: versionId } }),
      db.implementationPlan.findUnique({
        where: { ideaVersionId: versionId }, include: { requirements: true, timeline: true },
      }),
    ]);

    expect(proposal, "a structured proposal").not.toBeNull();
    expect(useCases.filter((u) => u.kind === "DIRECT").length, "≥1 direct use case")
      .toBeGreaterThanOrEqual(1);
    expect(new Set(value.map((v) => v.dimension)).size, "all nine value dimensions").toBe(9);
    expect(feasibility, "a feasibility status").not.toBeNull();
    expect(feasibility?.findings.length, "per-dimension feasibility findings").toBeGreaterThan(0);
    expect(risks.length, "≥1 risk").toBeGreaterThanOrEqual(1);

    // FR-10 — a risk without a mitigation is an obstacle, not analysis.
    expect(risks.every((r) => r.mitigation.trim().length > 0)).toBe(true);

    expect(plan, "an implementation plan").not.toBeNull();
    expect(plan?.timeline.length, "five timeline phases").toBe(5);
    // FR-08 — every phase carries the caveat, so no client can render a bare commitment.
    expect(plan?.timeline.every((t) => t.isPreliminary)).toBe(true);
  });

  it("Given the same version analysed twice, When it runs again, Then it costs nothing", async () => {
    guard();
    const { ideaId, versionId, hash } = await givenASubmittedIdea();
    const input = { ideaId, ideaVersionId: versionId, contentHash: hash };

    await runPipeline(deps(new StubProvider()), input);

    /**
     * A provider that throws if it is called at all. Asserting "cost was zero" would pass
     * against a free stub even if every step re-ran; asserting the provider is never
     * TOUCHED is what idempotency actually means.
     */
    const forbidden: AiProvider = {
      // `name` is a closed union on the interface, so both fakes report as stubs. What
      // distinguishes them is the behaviour below, not the label.
      name: "stub",
      complete: () => { throw new Error("idempotency broken: the provider was called on a re-run"); },
    };

    const second = await runPipeline(deps(forbidden), input);
    expect(second.stepsRun).toBe(0);
    expect(second.totalCostUsd).toBe(0);
  });

  it("Given the provider is unreachable, When the run finishes, Then the idea is still rankable", async () => {
    guard();
    const { ideaId, versionId, hash } = await givenASubmittedIdea();

    const dead: AiProvider = {
      name: "stub",
      complete: async () => ({ ok: false as const, reason: { kind: "UNAVAILABLE" as const, status: 503 } }),
    };

    const result = await runPipeline(deps(dead), { ideaId, ideaVersionId: versionId, contentHash: hash });

    // Every step fell back, so the run FAILED — but it produced analysis, not nothing.
    expect(result.stepsFallenBack).toBe(PIPELINE_STEPS.length);
    expect(result.overall).toBe("FAILED");

    const idea = await db.idea.findUnique({ where: { id: ideaId } });
    expect(idea?.status, "a total outage needs a human, not a silent pass")
      .toBe("NEEDS_CLARIFICATION");

    // The rankable part: the factors the engine needs still exist.
    const value = await db.valueFinding.findMany({ where: { aiAnalysis: { ideaVersionId: versionId } } });
    expect(new Set(value.map((v) => v.dimension)).size).toBe(9);

    const rows = await db.aiAnalysis.findMany({ where: { ideaVersionId: versionId } });
    // The outage is on the record. A fallback that looks identical to a real analysis is
    // the failure mode this asserts against.
    expect(rows.every((r) => r.errorCode !== null)).toBe(true);
  });

  it("Then no AI-derived row ever carries a score — the engine owns every number (ADR-005)", async () => {
    guard();
    const { ideaId, versionId, hash } = await givenASubmittedIdea();
    await runPipeline(deps(new StubProvider()), { ideaId, ideaVersionId: versionId, contentHash: hash });

    const rows = await db.aiAnalysis.findMany({
      where: { ideaVersionId: versionId },
      include: { proposal: true, useCases: true, valueFindings: true },
    });

    // The payload is the model's own words. If a number ever reaches a score column it
    // will come through here first, so this is where to catch it.
    for (const row of rows) {
      const payload = JSON.stringify(row.rawPayload ?? {});
      expect(payload, `${row.step} emitted a score field`).not.toMatch(
        /"(?:score|composite|rank|weight|percentile|normalized)"\s*:/i,
      );
    }
    for (const finding of rows.flatMap((r) => r.valueFindings)) {
      // Bands are ordinal labels; a numeric band would be a score wearing a label's name.
      expect(typeof finding.band).toBe("string");
    }
  });
});

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@iep/db";
import type { DetectionProvider, EmbeddingProvider, EmbeddingResult } from "@iep/ai";
import { runDetection } from "./detection.js";

/**
 * Characterization tests for P12 detection — same real-database convention
 * `factors.test.ts` already established for this package (a mocked Prisma client would
 * hide exactly the shape mismatches this exists to catch).
 *
 * Requires `pnpm deps:up` and a seeded database (`pnpm db:seed`). Each test returns early
 * — a silent pass, not a vitest skip — if either is unavailable, checked once in
 * `beforeAll`. Every row this file writes is deleted in `afterEach`, keyed by the two
 * seeded idea ids it borrows, so a re-run never accumulates state on the shared dev DB.
 */

const DATABASE_URL = process.env["DATABASE_URL"] ?? "postgresql://iep:iep@localhost:5433/iep";
const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

let reachable = false;
let ideaA = "";
let versionA = "";
let ideaB = "";

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    reachable = true;
  } catch {
    return;
  }
  const ideas = await prisma.idea.findMany({
    where: { currentVersionId: { not: null } },
    orderBy: { createdAt: "asc" },
    take: 2,
    select: { id: true, currentVersionId: true },
  });
  if (ideas.length < 2) return;
  ideaA = ideas[0]!.id;
  versionA = ideas[0]!.currentVersionId!;
  ideaB = ideas[1]!.id;
});

afterEach(async () => {
  if (!reachable || !ideaA) return;
  await prisma.existingSolutionMatch.deleteMany({
    where: { assessment: { ideaVersionId: versionA } },
  });
  await prisma.existingSolutionAssessment.deleteMany({ where: { ideaVersionId: versionA } });
  await prisma.similarIdea.deleteMany({ where: { ideaId: ideaA } });
  // Every test embeds this version — cleared so the next test's fallback/empty-catalogue
  // assertions are not silently satisfied by a PREVIOUS test's leftover embedding.
  await prisma.$executeRaw`UPDATE idea_versions SET embedding = NULL WHERE id = ${versionA}::uuid`;
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** Always fails — exercises AI-10/AI-11's non-AI fallback path without needing a real key. */
class UnavailableEmbeddingProvider implements EmbeddingProvider {
  readonly name = "openai" as const;
  embed(): Promise<EmbeddingResult> {
    return Promise.resolve({ ok: false, errorCode: "UNAVAILABLE" });
  }
}

/** Never actually called on the fallback path — throwing proves that. */
const unreachableDetectionProvider: DetectionProvider = {
  name: "anthropic",
  summarizeDifference: () => { throw new Error("must not be called on the fallback path"); },
  recommendExistingSolution: () => { throw new Error("must not be called on the fallback path"); },
};

describe("runDetection — non-AI fallback (no embedding available)", () => {
  it("finds nothing and makes no model call when there is no title/problem overlap", async () => {
    if (!reachable || !ideaA) return;
    const result = await runDetection(
      { db: prisma, embeddingProvider: new UnavailableEmbeddingProvider(), detectionProvider: unreachableDetectionProvider },
      { ideaId: ideaA, ideaVersionId: versionA },
    );
    expect(result.embeddingSource).toBe("fallback");

    const assessment = await prisma.existingSolutionAssessment.findUnique({ where: { ideaVersionId: versionA } });
    expect(assessment?.source).toBe("FALLBACK");
    expect(assessment?.recommendation).toBeNull();
  });
});

describe("runDetection — embedding path", () => {
  it("writes an EMPTY assessment as BUILD, with high confidence, when the catalogue has no active entries", async () => {
    if (!reachable || !ideaA) return;
    const activeCatalogueCount = await prisma.existingSolution.count({ where: { isActive: true } });
    if (activeCatalogueCount > 0) return; // characterizes the empty-catalogue case only

    const result = await runDetection(
      { db: prisma, embeddingProvider: new StubProviderFixedVector(), detectionProvider: unreachableDetectionProvider },
      { ideaId: ideaA, ideaVersionId: versionA },
    );
    expect(result.embeddingSource).toBe("stub");

    const assessment = await prisma.existingSolutionAssessment.findUnique({ where: { ideaVersionId: versionA } });
    expect(assessment?.source).toBe("AI");
    expect(assessment?.recommendation).toBe("BUILD");
  });

  it("records a similar idea when two versions' embeddings are identical (similarity 1.0)", async () => {
    if (!reachable || !ideaA || !ideaB) return;

    // A fixed vector, not the real provider's output — this test characterizes the SQL
    // and persistence path, not embedding semantics (StubEmbeddingProvider's own doc
    // comment says the same: it is not meant to produce meaningful cross-text similarity).
    const fixed = new StubProviderFixedVector();
    const ideaBVersion = await prisma.idea.findUnique({ where: { id: ideaB }, select: { currentVersionId: true } });
    if (!ideaBVersion?.currentVersionId) return;

    const summarizingProvider: DetectionProvider = {
      name: "anthropic",
      summarizeDifference: () =>
        Promise.resolve({ ok: true, summary: "test summary", usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, model: "test" }),
      recommendExistingSolution: unreachableDetectionProvider.recommendExistingSolution,
    };

    // Embed B first so A's detection pass finds it as an existing, already-embedded
    // match. Uses the same permissive provider as A's own call below — B may also find A
    // as a match here if a prior test left A embedded, so this must not throw either.
    await runDetection(
      { db: prisma, embeddingProvider: fixed, detectionProvider: summarizingProvider },
      { ideaId: ideaB, ideaVersionId: ideaBVersion.currentVersionId },
    );
    try {
      const result = await runDetection(
        { db: prisma, embeddingProvider: fixed, detectionProvider: summarizingProvider },
        { ideaId: ideaA, ideaVersionId: versionA },
      );
      expect(result.similarIdeaCount).toBeGreaterThanOrEqual(1);

      const similar = await prisma.similarIdea.findMany({ where: { ideaId: ideaA } });
      const match = similar.find((s) => s.similarTo === ideaB);
      expect(match).toBeDefined();
      expect(Number(match!.similarity)).toBeCloseTo(1, 3);
      expect(match!.differenceSummary).toBe("test summary");
    } finally {
      // Clean up B's assessment/embedding too, not just A's (afterEach only targets A).
      await prisma.existingSolutionAssessment.deleteMany({ where: { ideaVersionId: ideaBVersion.currentVersionId } });
      await prisma.similarIdea.deleteMany({ where: { ideaId: ideaB } });
      await prisma.$executeRaw`UPDATE idea_versions SET embedding = NULL WHERE id = ${ideaBVersion.currentVersionId}::uuid`;
    }
  });
});

/** Same fixed unit vector on every call — deterministic identical-vector cosine similarity. */
class StubProviderFixedVector implements EmbeddingProvider {
  readonly name = "stub" as const;
  embed(): Promise<EmbeddingResult> {
    const dims = 1536;
    const vector = Array.from({ length: dims }, () => 1 / Math.sqrt(dims));
    return Promise.resolve({ ok: true, vector, usage: { tokens: 1, costUsd: 0 } });
  }
}

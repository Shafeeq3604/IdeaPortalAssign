import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@iep/db";
import { createEngine } from "@iep/scoring";
import type { EvaluationResult, RankingEntryResult } from "@iep/scoring";
import type { Band, Confidence, IdeaStatus, ScoreSource } from "@iep/contracts";
import { loadEngineConfig } from "./factors.js";

/**
 * Cohort ranking as an IMMUTABLE SNAPSHOT (ADR-008).
 *
 * A recompute never edits the last run — it writes a new one. That is what makes
 * "you were 12th on Tuesday" a checkable statement rather than a memory, and it is why
 * the rank delta on the board is a real comparison between two runs.
 *
 * No provider call happens here. Ranking is arithmetic over stored evaluations.
 */

const engine = createEngine();

/**
 * Which ideas belong in a cohort.
 *
 * A draft has not been offered for comparison, and a rejected or archived idea is no
 * longer competing. Everything else is ranked — including PARKED and BLOCKED, because
 * an idea being stuck is a fact about its progress, not about its merit.
 */
const RANKABLE: readonly IdeaStatus[] = [
  "EVALUATED", "RANKED", "UNDER_REVIEW", "NEEDS_CLARIFICATION",
  "PROTOTYPE_CANDIDATE", "PILOT", "PRODUCTION_CANDIDATE", "IMPLEMENTED",
  "PARKED", "BLOCKED",
];

export interface RecomputeInput {
  readonly profileKey?: string | undefined;
  readonly triggeredById?: string | null;
  readonly triggerReason: string;
}

export interface RecomputeResult {
  readonly runId: string;
  readonly profileKey: string;
  readonly cohortSize: number;
  readonly engineVersion: string;
}

export async function recomputeRankings(
  db: PrismaClient,
  input: RecomputeInput,
): Promise<RecomputeResult | null> {
  const { config, profileId } = await loadEngineConfig(db, input.profileKey);

  const evaluationRows = await db.evaluation.findMany({
    where: {
      profileId,
      engineVersion: config.engineVersion,
      // Only the CURRENT version of each idea competes. An old version's score is
      // history, not a second entry in the same race.
      ideaVersion: { currentOf: { status: { in: [...RANKABLE] } } },
    },
    include: {
      criterionScores: { include: { criterion: { select: { key: true } } } },
      ideaVersion: {
        select: {
          id: true,
          ideaId: true,
          idea: { select: { id: true, submittedAt: true, createdAt: true } },
          feasibility: { select: { status: true } },
        },
      },
    },
  });

  if (evaluationRows.length === 0) return null;

  const evaluations: EvaluationResult[] = evaluationRows.map((e) => ({
    ideaVersionId: e.ideaVersionId,
    profileKey: config.profile.key,
    engineVersion: e.engineVersion,
    compositeScore: Number(e.compositeScore),
    maturityLevel: e.maturityLevel as EvaluationResult["maturityLevel"],
    criterionScores: e.criterionScores.map((s) => ({
      criterionKey: s.criterion.key,
      rawBand: s.rawBand as Band | null,
      normalized: Number(s.normalized),
      weight: Number(s.weight),
      contribution: Number(s.contribution),
      source: s.source as ScoreSource,
      confidence: s.confidence as Confidence,
      rationale: s.rationale,
      evidence: s.evidence,
    })),
  }));

  const ideaIdByVersionId: Record<string, string> = {};
  const evaluationIdByVersionId: Record<string, string> = {};
  const submittedAtByIdeaId: Record<string, string> = {};
  const feasibilityByVersionId: Record<string, string> = {};

  for (const e of evaluationRows) {
    ideaIdByVersionId[e.ideaVersionId] = e.ideaVersion.ideaId;
    evaluationIdByVersionId[e.ideaVersionId] = e.id;
    // An ISO string, not a Date: the engine is clock-free and compares these as text.
    submittedAtByIdeaId[e.ideaVersion.ideaId] =
      (e.ideaVersion.idea.submittedAt ?? e.ideaVersion.idea.createdAt).toISOString();
    if (e.ideaVersion.feasibility) {
      feasibilityByVersionId[e.ideaVersionId] = e.ideaVersion.feasibility.status;
    }
  }

  /** The previous run is what makes a delta meaningful (SPEC §8.3 `settle-rank`). */
  const previousRun = await db.rankingRun.findFirst({
    where: { profileId },
    orderBy: { computedAt: "desc" },
    include: { entries: { select: { ideaId: true, rank: true } } },
  });

  const cohortKey = { profile: config.profile.key, statuses: RANKABLE, scope: "all" };

  const ranking = engine.rank(evaluations, {
    ideaIdByVersionId,
    evaluationIdByVersionId,
    submittedAtByIdeaId,
    feasibilityByVersionId: feasibilityByVersionId as Record<string, never>,
    previousRunEntries: previousRun?.entries.map((e) => ({
      ideaId: e.ideaId, evaluationId: "", rank: e.rank,
      compositeScore: 0, percentile: 0, previousRank: null, tieBreakApplied: null,
    })),
    cohortKey,
  });

  const evaluationByVersionId = new Map(evaluations.map((e) => [e.ideaVersionId, e]));
  const versionIdByEvaluationId = new Map(evaluationRows.map((e) => [e.id, e.ideaVersionId]));

  const withEvaluation = (entry: RankingEntryResult) => {
    const versionId = versionIdByEvaluationId.get(entry.evaluationId);
    const evaluation = versionId ? evaluationByVersionId.get(versionId) : undefined;
    return evaluation ? { entry, evaluation } : null;
  };

  const pairs = ranking.entries.map(withEvaluation).filter((p): p is NonNullable<typeof p> => p !== null);

  const run = await db.$transaction(
    async (tx) => {
      const created = await tx.rankingRun.create({
        data: {
          profileId,
          cohortKey,
          engineVersion: config.engineVersion,
          triggeredById: input.triggeredById ?? null,
          triggerReason: input.triggerReason,
        },
      });

      /**
       * Bulk writes, not a create() per row (SPEC §11.6: 3,000 ideas <= 30s).
       *
       * This used to await one rankingEntry.create() and one rankingExplanation.create()
       * per pair, inside this same transaction — 6,000+ sequential round trips at cohort
       * scale. That blew past Prisma's 5s interactive-transaction default long before
       * finishing, and the recompute failed outright ("Transaction not found"), not
       * merely slowly.
       *
       * `engine.explain()` is pure computation over data already in memory (P-2: still
       * written in the same transaction as its rank, just not one row at a time), so
       * every row is built here before a single write happens, then sent as two
       * statements. IDs are generated client-side because createMany does not return the
       * rows it inserted — there is no id to read back for the explanation to point at.
       */
      // Built together, keyed by the same generated id, rather than two separate `.map`s
      // cross-referenced by index — `noUncheckedIndexedAccess` would make that index into
      // entryData a possibly-undefined read for no reason; the pairing is 1:1 by construction.
      const rows = pairs.map(({ entry, evaluation }) => {
        const entryId = randomUUID();
        const peers = nearestPeers(pairs, entry);
        const explanation = engine.explain(entry, evaluation, peers, config);
        return {
          entry: {
            id: entryId,
            runId: created.id,
            ideaId: entry.ideaId,
            evaluationId: entry.evaluationId,
            rank: entry.rank,
            compositeScore: entry.compositeScore,
            percentile: entry.percentile,
            previousRank: entry.previousRank,
          },
          explanation: {
            id: randomUUID(),
            entryId,
            strengths: explanation.strengths as never,
            constraints: explanation.constraints as never,
            peerComparisons: explanation.peerComparisons as never,
            // ADR-006: derived from the contribution vector. AI narrative is P5's optional
            // AI-09 layer on top and would change this to ENGINE_PLUS_AI_NARRATIVE.
            generatedBy: "ENGINE" as const,
          },
        };
      });

      const entryData = rows.map((r) => r.entry);
      const explanationData = rows.map((r) => r.explanation);

      await tx.rankingEntry.createMany({ data: entryData });
      await tx.rankingExplanation.createMany({ data: explanationData });

      // Reaching a board is a lifecycle event (FR-16). Ideas already further along keep
      // their status — being ranked does not un-pilot a pilot.
      await tx.idea.updateMany({
        where: { id: { in: pairs.map((p) => p.entry.ideaId) }, status: "EVALUATED" },
        data: { status: "RANKED" },
      });

      return created;
    },
    // A generous ceiling above the expected real duration, not a target — the fix here is
    // fewer round trips (createMany), and this is defense-in-depth on top of that.
    { timeout: 60_000 },
  );

  return {
    runId: run.id,
    profileKey: config.profile.key,
    cohortSize: pairs.length,
    engineVersion: config.engineVersion,
  };
}

/**
 * The two ideas either side of this one.
 *
 * A comparison against the field's extremes tells you nothing actionable; the ideas you
 * are actually competing with are your neighbours (SPEC §9.4).
 */
function nearestPeers<T extends { entry: RankingEntryResult }>(
  all: readonly T[],
  entry: RankingEntryResult,
): T[] {
  const index = all.findIndex((p) => p.entry.ideaId === entry.ideaId);
  if (index < 0) return [];
  return [all[index - 1], all[index + 1]].filter((p): p is T => p !== undefined);
}

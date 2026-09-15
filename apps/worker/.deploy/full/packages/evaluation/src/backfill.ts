import type { PrismaClient } from "@iep/db";
import { evaluateVersion } from "./evaluate.js";

/**
 * Self-heal ideas whose analysis finished but never produced an `Evaluation` row.
 *
 * This gap is real, not hypothetical: `runPipeline` (apps/worker) commits the idea's
 * status the moment its six AI steps finish, then calls `evaluateVersion` in a second,
 * separate step — and until CONTRACT-LOG's 2026-09-11 `seedEvaluationConfig` fix, an
 * environment with no `EvaluationProfile` seeded yet made that second step throw
 * `loadEngineConfig`'s "no default evaluation profile" error. The idea was left showing
 * EVALUATED (or later, since a later lifecycle move never demotes it) with no Evaluation
 * underneath — invisible to `recomputeRankings`, which only ever reads from `evaluation`
 * rows, forever, since nothing re-queues an idea whose analysis job already "succeeded".
 *
 * `evaluateVersion` is pure computation over already-persisted analysis data — no AI
 * provider call, no cost — so re-running it here for exactly the ideas missing a row is
 * cheap, safe to repeat on every boot (an idea already evaluated is not a candidate), and
 * self-heals any future recurrence of the same gap rather than leaving it to be noticed
 * and fixed by hand again.
 */

/** Every status an idea reaches only after a completed analysis run (mirrors ranking.ts's
 * `RANKABLE`, plus REJECTED — a rejected idea's history should still show a real score). */
const POST_ANALYSIS_STATUSES = [
  "EVALUATED", "RANKED", "UNDER_REVIEW", "NEEDS_CLARIFICATION",
  "PROTOTYPE_CANDIDATE", "PILOT", "PRODUCTION_CANDIDATE", "IMPLEMENTED",
  "PARKED", "BLOCKED", "REJECTED",
] as const;

export async function backfillMissingEvaluations(db: PrismaClient): Promise<number> {
  const candidates = await db.idea.findMany({
    where: {
      status: { in: [...POST_ANALYSIS_STATUSES] },
      currentVersionId: { not: null },
      currentVersion: { evaluations: { none: {} } },
    },
    select: { id: true, currentVersionId: true },
  });

  let fixed = 0;
  for (const idea of candidates) {
    // Guaranteed non-null by the `currentVersionId: { not: null }` filter above, but the
    // query's return type does not encode that.
    if (!idea.currentVersionId) continue;
    const outcome = await evaluateVersion(db, idea.currentVersionId);
    if (outcome) fixed += 1;
  }
  return fixed;
}

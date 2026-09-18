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

/** Ideas evaluated per batch. Bounds how many connections this boot-time self-heal holds
 * open at once — not a SPEC number, just a concurrency knob, same kind as the workers'
 * own `concurrency: N` (apps/worker/src/main.ts). */
const BATCH_SIZE = 10;

export async function backfillMissingEvaluations(db: PrismaClient): Promise<number> {
  const candidates = await db.idea.findMany({
    where: {
      status: { in: [...POST_ANALYSIS_STATUSES] },
      currentVersionId: { not: null },
      currentVersion: { evaluations: { none: {} } },
    },
    select: { id: true, currentVersionId: true },
  });

  // Guaranteed non-null by the `currentVersionId: { not: null }` filter above, but the
  // query's return type does not encode that.
  const versionIds = candidates
    .map((idea) => idea.currentVersionId)
    .filter((id): id is string => id !== null);

  /**
   * Batched, not fully sequential and not fully unbounded.
   *
   * `evaluateVersion` is pure computation over already-persisted analysis data — no AI
   * provider call, no cost (see the file header) — so there is no rate limit or spend to
   * throttle for. A real backlog at boot used to run one at a time here, each round trip
   * waiting on the last for no reason. `BATCH_SIZE` keeps this from opening one connection
   * per candidate at once on a very large backlog.
   */
  let fixed = 0;
  for (let i = 0; i < versionIds.length; i += BATCH_SIZE) {
    const batch = versionIds.slice(i, i + BATCH_SIZE);
    const outcomes = await Promise.all(batch.map((versionId) => evaluateVersion(db, versionId)));
    fixed += outcomes.filter(Boolean).length;
  }
  return fixed;
}

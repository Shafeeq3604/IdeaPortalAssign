import { Queue } from "bullmq";
import IORedis from "ioredis";

/**
 * The analysis queue (ADR-007).
 *
 * One job per idea VERSION, not per step. The steps run in order inside the job because
 * later ones consume earlier output (use cases feed reach, the contribution vector feeds
 * improvement) — six independent jobs would need a coordinator to reassemble them.
 */
export const ANALYSIS_QUEUE = "iep.analysis";

export interface AnalysisJob {
  readonly ideaId: string;
  readonly ideaVersionId: string;
  /** Content hash: a re-queued identical version is skipped without spending tokens. */
  readonly contentHash: string;
}

/**
 * Hands the whole URL to ioredis rather than reconstructing {host, port, password} by
 * hand — the hand-built version silently dropped a `username`, which Azure Cache for
 * Redis's ACL-style auth can require, leaving the connection to hang forever with no
 * error (BullMQ's `maxRetriesPerRequest: null` below means it never throws, just retries
 * quietly). ioredis's own URL parsing is also what the API's session store connection
 * already uses successfully against the same REDIS_URL — this makes every Redis client in
 * the codebase parse it the same way.
 */
export function connectionFrom(redisUrl: string): IORedis {
  return new IORedis(redisUrl, {
    // BullMQ requires this to be null: it manages its own retry behaviour, and any
    // other value makes commands throw instead of queueing. Setting it to 1 silently
    // stopped every job from being added.
    maxRetriesPerRequest: null,
    // NOT lazyConnect: BullMQ expects a client handed to `connection` to already be
    // connecting on its own — it never calls `.connect()` for you. A lazy client just
    // sits idle forever, and BullMQ's own readiness wait hangs with it.
  });
}

export function makeAnalysisQueue(redisUrl: string): Queue<AnalysisJob> {
  return new Queue<AnalysisJob>(ANALYSIS_QUEUE, {
    connection: connectionFrom(redisUrl),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 2_000 },
      removeOnComplete: { age: 3600, count: 500 },
      removeOnFail: { age: 86_400 },
    },
  });
}

/**
 * The ranking queue (P4's recompute trigger).
 *
 * Separate from analysis and run at concurrency 1, because a ranking run is a snapshot of
 * the WHOLE cohort (ADR-008): two overlapping recomputes would write two runs from the
 * same evaluations and race over which one the board reads as current.
 */
export const RANKING_QUEUE = "iep.ranking";

export interface RankingJob {
  readonly profileKey?: string | undefined;
  readonly triggeredById?: string | null;
  /** Why this run exists. Stored on the run and shown on the board (FR-13). */
  readonly triggerReason: string;
}

export function makeRankingQueue(redisUrl: string): Queue<RankingJob> {
  return new Queue<RankingJob>(RANKING_QUEUE, {
    connection: connectionFrom(redisUrl),
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "exponential", delay: 2_000 },
      removeOnComplete: { age: 3600, count: 200 },
      removeOnFail: { age: 86_400 },
    },
  });
}

/**
 * The discovery queue (SPC-001).
 *
 * One job per query, single-pass (SPC-10 — one model call does intent, filtering,
 * ranking and synthesis together; there is no per-step coordination to do). No retry
 * on failure by default: a failed discovery query is cheap for the user to resubmit,
 * and a silent automatic retry would spend model cost the user never asked for twice.
 */
export const DISCOVERY_QUEUE = "iep.discovery";

export interface DiscoveryJob {
  readonly discoveryQueryId: string;
}

import { Queue, type ConnectionOptions } from "bullmq";

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

export function connectionFrom(redisUrl: string): ConnectionOptions {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    ...(url.password ? { password: url.password } : {}),
    // `rediss:` (Azure Cache for Redis and most managed providers) refuses a plain
    // connection on its TLS port — without this the client hangs or is rejected, and
    // nothing about the REDIS_URL string itself would have said why.
    ...(url.protocol === "rediss:" ? { tls: {} } : {}),
  };
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

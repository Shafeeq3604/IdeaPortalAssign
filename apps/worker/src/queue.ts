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

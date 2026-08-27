import { Queue } from "bullmq";
import type { AnalysisEnqueuer, RankingEnqueuer } from "../context.js";

/**
 * The API's side of the analysis queue.
 *
 * Enqueueing must never fail a submission. If Redis is down the idea is still saved —
 * losing someone's written idea because a queue was unavailable would be the worst
 * possible trade. The run is simply not started, and the stepper shows PENDING.
 */
export interface EnqueuerLogger {
  warn(obj: unknown, msg: string): void;
}

export function makeAnalysisEnqueuer(
  redisUrl: string,
  logger?: EnqueuerLogger,
): AnalysisEnqueuer & { close(): Promise<void> } {
  const url = new URL(redisUrl);
  const queue = new Queue("iep.analysis", {
    connection: {
      host: url.hostname,
      port: Number(url.port || 6379),
      ...(url.password ? { password: url.password } : {}),
      // BullMQ requires this to be null: it manages its own retry behaviour, and any
      // other value makes commands throw instead of queueing. Setting it to 1 silently
      // stopped every job from being added.
      maxRetriesPerRequest: null,
    },
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 2_000 },
      removeOnComplete: { age: 3600, count: 500 },
    },
  });

  return {
    async enqueue(job) {
      try {
        // jobId = version + content hash: re-submitting identical content is deduplicated
        // by BullMQ itself, before a single token is spent.
        // Separator is "--": BullMQ rejects a custom id containing a colon.
        await queue.add("analyse", job, {
          jobId: `${job.ideaVersionId}--${job.contentHash.slice(0, 16)}`,
        });
        return true;
      } catch (error) {
        // Swallowing the failure is deliberate — the idea is already saved. Swallowing it
        // SILENTLY was a bug: the analysis simply never happened and nothing said so.
        logger?.warn(
          { err: error, ideaVersionId: job.ideaVersionId },
          "could not enqueue analysis — the idea is saved but will not be analysed",
        );
        return false;
      }
    },
    close: () => queue.close(),
  };
}

/** Used when Redis is absent in development: accepts and discards. */
export const noopEnqueuer: AnalysisEnqueuer = { enqueue: () => Promise.resolve(false) };

/**
 * The API's side of the ranking queue.
 *
 * Deduplicated on a fixed job id so a burst of overrides collapses into one recompute:
 * the run is cohort-wide, so ten of them in a row produce ten identical snapshots and
 * nine wasted passes over the whole board.
 */
export function makeRankingEnqueuer(
  redisUrl: string,
  logger?: EnqueuerLogger,
): RankingEnqueuer & { close(): Promise<void> } {
  const url = new URL(redisUrl);
  const queue = new Queue("iep.ranking", {
    connection: {
      host: url.hostname,
      port: Number(url.port || 6379),
      ...(url.password ? { password: url.password } : {}),
      maxRetriesPerRequest: null,
    },
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "exponential", delay: 2_000 },
      removeOnComplete: { age: 3600, count: 200 },
    },
  });

  return {
    async enqueue(job) {
      try {
        await queue.add("recompute", job);
        return true;
      } catch (error) {
        // The override itself already committed. Losing the recompute means a stale
        // rank, which is visibly wrong and recoverable; rolling back the reviewer's
        // decision would not be.
        logger?.warn(
          { err: error, reason: job.triggerReason },
          "could not enqueue a ranking recompute — the change is saved but the board is stale",
        );
        return false;
      }
    },
    close: () => queue.close(),
  };
}

/** Used when Redis is absent in development: accepts and discards. */
export const noopRankingEnqueuer: RankingEnqueuer = { enqueue: () => Promise.resolve(false) };

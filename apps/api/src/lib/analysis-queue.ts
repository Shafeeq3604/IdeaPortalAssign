import { Queue } from "bullmq";
import type { AnalysisEnqueuer } from "../context.js";

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

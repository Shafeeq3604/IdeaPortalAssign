import { Queue } from "bullmq";
import type { IdeaCreationEnqueuer } from "../context.js";
import type { EnqueuerLogger } from "./analysis-queue.js";
import { captureException } from "./error-tracking.js";
import { makeQueueConnection, withEnqueueTimeout } from "./redis-connection.js";

/**
 * The API's side of the idea-creation queue (platform-transformation brief §7).
 *
 * Same shape as `makeDiscoveryEnqueuer` — queue name duplicated as a literal (apps/api
 * and apps/worker are separate deployables) and the same degrade-never-throw contract:
 * if Redis is down the message is still saved, just not answered until it comes back.
 */
export function makeIdeaCreationEnqueuer(
  redisUrl: string,
  logger?: EnqueuerLogger,
): IdeaCreationEnqueuer & { close(): Promise<void> } {
  // Captured so `close()` below can `quit()` it — BullMQ does not close an externally
  // supplied connection on `Queue.close()`, so without this it leaks on every shutdown.
  const connection = makeQueueConnection(redisUrl);
  const queue = new Queue("iep.idea-creation", {
    connection,
    defaultJobOptions: {
      attempts: 1, // a failed turn is cheap to retry by sending the message again
      removeOnComplete: { age: 3600, count: 500 },
      // Without this, every failing turn (attempts: 1, so every failure) accumulates a
      // job hash — including its full payload — in Redis forever.
      removeOnFail: { age: 86_400 },
    },
  });

  return {
    async enqueue(job) {
      try {
        // One job per user message, not per enqueue call — see the comment on
        // `IdeaCreationEnqueuer` (context.ts). Mirrors `analysis-queue.ts`'s
        // `versionId--contentHash` and `discovery-queue.ts`'s `discoveryQueryId`.
        await withEnqueueTimeout(
          queue.add("turn", job, { jobId: `${job.conversationId}--${job.messageId}` }),
        );
        return true;
      } catch (error) {
        logger?.warn(
          { err: error, conversationId: job.conversationId },
          "could not enqueue idea-creation turn — the message is saved but will not be answered yet",
        );
        captureException(error, { tags: { kind: "enqueue-failed", queue: "idea-creation" } });
        return false;
      }
    },
    close: async () => {
      await queue.close();
      await connection.quit();
    },
  };
}

/** Used when Redis is absent in development: accepts and discards. */
export const noopIdeaCreationEnqueuer: IdeaCreationEnqueuer = {
  enqueue: () => Promise.resolve(false),
};

import { Queue } from "bullmq";
import type { DiscoveryEnqueuer } from "../context.js";
import type { EnqueuerLogger } from "./analysis-queue.js";

/**
 * The API's side of the discovery queue (SPC-001).
 *
 * Same shape as `makeAnalysisEnqueuer` (queue name duplicated as a literal rather than
 * imported from apps/worker — apps/api and apps/worker are separate deployables, the
 * same reason `iep.analysis` is duplicated there too) and the same degrade-never-throw
 * contract: if Redis is down the query row is still saved, just never processed. The
 * route handler that calls this already tells the user their query is PENDING, which
 * is honest either way.
 */
export function makeDiscoveryEnqueuer(
  redisUrl: string,
  logger?: EnqueuerLogger,
): DiscoveryEnqueuer & { close(): Promise<void> } {
  const url = new URL(redisUrl);
  const queue = new Queue("iep.discovery", {
    connection: {
      host: url.hostname,
      port: Number(url.port || 6379),
      ...(url.password ? { password: url.password } : {}),
      ...(url.protocol === "rediss:" ? { tls: {} } : {}),
      maxRetriesPerRequest: null,
    },
    defaultJobOptions: {
      attempts: 1, // SPC-8: no automatic retry — a failed query is cheap to resubmit by hand
      removeOnComplete: { age: 3600, count: 500 },
    },
  });

  return {
    async enqueue(job) {
      try {
        // One job per row: a duplicate call for the same query id collapses rather than
        // spending model cost twice.
        await queue.add("discover", job, { jobId: job.discoveryQueryId });
        return true;
      } catch (error) {
        logger?.warn(
          { err: error, discoveryQueryId: job.discoveryQueryId },
          "could not enqueue discovery query — it is saved but will not be processed",
        );
        return false;
      }
    },
    close: () => queue.close(),
  };
}

/** Used when Redis is absent in development: accepts and discards. */
export const noopDiscoveryEnqueuer: DiscoveryEnqueuer = { enqueue: () => Promise.resolve(false) };

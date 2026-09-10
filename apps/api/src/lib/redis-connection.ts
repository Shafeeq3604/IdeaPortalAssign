import IORedis from "ioredis";

/**
 * Hands the whole URL to ioredis rather than reconstructing {host, port, password} by
 * hand — the hand-built version (formerly duplicated across this file's callers) silently
 * dropped a `username`, which Azure Cache for Redis's ACL-style auth can require, leaving
 * the connection to hang forever with no error (BullMQ's `maxRetriesPerRequest: null`
 * means it never throws, just retries quietly). ioredis's own URL parsing is also what
 * `main.ts`'s session-store connection already uses successfully against the same
 * REDIS_URL — this makes every Redis client in the API parse it the same way.
 */
export function makeQueueConnection(redisUrl: string): IORedis {
  return new IORedis(redisUrl, {
    // BullMQ requires this to be null: it manages its own retry behaviour, and any
    // other value makes commands throw instead of queueing. Setting it to 1 silently
    // stopped every job from being added.
    maxRetriesPerRequest: null,
    // NOT lazyConnect: BullMQ expects a client handed to `connection` to already be
    // connecting on its own — it never calls `.connect()` for you. A lazy client just
    // sits idle forever, and BullMQ's own readiness wait hangs with it (this took down
    // the whole API at startup during testing, not just the queue).
  });
}

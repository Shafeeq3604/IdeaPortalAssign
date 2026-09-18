import * as Sentry from "@sentry/node";
import type { WorkerEnv } from "@iep/contracts/env";

/**
 * Error tracking (Sentry — ADR-025). Same opt-in, degrade-to-no-op shape as this app's
 * own iManner observability client (observability.ts) and the API's twin of this module
 * (apps/api/src/lib/error-tracking.ts) — `SENTRY_DSN` unset means nothing is reported and
 * every `captureException` call below is inert.
 *
 * This is the ONE process that holds the Anthropic key and reads raw idea text (SPEC
 * §4.4) — the highest-stakes place in the product to get PII handling wrong. `job.data`
 * (idea/version ids, discovery query ids) is never attached wholesale; only the specific,
 * already-opaque ids this file names explicitly ever reach a tag.
 */

let enabled = false;

export function initErrorTracking(env: WorkerEnv): void {
  if (!env.SENTRY_DSN) return;

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
    sendDefaultPii: false,
    // See the identical comment in apps/api/src/lib/error-tracking.ts — this is the
    // tag that tells the two processes' events apart if they share one DSN.
    initialScope: { tags: { service: "worker" } },
  });
  enabled = true;
}

export function captureException(error: unknown, tags?: Record<string, string>): void {
  if (!enabled) return;
  Sentry.withScope((scope) => {
    if (tags) for (const [key, value] of Object.entries(tags)) scope.setTag(key, value);
    Sentry.captureException(error);
  });
}

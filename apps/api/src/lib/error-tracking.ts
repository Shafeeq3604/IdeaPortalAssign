import * as Sentry from "@sentry/node";
import type { ApiEnv } from "@iep/contracts/env";

/**
 * Error tracking (Sentry — ADR-025). Opt-in, same degrade-to-no-op shape the worker's
 * iManner observability client already uses (apps/worker/src/observability.ts):
 * `SENTRY_DSN` unset means `init` never runs and every `captureException` call below is
 * inert, so a missing or wrong DSN can never take the API down.
 *
 * PII (SPEC §4.4's own standard, extended here): this product already tells every user
 * that their name and email are not sent to the AI provider — the same rule applies to
 * this second third party. `sendDefaultPii` stays off, `beforeSend` strips the same
 * headers the Fastify logger already redacts (server.ts), and nothing here ever attaches
 * a request body or an email/display name — `captureException`'s `userId` is an opaque
 * id, the same value every route handler already uses to refer to an actor.
 */

let enabled = false;

export function initErrorTracking(env: ApiEnv): void {
  if (!env.SENTRY_DSN) return;

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
    sendDefaultPii: false,
    // The api and worker are two separate deployables that may well share one DSN/project
    // (they are two Node processes, not two Sentry setups to maintain) — this tag is what
    // tells them apart on the Sentry side once an event arrives.
    initialScope: { tags: { service: "api" } },
    beforeSend(event) {
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        if (event.request.headers) {
          delete event.request.headers["authorization"];
          delete event.request.headers["cookie"];
          delete event.request.headers["set-cookie"];
        }
      }
      return event;
    },
  });
  enabled = true;
}

export function captureException(
  error: unknown,
  context?: {
    readonly requestId?: string;
    /** An opaque user id ONLY — never an email or a display name. */
    readonly userId?: string;
    readonly tags?: Record<string, string>;
  },
): void {
  if (!enabled) return;
  Sentry.withScope((scope) => {
    if (context?.requestId) scope.setTag("requestId", context.requestId);
    if (context?.userId) scope.setUser({ id: context.userId });
    if (context?.tags) {
      for (const [key, value] of Object.entries(context.tags)) scope.setTag(key, value);
    }
    Sentry.captureException(error);
  });
}

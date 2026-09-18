import * as Sentry from "@sentry/react";

/**
 * Error tracking (Sentry — ADR-025). Same opt-in, degrade-to-no-op shape as the API's
 * and worker's twins of this module: `VITE_SENTRY_DSN` unset means `init` never runs and
 * `captureException` below is inert, so a missing DSN never breaks the app.
 *
 * Vite inlines `import.meta.env.VITE_*` at build time — there is no server to ask, so
 * unlike the API/worker this cannot "refuse to start" on a bad value; an invalid DSN
 * simply leaves reporting off, which `Sentry.init` already does safely on its own.
 *
 * PII: `sendDefaultPii` stays off. Nothing here ever calls `Sentry.setUser` with an email
 * or display name — the API's own error-tracking module is where a signed-in user's
 * OPAQUE id gets attached (server-side errors), matching the same "your name and email
 * are not sent" rule this product already states for the AI provider.
 */

let enabled = false;

export function initErrorTracking(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });
  enabled = true;
}

export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (!enabled) return;
  Sentry.captureException(error, context ? { extra: context } : undefined);
}

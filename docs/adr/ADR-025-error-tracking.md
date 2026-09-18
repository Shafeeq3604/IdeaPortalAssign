# ADR-025 — Error tracking / APM (Sentry), opt-in on all three processes

- **Status:** Accepted
- **Date:** 2026-09-18
- **Amends:** Nothing. New capability.
- **Requirements:** SPEC §4.4 (PII/secret handling), extended here to a second third party.

## Context

A design-review pass across the whole product turned up a real gap that had nothing to
do with the UI it was checking: apps/api, apps/worker and apps/web all had places where an
error is caught and only `console.error`'d or `logger.warn`'d — the BullMQ workers'
`on("failed")` handlers, the API's own enqueue-failure paths, the React route error
boundary. None of it reaches anyone until a person goes looking for it in raw logs after
the fact. For three processes that between them hold the only copy of the Anthropic key,
run the ranking engine, and are the one thing standing between a submitted idea and it
being silently lost, "nobody finds out until someone complains" is not an acceptable
failure mode for a product claiming to be enterprise-production-ready.

This is also the first time this product sends operational data to a THIRD PARTY that is
not the AI provider — which matters, because the product already makes an explicit,
user-facing promise about that: "your idea text is analysed by an AI service; your name
and email are not sent with it" (the submission form's own AI notice). Wiring in an
error-tracking SaaS without applying that same discipline would quietly break a promise
the UI is still making.

## Decision

**Sentry, one SDK per process, all three opt-in and defaulting to fully off.**

`SENTRY_DSN` joins the shared `Base` env schema (`packages/contracts/src/env.ts`) that
both `ApiEnv` and `WorkerEnv` extend, and `apps/web` reads its own `VITE_SENTRY_DSN` at
build time. Every one of the three follows the exact shape the worker's existing iManner
observability client already established (`apps/worker/src/observability.ts`): unset means
`Sentry.init` never runs, and `captureException` is then a checked no-op, not a call that
throws or blocks. A missing or malformed DSN can never take a process down — this is
"REFUSES TO START on a missing secret" territory for nothing here, deliberately, unlike
almost everything else `env.ts` validates.

**Explicit call sites, not framework auto-instrumentation.** `observability.ts`'s own
comment already states this project's house rule for third-party reporting — "No
dependency, no `auto_patch` — every call site is instrumented explicitly, once each" — and
this follows it rather than reaching for Sentry's Fastify auto-error-handler plugin. The
API's existing `setErrorHandler` (server.ts) already has the business logic for telling a
dependency outage from a genuine bug; `captureException` is called directly from inside
it, at the two branches that matter, rather than layering a second, competing error
handler on top.

**PII discipline, matching the AI-provider rule exactly:**

- `sendDefaultPii: false` on every SDK, everywhere.
- Nothing ever calls `Sentry.setUser()` with an email or a display name — only the
  same opaque `userId` every route handler already uses to refer to an actor.
- The API's `beforeSend` strips `request.cookies`, `request.data`, and the same three
  headers (`authorization`, `cookie`, `set-cookie`) the Fastify logger's own `redact`
  list already keeps out of the logs (server.ts) — one rule, enforced twice, not two
  different ideas of what counts as sensitive.
- The worker never attaches `job.data` wholesale — only the specific ids (idea id,
  version id, discovery query id) that are already opaque, already logged today, and
  never PII on their own.

**One default tag, `service: "api"` / `"worker"`, applied at `init` time.** The api and
worker may reasonably share one Sentry DSN/project — they are two Node processes, not two
separate things to administer — and this is the one field that tells their events apart
once they land in the same project.

**Traces sample rate defaults to `0`.** This closes the "no error tracking" gap
specifically. Performance tracing is a genuinely separate decision (cost, data volume,
what counts as a meaningful transaction) that nobody has made yet — `SENTRY_TRACES_SAMPLE_RATE`
exists as a knob for whoever does make it, not turned on by default under this ADR.

## Options considered

**A. A self-hosted, Sentry-API-compatible backend (e.g. GlitchTip).**
Removes the third-party data-residency question entirely — error events never leave
infrastructure this organisation already controls. Rejected for now only because it is an
operational commitment (another service to run, patch, and back up) that nobody has
signed up for yet; the code above talks to any Sentry-compatible ingestion endpoint via
the same `dsn`, so switching to a self-hosted instance later is a config change, not a
rewrite.

**B. A provider-agnostic reporting interface, wired to a no-op by default, vendor picked
later.**
This is what got built for iManner observability (`ObservabilityClient`), and it was the
right call there because iManner's own HTTP contract had to be hand-rolled anyway (no
Node SDK exists for it — see observability.ts). Sentry ships a real, well-maintained SDK
for exactly this job; wrapping it behind a second abstraction here would be inventing an
interface this codebase does not otherwise need, for a vendor that was actually chosen.

**C. Sentry's Fastify/React auto-instrumentation, wired in wholesale.**
Rejected — see "explicit call sites" above. It would also make `sendDefaultPii`/`beforeSend`
harder to reason about, since auto-instrumentation captures request/response shape by
default in ways this product's own PII rule has to actively fight rather than simply
not opt into.

## Consequences

**Good**

- The three highest-value, currently-silent failure points (BullMQ `on("failed")`, the
  API's enqueue-failure paths, the React route boundary) now report somewhere a person
  can actually see them, without any of the three processes' behaviour changing when
  nothing is configured.
- The PII rule is enforced at the SAME two points (redacted headers, opaque-id-only user
  context) the codebase already uses for its logs, not a new policy invented for this.
- Turning it on in any environment is a one-line env var, not a deploy.

**Bad, and accepted**

- **Nothing is configured yet.** This ADR wires the capability in; it does not create a
  Sentry account, choose an org, or set a real DSN anywhere. Every environment stays
  exactly as blind as before until someone with a Sentry account does that.
- **No performance tracing.** `tracesSampleRate` defaults to `0` on purpose (see above) —
  this closes the error-visibility gap, not the "do we have APM" question in full.
- **The worker's `job.failed` handler still logs the job's queue and id, not the idea's
  own submitter** — deliberately, since attaching a user id to a queue-level failure (as
  opposed to a request-scoped one the API can name an actor for) was judged not worth the
  extra plumbing for this pass. A worker failure is investigated by job id today; that is
  unchanged.

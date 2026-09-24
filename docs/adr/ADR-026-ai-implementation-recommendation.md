# ADR-026 — AI Implementation Recommendation (advisory only; P-3 boundary re-affirmed, not lifted)

- **Status:** Accepted
- **Date:** 2026-09-22
- **Amends:** Extends SPEC §2 P-3 ("Human-in-the-loop. AI never decides.") with a new,
  explicitly-scoped AI output. Does **not** supersede P-3's control — see "What P-3 still
  guarantees" below. Also touches P-1 (no verdict language), P-2 (explainability), P-5
  (composite score independence), ADR-005 (no score/rank/weight from the model), ADR-011
  (`AiProvider` interface, unchanged), and A3 (data sent to the provider).
- **Requirements:** Product direction ("Option B") — the AI must produce a structured,
  explainable Implementation Recommendation as part of strategic analysis, consumed by a
  separate human Leadership Decision step. Recorded here per SPEC's own escalation rule
  ("implementing something would violate a Product Principle... an ADR would have to
  change to proceed — stop and ask, then write the ADR before the code").

## Context

SPEC §2 states P-3 as: *"Human-in-the-loop. AI never decides."* enforced today as: **AI
writes only to `ai_*` tables. Status beyond `EVALUATED` and every decision field require an
authenticated human actor. Service guard + test.** (`tests/arch/architecture.test.ts`,
`apps/api/src/modules/analysis.routes.ts` header comment "writing is the worker's job",
`packages/contracts/src/lifecycle.ts`'s role-gated `TRANSITIONS` table.)

Until now, "AI never decides" has been read narrowly as "AI never scores" (ADR-005) plus
"AI never changes status" (P-3's own enforcement). The product now wants the AI to go
further than analysis findings and produce an actual **build-or-don't-build
recommendation** — which reads, in plain language, like a decision. Product direction
("Option B") is that this is wanted, provided it stays advisory: content for a human to
read, weigh, and act on, never a system action.

This ADR exists so that widening what the AI is allowed to *say* is written down
deliberately, with the boundary of what it still cannot *do* restated explicitly next to
it — exactly the failure mode A3's own text warns about ("we asked and they said yes is
not a control... if the scope quietly widens later, it has to be written down").

## Decision

**The AI may author a structured Implementation Recommendation. It remains, structurally
and mechanically, exactly like every other analysis finding: AI-authored content, stored
in a new `ai_*`-pattern table, read-only from the API, never wired to a status transition,
a permission, or a ranking input.**

### What's new

- A new `AnalysisStep` — `IMPLEMENTATION_RECOMMENDATION` — added to `PIPELINE_STEPS`,
  run last (after `EFFORT_TIMELINE`), synthesizing the run's own prior findings (value,
  market, feasibility, risk, effort/timeline). Same per-step machinery as every existing
  step: `AiAnalysis` parent row, its own prompt in `prompts.ts`, its own entry in
  `AI_OUTPUT_SCHEMAS`, its own fallback in `fallbacks.ts`, its own `persistStep()` case,
  carried forward on revision exactly like any other step.
- Output shape (`ImplementationRecommendation` in `packages/contracts/src/schemas/analysis.ts`,
  added as `IdeaAnalysisResponse.recommendation`):

  ```
  ImplementationRecommendation
  ├── recommendation      ImplementationRecommendationAction (enum, NOT boolean)
  ├── rationale           string
  ├── supportingEvidence  string[]
  ├── risks               string[]
  ├── assumptions         string[]
  ├── validationNeeds     string[]
  └── provenance          Provenance   (source/model/promptVersion/generatedAt — same
                                        shape every other AI block already carries)
  ```

  `ImplementationRecommendationAction = z.enum(["RECOMMEND", "RECOMMEND_WITH_CONDITIONS",
  "DO_NOT_RECOMMEND", "INSUFFICIENT_DATA"])` — an ordinal, explainable label, never a
  boolean, never a number, never reusing P-1's banned verdict vocabulary
  ("good idea"/"bad idea"). See "Naming: recommendation, not verdict" below — this is a
  deliberate naming choice, not a detail left to fall out of implementation.

### Naming: recommendation, not verdict

An earlier draft of this ADR named the enum `ImplementationRecommendationVerdict` and its
field `verdict`. On review, that naming was rejected before any code was written, for a
reason worth recording rather than silently fixing: **"verdict" is a ruling — a claim of
decision-making authority. P-3 says the AI has none.** Calling the field a verdict would
have re-introduced "AI decides" under a different name, exactly the failure mode this ADR
exists to prevent, even though the underlying mechanics (advisory content, human writes
the real decision) were already correct.

The field is named `recommendation` and the enum `ImplementationRecommendationAction`
instead, because:

- **A recommendation is inherently advisory; a verdict is inherently authoritative.**
  "We recommend X" presupposes someone else decides whether to act on it. "The verdict is
  X" does not. The product requirement is the first sentence, not the second — this ADR's
  entire purpose is to grant the AI the ability to say the first sentence formally,
  without ever being read as saying the second.
- The enum values themselves (`RECOMMEND`, `RECOMMEND_WITH_CONDITIONS`,
  `DO_NOT_RECOMMEND`, `INSUFFICIENT_DATA`) are already phrased as recommended *actions for
  a human to take*, not as judgments about the idea's worth — they satisfy P-1 (no
  good-idea/bad-idea language) as written, and the rename makes the *type* consistent with
  what the *values* already say.
- This is not a weakening of the requirement. The recommendation is still a first-class,
  structured, persisted artifact — a real `ai_*` table row with its own enum, rationale,
  evidence, risks, assumptions, and validation needs, not a narrative paragraph folded into
  an existing finding. Renaming the field does not reduce it to a generic analysis
  summary; it keeps it exactly as formal as specified, while keeping the words used to
  describe it honest about who decides what.
- Every consumer — schema, DB column, prompt instruction to the model, UI copy, and test
  assertions — uses `recommendation`/`ImplementationRecommendationAction` consistently, so
  there is one vocabulary for this concept end to end, not a technical name that drifts
  from the product language used to describe it.
- A **new, separate** human decision: `LeadershipDecision` — its own DB model
  (`leadership_decisions`), its own contract schemas, its own API module
  (`apps/api/src/modules/leadership/routes.ts`), following the exact skeleton
  `review/routes.ts` already established (`createReview`/`overrideCriterionScore`):
  parse+validate → permission check (`leadership:decide`) → `$transaction` writing the
  decision row **and** `writeAudit()` → **no automatic status transition**. A decision
  records `status` (`APPROVED | REJECTED | NEEDS_VALIDATION | OVERRIDE_RECOMMENDATION`),
  a **required** `rationale`, `decidedBy` (the authenticated actor), and which
  `recommendationId` it responds to.
- A new UI card ("AI Recommendation", `apps/web/src/features/analysis/RecommendationCard.tsx`)
  on the existing Analysis tab, wrapped in `<Provenance state="AI_UNVALIDATED">` exactly
  like every other AI block on that page — reusing the `ai-surface`/`ai-border`/`ai-ink`
  tokens and `motion-defer`, not inventing a new visual language.
- A new feature slice, `apps/web/src/features/leadership/`, structured like
  `features/review/` (`LeadershipDecisionTab.tsx`, `api.ts`), reusing the
  `factor-up`/`factor-down` tone pair and the `DecisionForm` pattern (radio group of
  enumerated outcomes + required-reason textarea + non-optimistic mutation + audit-trail
  list) — the same, already-tested "human decision" visual language as the Review tab, so
  "AI recommendation ≠ final decision" is carried by an existing, proven convention
  instead of a new one invented for this feature.

### What P-3 still guarantees, unchanged

- **The worker still writes every AI table; the API module still only reads it**
  (`analysis.routes.ts`'s existing "writing is the worker's job" boundary — unchanged,
  the new step's persistence goes through the exact same `persistStep()` mechanism as
  every other step).
- **`idea.status` is untouched by the recommendation or by a leadership decision.** The
  pipeline's own `EVALUATED`/`NEEDS_CLARIFICATION` bookkeeping (`runPipeline()`) is
  unaffected — the new step participates in the existing `ran`/`fallbacks` counts like any
  step, nothing more. A `LeadershipDecision` write never calls a lifecycle-transition
  function; moving an idea's status remains the existing, separately-gated,
  `lifecycle.ts`-governed act it already is (same "review recorded ≠ idea moved"
  separation `review/routes.ts` already documents in its own comment).
  There is no code path — direct or transitive — by which recording a `LeadershipDecision`
  or generating an `ImplementationRecommendation` can approve an idea, change its status,
  enqueue an implementation action, or override a human decision. If a future workflow
  wants any of that, it needs its own ADR — this one explicitly does not authorize it.
- **`packages/scoring` still never imports `packages/ai`.** The recommendation carries no
  numeric field beyond the existing `ALLOWED_NUMERIC_FIELDS` allow-list (it introduces
  none), contributes nothing to `compositeScore`, and is not consulted by the ranking
  engine — same independence P-5 already established for the evaluation-completeness
  metric ("independent of `composite_score` and never feeds it").
  `tests/arch/architecture.test.ts`'s existing rules are extended, not relaxed: the new
  schema block is checked against the same numeric-field allow-list and the same
  score/rank/weight name-ban regex as every other AI schema.
- **A3's data-approval scope is unchanged.** The recommendation step sends the model
  nothing beyond idea content and the run's own already-approved analysis findings — no
  new data class leaves the network, so A3 needs no amendment.
- **P-1's verdict-language ban is respected in the enum and the prompt.** The model is
  instructed (via `SHARED_RULES` in `prompts.ts`) to write in advisory, not judgmental,
  language — a recommendation about *whether to build*, never a claim about whether the
  idea itself is good or bad.

## Options considered

**A. Fold the recommendation into the existing `EFFORT_TIMELINE` step's output instead of
a new step.** Rejected: `EFFORT_TIMELINE` already has a single, narrow job (effort/cost/
timeline estimate) and the recommendation genuinely depends on *all* prior findings
(value, market, feasibility, risk), not just effort — giving it its own step keeps each
step's prompt and fallback focused, and matches the precedent already set when
`MARKET_CONTEXT` was added as its own step rather than folded into `VALUE`.

**B. Let a `LeadershipDecision` of `APPROVED` automatically transition the idea's status
(e.g. to `PROTOTYPE_CANDIDATE`).** Rejected for this ADR. It would collapse "a human
recorded a decision" and "the idea's lifecycle moved" into one action — the same problem
`review/routes.ts` already solved by keeping those two acts separate. A future ADR may
propose this explicitly (the user's own brief allows for "unless an explicitly approved
future workflow requires that behavior") — it is out of scope here.

**C. Reuse the removed `ImprovementRecommendation` model/`RecommendationState` enum.**
Rejected. That model is FR-15's score-improvement suggestion, tied to a specific
`EvaluationCriterion` and resolved by submitting a new idea version — a different concept
serving a different purpose (raise this version's score) than a build/no-build
recommendation. Reusing its name or table would conflate two different "recommendation"
concepts in the schema, the DB, and the UI. New, distinctly-named types throughout.

## Consequences

**Good**
- The new capability slots into the pipeline's existing per-step machinery — no new kind
  of infrastructure, no new trust boundary, no new provider capability.
- Every mechanism that made "AI never decides" true yesterday (worker-only writes,
  read-only API, lifecycle transitions gated separately, scoring/AI package isolation,
  no numeric fields) is true tomorrow, for this feature specifically as well as for every
  existing one — verified by the same architecture tests, extended rather than loosened.
- "AI recommendation ≠ final decision" is visually enforced by reusing two already-proven,
  already-tested visual conventions (AI-quiet / human-crisp) rather than inventing a
  third.

**Bad, and accepted**
- Two concepts named "recommendation" now exist in the product (P-4's improvement
  recommendation and this one) — mitigated by distinct type/table/enum names and by
  keeping the two UI surfaces visually and physically separate (this ADR does not revive
  P-4's removed feature).
- The pipeline gains an 8th synthesis step that necessarily runs after (and depends on)
  the other seven — a recommendation generated on a partial/fallback run will itself note
  reduced confidence via `INSUFFICIENT_DATA` rather than silently asserting one; this is a
  fallback-design detail to get right in `fallbacks.ts`, not a structural risk.
- A new role permission (`leadership:decide`) and role-gated route are introduced —
  requires confirming the exact role name already reserved for this audience (referred to
  elsewhere in the codebase as `MANAGEMENT`) before wiring the permission check.

# SPC-001 — AI Discovery Agent (Standalone Research Tool)

**Status:** IMPLEMENTED, simplified — see the 2026-09-09 note in §6 · **Verdict:** `not_ready` findings below were waived by the requester, not individually resolved
**Origin:** User request, 2026-09-09 · Brainstormed via `sagent-spec`
**Relationship to REQUIREMENTS.md:** REQUIREMENTS.md §31 places "Automated opportunity
discovery" in **V3** ("only after sufficient usage and historical data") and §32 lists
"complex multi-agent AI systems" and "advanced vector infrastructure" under "What NOT to
Build Initially." This spec deliberately targets a smaller shape (Approach B from the
brainstorm — external-search-only, single LLM pass, no vector/RAG subsystem) chosen
**explicitly to avoid** both of those named risks while still answering the requested
query types. Building this ahead of "sufficient usage data" is a conscious business call
the requester made after this trade-off was surfaced, not an oversight.
**Relationship to IEP-SPEC.md:** Net-new capability. Not part of any existing phase
(P0–P17). Proposed to land as a new phase (working name **P18 — AI Discovery Agent**)
alongside/after the current M2 work, per the requester's own sequencing choice. This
document does not itself edit `IEP-SPEC.md`'s phase tracker — that edit belongs to
`sagent-design` once this spec reaches `ready`.

---

## 1. Purpose & Scope

**Purpose.** Let any authenticated user submit a free-text research query (e.g. "What are
the latest AI trends in software development?") and receive a ranked, sourced set of
findings drawn from a live external search provider, synthesized by a single model call.

**In scope.**
- Free-text query submission by any authenticated user.
- Intent classification into a configured, admin-editable set of discovery types.
- One external web-search call (or a small configured number of calls) per query.
- A single model call that filters, ranks, and synthesizes the returned results into a
  structured report with sources.
- Per-user query history for the submitting user only.
- Cost and rate controls mirroring the existing `AI_BUDGET_*` pattern (§12.1,
  `packages/contracts/src/env.ts`).

**Explicitly out of scope for this spec** (per the confirmed brainstorm decision):
- Any link between a discovery result and an `idea`, `idea_version`, `evaluation`, or
  `ranking_entries` record. This is a standalone tool. A user who wants to act on a
  finding manually opens "Submit an idea" themselves; nothing here pre-fills or automates
  that step.
- Any internal vector search / RAG layer over existing ideas, feedback, or KPIs. That is
  Approach A from the brainstorm, deferred.
- Any change to the evaluation, ranking, or scoring engines (`packages/scoring`,
  `packages/evaluation`).

## 2. Definitions

| Term | Meaning |
|---|---|
| **Discovery query** | The free-text string a user submits to the Discovery Agent. |
| **Discovery type** | The classified category of a query (e.g. `TREND_SCAN`, `OPPORTUNITY_SEARCH`, `PROBLEM_DISCOVERY`), drawn from a configured, non-hardcoded list. |
| **External search provider** | A third-party web-search API (e.g. Bing Web Search, SerpAPI) accessed through a swappable interface, mirroring the existing `AiProvider` abstraction in `packages/ai`. |
| **Discovery result item** | One finding in a discovery report: a title, a synthesized summary, a relevance/recency rationale, and one or more source URLs. |
| **Discovery report** | The complete, ordered set of discovery result items returned for one query. |
| **Untrusted external content** | Any text fetched from the external search provider (snippets, page titles, page content) — treated as data, never as instructions, the same way employee-submitted idea text is treated today (§12.2). |
| **Discovery budget** | The configured per-user and per-org daily spend caps on Discovery Agent usage, mirroring `AI_BUDGET_USER_DAILY_USD` / `AI_BUDGET_ORG_DAILY_USD`. |

## 3. System Requirements

| Ref | Pattern | Requirement |
|---|---|---|
| SPC-1 | Feature | WHERE a user is authenticated with any role (Employee, Reviewer, Admin, Management), the system SHALL allow that user to submit discovery queries. |
| SPC-2 | Event | WHEN a user submits a discovery query, the system SHALL reject it with a typed validation error if it is empty or exceeds a configured maximum character length. |
| SPC-3 | Event | WHEN a discovery query passes validation, the system SHALL run it through the same redaction pass used for submitted ideas (§4.5) before the query text is sent to the external search provider or any model. |
| SPC-4 | Event | WHEN a redacted discovery query is processed, the system SHALL classify it into exactly one discovery type drawn from a configured, admin-editable list, not a hardcoded set. |
| SPC-5 | Unwanted | IF a user's discovery-related spend for the current day would exceed the configured per-user daily discovery budget THEN the system SHALL reject the query with a typed budget-exceeded error and SHALL NOT call the external search provider or any model for that query. |
| SPC-6 | Unwanted | IF total discovery-related spend for the current day would exceed the configured org-wide daily discovery budget THEN the system SHALL reject new discovery queries with a typed error until the next day, regardless of which user submits them. |
| SPC-7 | Event | WHEN a discovery query passes budget checks, the system SHALL issue no more than a configured maximum number of search requests to the external search provider for that query. |
| SPC-8 | Unwanted | IF the external search provider or the model call does not complete within a configured timeout, THEN the system SHALL abort the request, SHALL NOT retry more than a configured maximum number of attempts, and SHALL return a typed timeout error to the user. |
| SPC-9 | Unwanted | IF content fetched from the external search provider contains text that resembles instructions directed at the model, THEN the system SHALL treat that content strictly as delimited, untrusted data and SHALL NOT execute it as an instruction. |
| SPC-10 | Event | WHEN external search results are returned within budget and timeout, the system SHALL filter, rank, and synthesize them via a single model call into a discovery report. |
| SPC-11 | Ubiquitous | The system SHALL attach at least one source URL and a title to every discovery result item. |
| SPC-12 | Unwanted | IF a candidate discovery result item has no attributable source URL, THEN the system SHALL exclude that item from the presented discovery report. |
| SPC-13 | Ubiquitous | The system SHALL NOT create, modify, or link any `idea`, `idea_version`, `evaluation`, `criterion_score`, or `ranking_entries` record as a result of processing a discovery query. |
| SPC-14 | Event | WHEN a discovery query completes (success or failure), the system SHALL persist the query text, its classified discovery type, its outcome, and (on success) its discovery report, associated with the submitting user. |
| SPC-15 | Ubiquitous | The system SHALL restrict a user's own discovery query history to that user; no other Employee, Reviewer, Admin, or Management user SHALL read another user's discovery history through this feature's own read endpoints. |
| SPC-16 | Ubiquitous | The system SHALL write an `audit_log` entry for every discovery query, including the requesting user, timestamp, discovery type, and outcome. |
| SPC-17 | Ubiquitous | The system SHALL visually mark every discovery result as AI-generated content, consistent with the existing AI-provenance treatment (§7.4). |
| SPC-18 | Feature | WHERE no external search provider credentials are configured, the system SHALL use a deterministic stub search provider that returns canned, clearly-marked results, mirroring the existing `StubProvider` pattern in `packages/ai`. |

## 4. Design Constraints

- **Execution model:** synchronous, within the API request/response cycle — no new
  BullMQ queue or worker consumer. This is a deliberate scope reduction under Approach B:
  a discovery query is a single external-search call plus a single model call, bounded by
  SPC-8's timeout, which does not need the async job/poll pattern the AI analysis pipeline
  uses for its six-step run (§3.3).
- **Provider abstraction (L4, replaceable):** the external search provider is accessed
  through an interface analogous to `AiProvider` — concrete provider choice (Bing,
  SerpAPI, or another) is a technology choice, never a requirement, per the SPEC §0
  document-layering rule.
- **Structural enforcement of SPC-13:** enforced the same way `packages/ai` is barred from
  `packages/scoring` today — an architecture test (`dependency-cruiser`) fails the build if
  the Discovery Agent module imports anything from `packages/scoring`, `packages/evaluation`,
  or any status-transition module.
- **New untrusted-input class:** SPC-3 and SPC-9 extend the existing input/output guardrail
  shape (§12.2) to cover two categories that don't exist there today — the discovery
  query itself going *outbound* to a third party (not just inbound to our own model), and
  fetched external page content coming *inbound* as a second untrusted-data channel
  alongside employee-submitted text.
- **Secrets:** the external search provider's API key follows the same handling as
  `ANTHROPIC_API_KEY` (§4.4) — process-isolated, never logged, never returned to the client.
- **Retention:** discovery query/report retention should follow the existing
  `AI_RAW_PAYLOAD_RETENTION_DAYS` pattern rather than being kept indefinitely — see
  Finding 6 in the Ambiguity Report for the open question on the actual number.
- **No vector/RAG infrastructure** is introduced by this spec. The `vector(1536)` columns
  already reserved for P12 duplicate detection are untouched and unrelated.

## 5. Acceptance Criteria

- **AC-1 (happy path):** Given an authenticated Employee, when they submit a valid
  discovery query under the character limit, then within the configured timeout they
  receive a discovery report where every item has a title, a summary, and at least one
  source URL, and the report is visibly marked as AI-generated.
- **AC-2 (redaction):** Given a discovery query containing a pattern the existing
  redaction pass recognizes as PII, when the query is processed, then the redacted form
  — never the raw form — is what reaches the external search provider and the model,
  verifiable via the persisted query record and outbound request logs.
- **AC-3 (budget enforcement):** Given a user whose discovery spend today has already
  reached the configured per-user daily cap, when they submit another discovery query,
  then the system rejects it with a typed budget error and no external search or model
  call is made (verifiable via provider call logs / a spy in tests).
- **AC-4 (no idea-pipeline side effects):** Given any discovery query, successful or
  failed, when it completes, then no row in `ideas`, `idea_versions`, `evaluations`,
  `criterion_scores`, or `ranking_entries` has been created or modified as a result
  (verifiable via a before/after row-count assertion in an integration test).
- **AC-5 (history isolation):** Given two different users who have each submitted
  discovery queries, when User A requests their discovery history, then it contains only
  User A's queries, never User B's (verifiable via an integration test asserting a 403/404
  or empty result on cross-user access).
- **AC-6 (stub fallback):** Given no external search provider credentials configured
  (e.g. local dev), when a discovery query is submitted, then the stub search provider
  answers deterministically and the response is clearly marked as stub/non-live data.
- **AC-7 (untrusted content containment):** Given fetched external content that contains
  a string resembling a model instruction (e.g. "ignore previous instructions and..."),
  when that content is processed, then the model's output contains no evidence of having
  followed it (verifiable via an eval fixture, mirroring the existing prompt-injection
  guardrail tests for idea submissions).

## 6. Ambiguity Report

**Verdict: `not_ready`.** Every finding below needs either an adopted numeric default or
an explicit, named waiver before this spec can move to `sagent-design`. None are waived
yet. This does not block further discussion — it is information for the requester to act on.

| # | Requirement(s) | Problem | Proposed rewrite | Status |
|---|---|---|---|---|
| 1 | SPC-2 | "a configured maximum character length" has no bound named anywhere yet. | Mirror the existing idea-submission char cap pattern (§4.3): propose a specific number, e.g. **2,000 characters**, set via a new `DISCOVERY_QUERY_MAX_CHARS` env var with that default. | Open |
| 2 | SPC-5 | "the configured per-user daily discovery budget" has no number. | Propose a new `DISCOVERY_BUDGET_USER_DAILY_USD` env var. Suggested default: same order of magnitude as `AI_BUDGET_USER_DAILY_USD` (**$5**), since this is one model call plus one search call per query, not six. | Open |
| 3 | SPC-6 | "the configured org-wide daily discovery budget" has no number. | Propose `DISCOVERY_BUDGET_ORG_DAILY_USD`, default **$50** (an order of magnitude below `AI_BUDGET_ORG_DAILY_USD`'s $200, reflecting this as a smaller, newer feature until usage data says otherwise). | Open |
| 4 | SPC-7 | "no more than a configured maximum number of search requests" has no number. | Propose `DISCOVERY_MAX_SEARCH_CALLS_PER_QUERY`, default **3** (enough for one query plus up to two refinements before the single model pass). | Open |
| 5 | SPC-8 | "a configured timeout" and "a configured maximum number of attempts" both lack numbers. | Propose `DISCOVERY_TIMEOUT_MS` default **20000** (20s, generous enough for one search call + one model call) and `DISCOVERY_MAX_ATTEMPTS` default **1** (no automatic retry — a failed discovery query is cheap for the user to resubmit, and silent retries would double-spend budget without the user's knowledge). | Open |
| 6 | Design Constraints (Retention) | No retention period is named for stored discovery queries/reports. | Propose reusing `AI_RAW_PAYLOAD_RETENTION_DAYS`'s existing value (**90 days**) rather than inventing a separate one, unless the requester wants discovery history to outlive or expire faster than raw AI payloads. | Open |
| 7 | SPC-15 | States history is user-scoped but doesn't say whether Admin/Management can read it for audit purposes, distinct from the general `audit_log` entry in SPC-16. | Rewrite: "...no other Employee, Reviewer, or Management user SHALL read another user's discovery history through this feature's own read endpoints. Admin MAY read another user's discovery history only through the existing audit-log read path (§17.7's 'Read audit: all' row for Admin), never through the discovery-history endpoint itself." Needs the requester to confirm Admin should have this audit visibility at all, versus discovery history being fully private even from Admin. | Open |
| 8 | SPC-4 | The discovery-type taxonomy itself ("a configured, admin-editable list") has no seed values named, so there is nothing concrete to classify against yet. | Propose seeding three types matching the request's own examples: `TREND_SCAN`, `OPPORTUNITY_SEARCH`, `PROBLEM_DISCOVERY` — admin-editable thereafter, same pattern as evaluation criteria (P-6). | Open |

**No waivers recorded yet.** A valid waiver needs: the finding number, the name of the
person accepting the risk, and the reason. Since this is a fresh spec, none have been
requested.

---

### 2026-09-09 — waived and shipped smaller

The requester (Shafeeq) directed a minimal build rather than resolving Findings 1–8
individually: *"just create a chatbot that acts as a discovery agent and follows the
workflow — this is what has been asked of me."* Waiver for all eight findings: **Shafeeq,
2026-09-09**, reason: the numeric/config ceremony this spec called for wasn't part of
what was actually asked; ship the working feature, revisit limits if real usage justifies
them.

What actually shipped, differing from the draft above:

- **No external search provider at all** (a further simplification of Approach B, not
  just Findings 1–8): no Bing/SerpAPI integration, no new secret. The single model call
  answers from its own trained knowledge — the system prompt in
  `packages/ai/src/discovery.ts` requires it to say so plainly and never claim to have
  browsed the web. This sidesteps SPC-7's "max search calls" entirely (there are none).
- **No per-user/org daily budget caps** (Findings 2–3 waived, not adopted with numbers).
  SPC-5/SPC-6 are not enforced. A cost line is recorded per query (`AiUsage`-shaped, on
  the `DiscoveryChatResult`) but nothing rejects a query on cumulative spend.
- **SPC-2's character cap is enforced** at 2,000 (`CreateDiscoveryQueryRequest` in
  `packages/contracts/src/schemas/discovery.ts`) — this one **was** adopted as originally
  proposed, since it cost nothing extra to reuse the existing `ShortField` convention.
- **No fixed timeout/retry config** (Finding 5 waived): the queue's `attempts: 1` (no
  automatic retry) shipped as designed, but there's no explicit request timeout beyond
  whatever the Anthropic SDK/BullMQ defaults are.
- **No retention job** (Finding 6 waived): `discovery_queries` rows are kept indefinitely;
  nothing purges them at 90 days or any other interval.
- **Finding 7 resolved, not waived**: shipped as strictly own-only (SPC-15 as originally
  written) — no Admin override, no separate audit-read path for another user's discovery
  history. Simplest option, and nobody asked for the Admin visibility.
- **Finding 8 resolved differently than proposed**: no seeded/admin-editable taxonomy
  table. `discoveryType` is a free string the model names itself each time (see the
  system prompt) — SPC-4 is satisfied in spirit (classification happens) but "admin-
  editable list" was dropped as unnecessary infrastructure for a single-call feature.

Everything **not** listed above shipped as originally specified: SPC-1, SPC-3, SPC-9
through SPC-14, SPC-16, SPC-17, and SPC-18 (stub fallback) are all implemented and
covered by tests (`packages/ai/src/discovery.test.ts`, and manually verified end-to-end
through the running app). See `docs/adr/CONTRACT-LOG.md`'s 2026-09-09 entry for the exact
contract surface.

### 2026-09-09 — follow-up: submit-as-idea bridge + clickable sources

Requester follow-up, same day: findings should be traceable to their source, and actable
on — "the ideas should be able to be posted on submit ideas... go to the source where it
came from." Two frontend-only additions to `DiscoveryChatPage.tsx`, no contract change:

- **Clickable sources.** A source string is rendered as a link when it matches
  `/^https?:\/\//i` (SPC-11's "real URL only if genuinely confident"); everything else
  (a named publication, subreddit, or report) stays plain text, unchanged.
- **"Submit as idea" per finding.** Navigates to the existing `/ideas/new` route with the
  finding's title and summary (plus its source list, folded into the description text)
  passed as React Router navigation *state* — not a URL param, not a stored reference.
  `SubmitIdeaPage` reads it only to pre-fill `IdeaForm`'s `defaultValues`; the three other
  required fields (problem, users, outcome) are left for the human to write, same as any
  other submission. **SPC-13 is unaffected**: no `discovery_queries` row is read, written,
  or linked by this — it was already anticipated verbatim in `schema.prisma`'s SPC-13
  comment, "a user acting on a finding submits a real idea by hand."

### 2026-09-10 — reframe: generated ideas, not cited findings

**Origin:** User request, 2026-09-10. **Verdict: `not_ready`** — one finding open below.

**Problem restated.** The shipped agent presents itself as reporting *findings it pulled
from sources* (SPC-11's mandatory source URL, SPC-12's "no source → drop the item," the
UI's "Sources:" line). But there is no live search behind it — SPC-001's 2026-09-09
simplification already made this a single model call answering from trained knowledge,
with a prompt that must "say so plainly and never claim to have browsed the web." The
"Sources:" framing was therefore already somewhat fictional. The requester wants the
agent to stop pretending to cite things and instead openly generate original ideas,
inspired by trends the model knows about, framed for how they'd help the organization
and its clients generically — no org-profile input exists to tailor beyond that.

Two clarifying answers from the requester fix what would otherwise be open questions:
sourcing is **dropped entirely** (no "inspired by X" attribution requirement either), and
ideas stay **generic** (no new org-context input is being added in this change).

**Brainstormed approaches:**

1. **Prompt-only reframe + optional-source contract tweak (recommended).** Rewrite the
   system prompt in `packages/ai/src/discovery.ts` to instruct the model to generate
   original ideas rather than report findings, and add one line of framing per idea (how
   it could help the org/its clients). Make `DiscoveryResultItem.sources` optional in the
   contract (was required, min 1) and delete SPC-12's "drop items without a source"
   filter. Everything else — route, single model call, persistence shape, redaction,
   AI-provenance badge, submit-as-idea bridge — is untouched.
   - *Why it wins:* smallest possible change; no new fields, no new endpoint, no new
     queue, no breaking read of already-persisted `discoveryReport` JSON (old rows still
     have `sources`, just no longer required going forward). Fully consistent with
     SPC-001's design constraint of one model call and no external search infrastructure.
   - *Trade-off:* the "why this helps the org" framing lives inside free-form `summary`
     text rather than its own structured field, so it can't be filtered/sorted on later
     without a further contract change.
2. **Contract reshape** — replace `sources: string[]` with new fields
   (`inspiredBy: string[]`, `whyItHelps: string`) on `DiscoveryResultItem`. Cleaner data
   model, structured framing text separate from the idea description.
   - *Trade-off:* touches `packages/contracts`, the worker, and every frontend render
     site (including the just-shipped clickable-source-link logic), for a feature that
     was deliberately kept minimal twice already. Renaming a shipped field also means any
     already-persisted `discoveryReport` rows have a different shape than new ones,
     forcing a read-time compatibility branch for no functional gain over Approach 1.
3. **Two-pass generation** — one model call to name current trends, a second to generate
   org-relevant ideas from them, for richer "inspired by" grounding.
   - *Trade-off:* a second Anthropic call per query doubles cost and latency and
     reintroduces exactly the "multi-call AI pipeline" shape SPC-001 was written to avoid
     (REQUIREMENTS §32, "complex multi-agent AI systems" — not to be built initially).
     Not justified by a framing-sentence improvement.

**Recommendation: Approach 1.** It is the only option that changes nothing about
SPC-001's architecture — same single call, same route, same persistence — while fully
answering what was asked. This is a recommendation for the requester to confirm or
override, not a decision already made.

**New/superseding requirements** (continuing from SPC-18):

| Ref | Pattern | Requirement |
|---|---|---|
| SPC-19 | Ubiquitous | The system SHALL present every discovery result item as an original, model-generated idea, not as a cited external finding. **Supersedes SPC-11's mandatory-source-URL framing.** |
| SPC-20 | Ubiquitous | The system SHALL NOT require a source URL on a discovery result item, and SHALL NOT exclude an item for lacking one. **Supersedes and removes SPC-12.** |
| SPC-21 | Ubiquitous | The system SHALL word every discovery result item to state, in plain language, how it could help the requesting organization and its clients generically — without asserting fit to any specific named organization, since no organization-profile data is collected or available to the system. |
| SPC-22 | Event | WHEN generating a discovery report, the system SHALL instruct the model, via its system prompt, to draw on real-world trends and context from its training knowledge as inspiration, while continuing to state plainly (per the existing 2026-09-09 behavior) that it has not performed a live search. |

**Design constraints:**
- `DiscoveryResultItem.sources` (`packages/contracts/src/schemas/discovery.ts`) becomes
  **optional**, default empty array — additive, backward-compatible with already-persisted
  rows (CONTRACT-LOG entry required on merge).
- `DiscoveryChatPage.tsx`'s "Sources:" line and clickable-link rendering only appears when
  `sources` is non-empty; nothing renders an empty/required-looking source line when the
  model doesn't name one.
- SPC-13 (no idea-pipeline side effects) and the submit-as-idea bridge are unaffected —
  neither reads nor depends on `sources`.

**Acceptance criteria:**
- **AC-8:** Given a discovery query, when a report is generated, then every item has a
  title and an idea description that includes a plain-language "how this could help"
  framing, and no item is ever dropped for lacking a source URL.
- **AC-9:** Given a discovery query, when the report is generated, then no item's text
  claims a live web search was performed or cites a URL as if retrieved from search
  (verifiable via an eval fixture, mirroring the existing 2026-09-09 no-live-search check).
  **Partially covered as shipped:** `discovery.test.ts`'s SPC-22 test only asserts the
  instruction is present in the system prompt text, not that a real model call actually
  obeys it — there is no eval-fixture infrastructure for the Discovery Agent in this repo
  (there wasn't one for the 2026-09-09 version either, despite this AC's wording implying
  one existed to mirror). Full AC-9 coverage against real model output remains open until
  such infrastructure is built.
- **AC-10 (regression):** Given the shipped PII redaction, AI-provenance badge, and
  submit-as-idea bridge, when this change ships, then all three continue to work
  unchanged (verifiable via the existing `discovery.test.ts` suite plus a manual pass).

**Ambiguity Report:**

| # | Requirement(s) | Problem | Proposed rewrite | Status |
|---|---|---|---|---|
| 9 | SPC-21 | "in plain language" and "how it could help" have no length or structural bound — two different model outputs could satisfy this at wildly different quality bars. | Add a soft instruction in the prompt (not a hard contract rule) that the framing be one to two sentences, appended to `summary` rather than the idea's core description. Not proposed as a strictly testable numeric bound — flagged here rather than silently omitted, per this skill's own rule against skipping acceptance criteria to move faster. | Open |

**Waiver for Finding 9: Shafeeq, 2026-09-10.** Reason: the length/structure of the "how
this helps" framing is a prompt-wording judgment call, not something worth a hard
contract bound for a single-sentence addition — ship it, revisit if real output quality
says otherwise. **Verdict: `ready`.**

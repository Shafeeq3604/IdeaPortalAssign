# IEP-SPEC.md — Employee Idea Evaluation & Innovation Platform

**Status:** Draft for scoping-gate review · **Version:** 0.1 · **Owner:** Engineering
**Origin document:** `REQUIREMENTS.md` v1.0
**Authority:** This document is the **single source of truth**. On conflict with
`REQUIREMENTS.md`, `CLAUDE.md`, tickets, comments, or prior conversation — **SPEC wins.**

> Working codename **IEP**. Renaming is one find/replace (ADR-000).

## Contents

1. Scope, Non-Goals & Requirement Coverage
2. Product Principles (binding)
3. Architecture
4. Production Security
5. Data Model
6. Navigation & Clickability Contract
7. Design System
8. Experience & Motion
9. Feature Acceptance Criteria
10. Journey Acceptance Criteria
11. Test Strategy
12. Intelligence Layer
13. Architecture Decision Records
14. Phases & Milestones
15. Definition of Done
16. Decisions Log (devil's-advocate pass) + Supersessions
17. MVP Architecture Summary (locked)

---

# 0. Document Layering — requirements vs. implementation

Five layers, deliberately separated. **A decision may only constrain the layers below it.**

| Layer | Lives in | Changes when | Stability |
|---|---|---|---|
| **L1 Business requirements** | `REQUIREMENTS.md` §1–3, §40–42 | The business changes its mind | Highest |
| **L2 Functional requirements** | `REQUIREMENTS.md` FR-01..FR-29, NFR-01..08 → SPEC §1.4 coverage, §9 acceptance | A capability is added or re-scoped | High |
| **L3 Technical architecture** | SPEC §3–§6, §12 patterns | A structural property must change | Medium — needs an ADR |
| **L4 Technology choices** | SPEC §3.4, §7, §13 ADRs | A better tool exists, or a constraint appears | **Lowest — designed to be replaceable** |
| **L5 Future integrations** | SPEC §14 M2/M3 | Enterprise systems become available | Deferred by default |

**The rule: no technology is a requirement unless `REQUIREMENTS.md` names it.** It does not
name any. Therefore every entry in §3.4 and every ADR is an **L4 choice, replaceable
without touching L1–L3.** Postgres, Fastify, shadcn/ui, and Claude are how we satisfy the
requirements — never *what* is required.

Three tests this layering must pass, and does:

- *Swapping the component library* touched L4 only. The nav contract (§6), design tokens
  (§7.3), and acceptance criteria (§9) were unchanged — see ADR-019.
- *Swapping the model strategy* touched L4 only. "AI produces factors, a deterministic
  engine produces scores" (L3, ADR-005) was untouched — see ADR-020.
- *Dropping MCP* touched L5 only. FR-21 (L2) still ships — see the P12 risk note.

When reading a conflict: **L1 states the need, L2 states the behaviour, L3 states the
shape, L4 states the tool.** A lower layer never justifies changing a higher one.

---

# 1. Scope, Non-Goals & Requirement Coverage

## 1.1 What MVP1 is

A working loop, end to end, for four roles:

> **Submit → Understand → Evaluate → Rank → Explain → Improve → Re-evaluate → Validate**

An employee submits an idea, watches it get structured and analysed, sees where it ranks
and *why*, receives concrete improvement guidance, revises it, and sees the rank move. A
reviewer validates or overrides the analysis with a recorded reason. Management sees a
ranked, filterable board and can compare ideas. An administrator can see the criteria and
weights that produced every number.

The last two steps of the full workflow — **Implement → Measure** — are M3. They are not
dropped; they are sequenced (§1.4).

## 1.2 Non-Goals for MVP1

Explicitly out of scope. Building any of these in M1 is scope creep — stop and ask.

| Non-goal | Lands in |
|---|---|
| Email / Slack / Teams notifications | M2 (P13) |
| Notification centre and per-user preferences | M2 (P13) |
| Employee feedback types and comment threads | M2 (P11) |
| Demand signals as ranking inputs | M2 (P11) |
| Duplicate detection, similarity, merge | M2 (P12) |
| Existing-solution detection, build/buy/extend/integrate | M2 (P12) |
| Admin **write** UI for criteria, profiles, categories, statuses | M2 (P10) |
| Organisational analytics and reporting | M2 (P14) |
| Prototype/pilot tracking, KPIs, actual-vs-predicted, ROI | M3 |
| Internal system integrations | M3 |
| Multi-tenant / multi-organisation | Not planned |
| Public/partner API, mobile native app, i18n/l10n | Not planned |
| More than one identity provider | Not planned for M1 |

## 1.3 Assumptions (stated, not verified)

- Single organisation, single tenant, English only, up to 10,000 employees.
- One OIDC identity provider exists and can issue group claims for department mapping.
- Ideas may contain personal data; they are internal-confidential, not regulated
  (no PHI/PCI). If that is wrong, §4.5 changes and we stop.
- An Anthropic API key with an org-level spend cap is available.
- Capacity assumption: up to 3,000 idea versions/year, 200 concurrent users.

## 1.4 Requirement coverage — nothing dropped

Every FR and NFR in `REQUIREMENTS.md` maps to exactly one milestone.

| Req | Title | Milestone | Phase |
|---|---|---|---|
| FR-01 | Authentication & authorization | M1 | P1 |
| FR-02 | Idea creation | M1 | P2 |
| FR-03 | Idea understanding & structuring | M1 | P3 |
| FR-04 | Use-case identification | M1 | P3 |
| FR-05 | Business value evaluation | M1 | P3 + P4 |
| FR-06 | Feasibility analysis | M1 | P3 + P4 |
| FR-07 | Implementation requirements | M1 coarse / M2 full breakdown | P3 / P10 |
| FR-08 | Timeline estimation | M1 | P3 |
| FR-09 | Effort & cost evaluation | M1 (Low/Med/High/Very High) | P3 |
| FR-10 | Risk identification | M1 | P3 |
| FR-11 | Time-horizon analysis | M1 | P3 + P4 |
| FR-12 | Idea ranking | M1 | P4 |
| FR-13 | Evaluation profiles / weights | M1 engine + read-only view; M2 write UI | P4, P9 / P10 |
| FR-14 | Ranking explanation | M1 | P5 |
| FR-15 | Improvement engine | M1 | P5 |
| FR-16 | Improve & re-evaluate workflow | M1 | P8 |
| FR-17 | Maturity classification | M1 | P4 |
| FR-18 | Employee feedback | M2 | P11 |
| FR-19 | Demand signals | M2 | P11 |
| FR-20 | Similar-idea detection | M2 | P12 |
| FR-21 | Existing-capability detection | M2 | P12 |
| FR-22 | Human validation | M1 | P6 |
| FR-23 | Idea lifecycle / status | M1 | P2 + P6 |
| FR-24 | Idea versioning | M1 | P8 |
| FR-25 | KPI definition & measurement | M3 | P16 |
| FR-26 | Management dashboard | M1 basic / M2 full | P7 / P14 |
| FR-27 | Organisational analytics | M2 | P14 |
| FR-28 | Notifications | M2 (in-app progress in M1, §9.3) | P13 |
| FR-29 | Audit trail | M1 | P6 |
| NFR-01..08 | Security, Privacy, Explainability, Reliability, Scalability, Performance, Maintainability, Observability | M1 | P0–P9, §4 & §11 |

---

# 2. Product Principles (binding)

Enforced by code and tests, not goodwill. A PR that breaks one is rejected.

| # | Principle | Enforcement mechanism |
|---|---|---|
| P-1 | **Evaluation, not judgment.** Never label an idea good/bad. | Copy lint bans `good idea`/`bad idea`/`poor idea` in user-facing strings. No pass/fail colour is applied to an idea score (§7.3). |
| P-2 | **Explainability.** No unexplained number, ever. | `ranking_entries` cannot commit without a non-empty `ranking_explanations` row. DB constraint + unit test. |
| P-3 | **Human-in-the-loop.** AI never decides. | AI writes only to `ai_*` tables. Status beyond `EVALUATED` and every decision field require an authenticated human actor. Service guard + test. |
| P-4 | **Improvement over rejection.** | Any idea below the configured attention threshold must carry at least one open `improvement_recommendation`, or the pipeline reports a defect. |
| P-5 | **Separate value from feasibility.** | Independent criterion groups; no formula multiplies value by feasibility. Composite is additive-weighted only. |
| P-6 | **Configurable evaluation.** | Zero weights, thresholds, or criterion keys hardcoded in `packages/scoring`. All injected. Test asserts the engine is data-driven. |
| P-7 | **Evidence-driven.** | Every `criterion_score` carries `source` + non-empty `evidence[]`. DB check constraint. |
| P-8 | **Continuous improvement.** | Evaluations attach to `idea_versions`, never to `ideas`. |
| P-9 | **Avoid unnecessary development.** | M2 existing-solution check runs *before* any build recommendation. |
| P-10 | **Measure real results.** | M3 schema (`kpi_definitions`, `kpi_measurements`) reserved at P0 so it is additive later. |

---

# 3. Architecture

## 3.1 Shape

Modular monolith plus a worker. Not microservices — the volume does not justify the
operational cost, and the boundary that actually matters (AI analysis vs. scoring) is a
package boundary, not a network boundary. See ADR-001.

```
Browser (React SPA)
     |  HTTPS, JSON, session cookie
     v
+--------------------------------------------------------------+
| apps/api  (Fastify)                                           |
|   auth . policy(RBAC) . modules(idea, eval, rank, review...)  |
|   uses -> packages/scoring   (PURE, no I/O, deterministic)    |
|   uses -> packages/contracts (Zod, shared types, nav map)     |
+-------+--------------------------------+----------------------+
        | enqueue                        | read/write
        v                                v
+-------------------+          +----------------------+
| Redis + BullMQ    |          | PostgreSQL 16        |
+-------+-----------+          |  + pgvector (M2;     |
        | consume              |    column reserved)  |
        v                      +----------------------+
+--------------------------------------------------------------+
| apps/worker                                                   |
|   AI pipeline steps . ranking recompute . audit outbox flush  |
|   uses -> packages/ai  (provider abstraction + stub)          |
+-------+--------------------------------------------------------+
        | HTTPS
        v
   Anthropic Claude API   (analysis only — never scoring)
```

## 3.2 The separation that defines this product

`REQUIREMENTS.md` §35 is not a suggestion; it is the architecture (ADR-005).

```
Employee idea (free text)
   |
   v  packages/ai — LLM
AI ANALYSIS  ->  emits typed FACTORS ONLY: use cases, target users, impact
                 dimensions as ordinal bands, feasibility findings, risks,
                 dependencies, requirements, effort/cost class, evidence strings.
                 *** The AI output schema contains NO numeric score field. ***
   |
   v  packages/scoring — pure TypeScript, no network, no randomness, no clock
EVALUATION ENGINE  ->  maps factors to criterion values, normalises 0..100,
                       applies the active profile's weights -> CriterionScore[]
   |
   v  packages/scoring
RANKING ENGINE  ->  orders a cohort -> immutable RankingRun + RankingEntry[]
   |
   v  packages/scoring
EXPLANATION ENGINE  ->  reads the contribution vector -> strengths, constraints,
                        peer comparison. Deterministic templates. No LLM required.
```

Three consequences, deliberately accepted:

1. Changing weights **never** calls the model. Recompute costs cents, not dollars, and is
   fast enough to preview live.
2. Ranking is unit-testable from fixtures and reproducible byte-for-byte
   (`engine_version` is stamped on every run).
3. Prompt injection cannot move a score, because no code path exists from model output to
   a score column (§4.6).

## 3.3 Async analysis (NFR-06)

Submission returns `202` immediately with an analysis-run id. Six ordered steps run as
separate idempotent jobs keyed on `sha256(idea_version.content)`, so retries and partial
failures never duplicate work or spend:

`STRUCTURE -> USE_CASES -> VALUE -> FEASIBILITY -> RISK -> EFFORT_TIMELINE`
then, in-process and synchronous: `EVALUATE -> RANK -> EXPLAIN`.

The UI shows a **determinate six-step stepper** driven by real job events (§8.4), not a
fake progress bar. If a step fails after 3 retries with exponential backoff, the run is
marked `PARTIAL`, the idea moves to `NEEDS_CLARIFICATION`, and the non-AI fallback (§12.3)
supplies the missing factors so the idea remains rankable.

## 3.4 Technology

| Layer | Choice | ADR |
|---|---|---|
| Language | TypeScript 5.x, Node 22 LTS, `strict` | ADR-001 |
| Monorepo | pnpm workspaces + Turborepo | ADR-001 |
| API | Fastify 5 + Zod; OpenAPI generated from Zod | ADR-003 |
| DB | PostgreSQL 16 + Prisma | ADR-002 |
| Queue | BullMQ + Redis 7 | ADR-007 |
| Web | React 19 + Vite + React Router + TanStack Query | ADR-019 |
| Components | **shadcn/ui** (Radix + Tailwind) as the baseline; custom only where no reasonable equivalent exists | ADR-019 |
| Styling | Tailwind, themed by the §7.3 tokens mapped onto shadcn's CSS variables | ADR-019 |
| AI | Anthropic Claude, **tiered model routing** (§12.1), configurable without a code change | ADR-020, ADR-021 |
| Tests | Vitest · Playwright · axe-core · Lighthouse CI | §11 |

## 3.5 Maintainability (NFR-07)

Swappable without redesign, by construction:

- **Criteria & weights** — rows in `evaluation_criteria` / `profile_weights`.
- **AI provider** — `AiProvider` interface; `AnthropicProvider` and `StubProvider`.
- **AI model** — `ai_model_routes` config per story (§12.1.2); changing a model is a config edit and an audited event, never a code change.
- **Business rules** — `packages/scoring` is pure and receives config by injection.
- **Prompts** — versioned files `packages/ai/prompts/<name>.v<N>.ts`; `prompt_version` is
  persisted on every analysis so historical results stay attributable.

## 3.6 Observability (NFR-08)

Structured JSON logs carrying `requestId`, `ideaId`, `actorId`. OpenTelemetry traces
spanning API → queue → worker → provider. Metrics: per-step analysis duration, provider
latency/tokens/cost per idea, queue depth, ranking recompute duration, error rate by
module. Alerts: queue depth >200 for 5 min; analysis p95 >10 min; provider error rate >5%;
daily AI spend >80% of cap. Audit logs are separate from application logs, never sampled,
never expired (§4.7).

---

# 4. Production Security

## 4.1 Authentication (FR-01, NFR-01)

OIDC Authorization Code + PKCE against the corporate IdP. No local passwords in M1.
Server-side sessions; cookie `HttpOnly`, `Secure`, `SameSite=Lax`, `__Host-` prefix.
Idle timeout 8h, absolute 24h. Session id rotates on login and on privilege change.
CSRF: double-submit token on every state-changing request. Logout revokes server-side.

## 4.2 Authorization — deny by default

Roles: `EMPLOYEE`, `REVIEWER`, `ADMIN`, `MANAGEMENT`. A user may hold several.

Two mandatory enforcement layers:

1. **Route policy** — every route declares `requires: Permission[]`. A route with no
   declaration **fails to register at boot**. There is no implicit-allow path.
2. **Resource policy** — `can(actor, action, resource)` in `modules/<m>/policy.ts`,
   evaluated after the resource loads, plus a repository-level scope filter so list
   endpoints cannot leak rows a detail endpoint would refuse.

| Action | EMPLOYEE | REVIEWER | ADMIN | MANAGEMENT |
|---|---|---|---|---|
| Create idea | yes | yes | yes | yes |
| Read own idea (any status) | yes | yes | yes | yes |
| Read others' ideas | `RANKED`+ only | all | all | `EVALUATED`+ |
| Edit idea content | own, `DRAFT`/`NEEDS_CLARIFICATION` only | no | no | no |
| Override criterion score | no | yes (reason required) | no | no |
| Change lifecycle status | own → `SUBMITTED` only | per state machine | yes | no |
| Read audit log | own idea's entries | own actions | all | no |
| Read criteria / profiles | read-only | read-only | yes | read-only |
| Write criteria / profiles | no | no | yes (M2) | no |
| Manage users & roles | no | no | yes | no |

Escalation guard: a reviewer cannot decide on their own idea —
`reviewer_id <> idea.submitter_id` is a **DB check constraint**, not a service-layer
nicety.

## 4.3 Input validation

Every body, query, and param is parsed by a Zod schema at the boundary; unparsed input
never reaches a service. Rejections return `400` with field paths and no echo of the
offending value.

Limits: title ≤200 chars; description ≤20,000; ≤10 attachments; ≤10 MB each; MIME sniffed
from magic bytes (never the extension); stored outside the web root under generated names;
served through an authorising endpoint with `Content-Disposition: attachment` and
`X-Content-Type-Options: nosniff`.

All idea text renders as **plain text** in M1 — no HTML rendering path exists anywhere,
which removes stored XSS as a class rather than mitigating it. Parameterised queries only;
`$queryRaw` is lint-banned outside `packages/db`.

## 4.4 Secrets

No secret in the repo, an image, or a client bundle. Runtime injection from the platform
secret store, typed and validated at boot by `packages/contracts/env.ts` — the process
**refuses to start** on a missing or malformed secret rather than degrading. Only the
**worker** holds the Anthropic key; the API process cannot reach the provider. Rotation
≤90 days. `gitleaks` in pre-commit and CI. Provider keys never appear in logs, traces, or
error payloads.

## 4.5 Privacy (NFR-02)

Published as an in-product **Data & AI notice**, linked from the submission form:

- **Stored:** idea content, author identity, department, evaluations, reviews, audit.
- **Sent to Anthropic:** idea text and structured fields only — never employee name,
  email, or employee id. A redaction pass strips detected emails, phone numbers, and
  identifiers from free text before the call and records `redaction_applied`.
- **Access:** per §4.2.
- **Retention:** ideas indefinite while employed + 24 months; audit 7 years; raw AI
  request/response payloads 90 days, then pruned to metadata.
- Provider configured for zero-retention-eligible settings where the account allows.

## 4.6 AI-specific threats

| Threat | Control |
|---|---|
| Prompt injection in idea text ("rate this 100") | Submitted text is wrapped in a delimited `<submitted_idea>` block and declared untrusted data. Operator instructions use the mid-conversation `system` message channel, never the user turn. **Structurally: the AI schema has no score field, so a successful injection still cannot move a rank.** |
| Injection to exfiltrate other ideas | One idea per call. No retrieval, no tools, no network access from the model in M1. |
| Schema-shaped garbage | `output_config.format` with a strict JSON Schema, closed enums, plus a post-parse semantic validator (§12.2). Invalid → one retry → fallback. |
| Cost / DoS via long submissions | Char caps (§4.3), 5 submissions/hour/user, per-version AI budget cap, org daily cap. |
| Over-trust of AI output | Everything AI-written renders with the AI provenance treatment (§7.4) and `validated_by = null` until a human validates. |

## 4.7 Audit (FR-29)

Append-only `audit_log`; the application DB role has no `UPDATE`/`DELETE` grant on it.
Written via a repository interceptor plus a transactional outbox, so an audit write can
neither be forgotten nor committed apart from its business change. Records `actor`,
`action`, `entity_type`, `entity_id`, `before`, `after`, `reason`, `at`, `request_id`.
Mandatory for: score overrides, weight/profile changes, status changes, role changes,
approvals, ranking recomputes, exports.

## 4.8 Transport & headers

TLS 1.2+. HSTS. CSP `default-src 'self'`, no `unsafe-inline` (nonce-based),
`frame-ancestors 'none'`. `Referrer-Policy: strict-origin-when-cross-origin`.
Rate limits: 100 req/min/user global; 5/hour idea submission; 20/min auth.

---

# 5. Data Model

Encodes the Entity & Navigation Map (§6). PostgreSQL. All ids ULID; all timestamps
`timestamptz`; every table carries `created_at`, mutable tables `updated_at`.

## 5.1 Entity relationship map

```
Department 1-----n User 1-----n Idea -----1 IdeaCategory
                    |             |
                    |             | 1
                    |             v n
                    |        IdeaVersion --1-- AiAnalysis --n-- UseCase
                    |             |  |              |
                    |             |  |              +--n-- ValueFinding
                    |             |  |              +--1-- FeasibilityAssessment --n-- FeasibilityFinding
                    |             |  |              +--n-- Risk
                    |             |  |              +--n-- Dependency
                    |             |  |              +--1-- ImplementationPlan --n-- ImplementationRequirement
                    |             |  |                                        +--n-- TimelineEstimate
                    |             |  |
                    |             |  +--n-- ImprovementRecommendation
                    |             |
                    |             v n
                    |        Evaluation --n-- CriterionScore --0..n-- ScoreOverride
                    |             |                  |
                    |             |                  +--1-- EvaluationCriterion
                    |             |
                    |             +--1-- EvaluationProfile --n-- ProfileWeight --1-- EvaluationCriterion
                    |
                    |        RankingRun 1--n RankingEntry --1-- Evaluation
                    |                              +--1-- RankingExplanation
                    |
                    +--n-- Review --1-- Idea
                    +--n-- StatusHistory --1-- Idea
                    +--n-- AuditLog

M2 (reserved at P0, unpopulated): Feedback, DemandSignal, SimilarIdea, Notification,
ExistingSolution, IdeaVersion.embedding vector(1536)
M3: KpiDefinition, KpiMeasurement, PilotRecord
```

## 5.2 Core tables (MVP1)

**`users`** — `id`, `external_subject` (unique, from IdP), `email` (unique, citext),
`display_name`, `department_id -> departments`, `is_active`. Roles live in `user_roles`
(`user_id`, `role`) — a set, not a column.

**`departments`** — `id`, `name` (unique), `parent_id -> departments` (nullable).

**`ideas`** — `id`, `submitter_id -> users` (RESTRICT), `department_id`, `category_id`,
`status` (enum, §5.4), `maturity_level` (1–5, derived), `current_version_id` (deferrable
FK), `submitted_at`. Indexes: `(status, department_id)`, `(submitter_id, created_at desc)`.

**`idea_versions`** — `id`, `idea_id` (CASCADE), `version_no` (unique per idea), `title`,
`description`, `problem_statement`, `expected_users`, `expected_outcome`; optional
`existing_process`, `existing_solutions`, `suggested_technology`, `expected_benefits`,
`estimated_cost_note`, `references`; `change_summary` (null on v1), `author_id`,
`content_hash` (sha256), `embedding vector(1536) NULL` *(reserved, M2)*.
**Content is immutable once superseded** — editing creates a version.

**`attachments`** — `id`, `idea_version_id`, `filename`, `mime`, `bytes`, `storage_key`,
`uploaded_by`.

**`ai_analyses`** — `id`, `idea_version_id` (unique per `step`), `step` (enum), `status`
(`PENDING|RUNNING|SUCCEEDED|FAILED|SKIPPED`), `provider`, `model`, `prompt_version`,
`input_tokens`, `output_tokens`, `cost_usd_micros`, `redaction_applied`, `raw_payload`
jsonb *(90-day retention)*, `error_code`, `started_at`, `finished_at`.
**This table and its children are the only place AI output lands.** No column here enters
scoring arithmetic except through `packages/scoring`.

**`ai_structured_proposals`** — 1:1 with the `STRUCTURE` step: `problem_statement`,
`proposed_solution`, `target_users`, `assumptions` text[], `missing_information` text[],
`clarification_questions` text[]. (FR-03)

**`use_cases`** — `id`, `ai_analysis_id`, `kind` (`DIRECT|INDIRECT`), `horizon`
(`SHORT|MEDIUM|LONG`), `title`, `description`, `department_scope` text[],
`estimated_user_count_band` (`LT10|10_100|100_1K|1K_10K|GT10K`), `is_speculative` —
implements FR-04's "realistic now vs. potential future" distinction.

**`value_findings`** — `id`, `ai_analysis_id`, `dimension` (9 values per FR-05), `band`
(`NEGLIGIBLE|LOW|MODERATE|HIGH|VERY_HIGH`), `rationale`, `evidence` text[].
**No numeric score column exists here.**

**`feasibility_assessments`** — `id`, `idea_version_id` (unique), `status`
(`HIGHLY_FEASIBLE|FEASIBLE_WITH_CONDITIONS|REQUIRES_INVESTIGATION|NOT_CURRENTLY_FEASIBLE`),
`summary`, `constraint_citations` text[].
**Check constraint:** `status = 'NOT_CURRENTLY_FEASIBLE'` requires non-empty
`constraint_citations` — FR-06's "avoid absolute statements unless supported by explicit
organizational constraints", made structural.

**`feasibility_findings`** — per dimension (technical, data, infrastructure, integration,
security, privacy, compliance, expertise, resources, cost, external dependency): `band`,
`finding`, `condition` (what would make it feasible).

**`risks`** — `id`, `idea_version_id`, `category` (9 per FR-10), `description`, `level`
(`LOW|MEDIUM|HIGH|CRITICAL`), `potential_impact`, `mitigation`.
**Check:** `mitigation IS NOT NULL` — FR-10 requires a mitigation for every risk.

**`dependencies`** — `id`, `idea_version_id`, `kind` (`INTERNAL|EXTERNAL|VENDOR|DATA`),
`description`, `blocking`.

**`implementation_plans`** — `id`, `idea_version_id` (unique), `effort_class`,
`cost_class` (`LOW|MEDIUM|HIGH|VERY_HIGH`), `operational_complexity`, `notes`.
**`implementation_requirements`** — `plan_id`, `kind` (`PEOPLE|TECHNOLOGY|DATA|ORG`),
`item`, `detail`, `is_mandatory`. (FR-07)
**`timeline_estimates`** — `plan_id`, `phase`
(`DISCOVERY|PROTOTYPE|MVP|TESTING|DEPLOYMENT`), `min_weeks`, `max_weeks`,
`is_preliminary NOT NULL DEFAULT true CHECK (is_preliminary)` — FR-08's labelling
requirement made structural: storing a non-preliminary AI estimate is impossible.

**`evaluation_criteria`** — `id`, `key` (unique, e.g. `business_impact`), `label`,
`description`, `group` (`VALUE|FEASIBILITY|EFFORT|STRATEGIC|RISK|DEMAND`), `direction`
(`HIGHER_IS_BETTER|LOWER_IS_BETTER`), `scale_min`, `scale_max`, `source_kind`
(`AI_FACTOR|SIGNAL|HUMAN`), `is_active`.

**`evaluation_profiles`** — `id`, `key`, `name`, `description`, `is_default`, `is_active`.
Seeded: `balanced`, `quick_wins`, `strategic_innovation`, `cost_reduction` (FR-13).
**`profile_weights`** — `profile_id`, `criterion_id`, `weight` numeric(5,4).
**Constraint:** weights of an active profile sum to 1.0000 ±0.0001, enforced by a deferred
constraint trigger — a profile can never persist in an unbalanced state.

**`evaluations`** — `id`, `idea_version_id`, `profile_id`, `engine_version`,
`composite_score` numeric(6,3), `maturity_level`, `computed_at`.
Unique `(idea_version_id, profile_id, engine_version)` — recomputation is idempotent.

**`criterion_scores`** — `evaluation_id`, `criterion_id`, `raw_band`, `normalized`
numeric(6,3) 0–100, `weight`, `contribution` (= normalized × weight), `source`
(`AI|HUMAN|SIGNAL|FALLBACK`), `confidence` (`LOW|MEDIUM|HIGH`), `rationale`,
`evidence` text[] **CHECK (cardinality(evidence) > 0)** — P-7 made structural.

**`score_overrides`** — `criterion_score_id`, `reviewer_id`, `previous_normalized`,
`new_normalized`, `reason` **NOT NULL**, `created_at`. Insert also writes `audit_log`.

**`ranking_runs`** — `id`, `profile_id`, `cohort_key` jsonb (the filter that defined the
cohort), `engine_version`, `computed_at`, `triggered_by`, `trigger_reason`.
**`ranking_entries`** — `run_id`, `idea_id`, `evaluation_id`, `rank`, `composite_score`,
`percentile`, `previous_rank` (nullable — powers rank-delta UI and `settle-rank`).
**`ranking_explanations`** — `entry_id` (unique), `strengths` jsonb, `constraints` jsonb,
`peer_comparisons` jsonb, `generated_by` (`ENGINE|ENGINE_PLUS_AI_NARRATIVE`).
**NOT NULL and non-empty** — P-2 made structural.

**`improvement_recommendations`** — `id`, `idea_version_id`, `issue`, `why_it_matters`,
`recommendation`, `how_to_implement`, `expected_effect`, `projected_ranking_effect`
(`LIKELY_UP|POSSIBLY_UP|NEUTRAL|UNKNOWN`), `target_criterion_id` (nullable), `priority`
(1–3), `status` (`OPEN|ADDRESSED|DISMISSED`), `resolved_in_version_id`.
All six FR-15 columns are `NOT NULL` — the six-part structure cannot be partially met.

**`reviews`** — `id`, `idea_id`, `reviewer_id`, `decision`
(`VALIDATED|NEEDS_CLARIFICATION|OVERRIDDEN|APPROVED_FOR_PROTOTYPE|REJECTED|PARKED`),
`comment`, `created_at`.
**Check:** `decision = 'REJECTED'` requires `comment IS NOT NULL` — FR-23's "Rejected
**with Reason**".

**`status_history`** — `idea_id`, `from_status`, `to_status`, `actor_id`, `reason`, `at`.
Every transition, no exceptions.

**`audit_log`** — §4.7. Append-only, partitioned monthly.

## 5.3 Derived, not stored

`maturity_level` (FR-17) is computed by `packages/scoring/maturity.ts` from field
completeness and evidence presence, then cached on `evaluations`. It is **independent of
`composite_score` and never feeds it** (P-5; the entire point of REQUIREMENTS §20).

## 5.4 Lifecycle state machine (FR-23)

```
DRAFT --> SUBMITTED --> AI_ANALYSIS --> EVALUATED --> RANKED --> UNDER_REVIEW
                             |                                       |
                             +--> NEEDS_CLARIFICATION <--------------+
                                         |                           |
                                         +--> SUBMITTED (new version)|
                                                                     v
        PROTOTYPE_CANDIDATE --> PILOT --> PRODUCTION_CANDIDATE --> IMPLEMENTED

Any non-terminal --> PARKED | BLOCKED | REJECTED | ARCHIVED   (reason required)
PARKED | BLOCKED --> previous state
```

The map is a data table in `packages/contracts/lifecycle.ts`: allowed transitions,
required role, whether a reason is mandatory. Illegal transitions are **inexpressible**,
not merely rejected. M1 implements through `UNDER_REVIEW` and `PROTOTYPE_CANDIDATE`; the
later states exist in the enum and stay unreachable until M3.
---

# 6. Navigation & Clickability Contract

**MUST-level, not polish.** This section is machine-readable: it is implemented as
`packages/contracts/navigation.map.ts`, consumed by **both** the router and the
`pnpm test:nav` assertions. A relationship that exists in §5 but not here is a build
failure, not a design debt.

## 6.1 Route inventory (MVP1)

| Route | Purpose | Roles |
|---|---|---|
| `/login` | OIDC entry | anonymous |
| `/` | Role-aware redirect | all |
| `/ideas` | All ideas (scoped by §4.2) | all |
| `/ideas/new` | Submission form | all |
| `/ideas/:ideaId` | Idea detail; tabs below | all (scoped) |
| `/ideas/:ideaId/overview` | Structured proposal, use cases, status | all |
| `/ideas/:ideaId/analysis` | Value, feasibility, risks, requirements, timeline | all |
| `/ideas/:ideaId/evaluation` | Criterion scores, contributions, rank + explanation | all |
| `/ideas/:ideaId/improve` | Improvement recommendations; start a revision | owner, REVIEWER, ADMIN |
| `/ideas/:ideaId/history` | Versions, status history, evaluation deltas | all |
| `/ideas/:ideaId/review` | Validate, override, comment, transition | REVIEWER, ADMIN |
| `/ideas/:ideaId/versions/:versionNo` | Frozen snapshot of one version | all |
| `/ideas/:ideaId/revise` | Create the next version from recommendations | owner |
| `/me/ideas` | My ideas | all |
| `/rankings` | Ranked board; profile selector | all |
| `/rankings/:runId` | A specific immutable ranking run | all |
| `/rankings/compare?ids=a,b` | Side-by-side comparison (2–4) | REVIEWER, ADMIN, MANAGEMENT |
| `/review` | Review queue | REVIEWER, ADMIN |
| `/dashboard` | Management overview | MANAGEMENT, ADMIN |
| `/departments/:id` | Department profile + its ideas | all |
| `/people/:userId` | Person profile + their visible ideas | all |
| `/config/criteria` | Criteria (read-only M1, editable M2) | all read; ADMIN write M2 |
| `/config/profiles` | Profiles + weights (read-only M1) | all read; ADMIN write M2 |
| `/admin/users` | Users & roles | ADMIN |
| `/admin/audit` | Audit log explorer | ADMIN |
| `/help/data-and-ai` | Data & AI notice (§4.5) | all |

## 6.2 Clickability contract — per relationship

Every row is one relationship from §5.1. **Affordance · Destination · Back-path.**

| # | Relationship | Affordance | Destination | Back-path |
|---|---|---|---|---|
| 1 | User → their Ideas | Nav item "My Ideas" | `/me/ideas` | Nav persists |
| 2 | Idea list → Idea | **Whole row clickable** (link-wrapped title, row hit-area) | `/ideas/:id/overview` | Breadcrumb `Ideas / {title}`; browser back restores filters + scroll |
| 3 | Idea → Submitter | Avatar + name chip in header | `/people/:userId` | Breadcrumb `Ideas / {title} / {person}` |
| 4 | Idea → Department | Department chip in header | `/departments/:id` | Breadcrumb; back returns to idea |
| 5 | Idea → Category | Category chip | `/ideas?category=:id` | Filter chip shown as removable |
| 6 | Idea → its tabs | **Tab bar** (Overview/Analysis/Evaluation/Improve/History/Review) | `/ideas/:id/<tab>` | Tab state in URL; back moves between tabs |
| 7 | Idea → current AiAnalysis | Analysis tab; per-step status chips | `/ideas/:id/analysis#step-<step>` | Tab bar |
| 8 | AiAnalysis → UseCase | Use-case card, expandable in place | `#usecase-<id>` on Overview | Collapse restores scroll |
| 9 | AiAnalysis → ValueFinding | Dimension row → expands rationale + evidence | `#value-<dimension>` | Collapse |
| 10 | AiAnalysis → FeasibilityAssessment | Status pill in header → jumps to section | `/ideas/:id/analysis#feasibility` | Tab bar |
| 11 | FeasibilityAssessment → Findings | Dimension list rows, expandable | `#feas-<dimension>` | Collapse |
| 12 | Idea → Risks | "Risks (n)" section; row → detail drawer | drawer over `analysis#risks` | Drawer close + Esc, focus returns to row |
| 13 | Idea → Dependencies | Section list; blocking ones flagged | `analysis#dependencies` | Tab bar |
| 14 | Idea → ImplementationPlan | "What it would take" section | `analysis#implementation` | Tab bar |
| 15 | Plan → Requirements | Grouped lists (People/Tech/Data/Org) | `analysis#req-<kind>` | Tab bar |
| 16 | Plan → TimelineEstimate | Phase bar chart; hover/focus reveals range | `analysis#timeline` | Tab bar |
| 17 | Idea → Evaluation | Evaluation tab | `/ideas/:id/evaluation` | Tab bar |
| 18 | Evaluation → CriterionScore | **Contribution bar row clickable** → expands rationale + evidence | `#criterion-<key>` | Collapse |
| 19 | CriterionScore → Criterion definition | "What is this?" link on the row | `/config/criteria#<key>` | Breadcrumb back to idea |
| 20 | CriterionScore → ScoreOverride | "Adjusted by {reviewer}" chip → override detail popover | popover; "View in audit" → `/admin/audit?entity=...` (ADMIN) | Popover close, focus returns |
| 21 | Evaluation → Profile | Profile name chip ("Scored under: Balanced") | `/config/profiles#balanced` | Breadcrumb |
| 22 | Evaluation → RankingEntry | Rank badge in the idea header | `/rankings/:runId#idea-<id>` | Breadcrumb `Rankings / {run} / {title}` |
| 23 | RankingEntry → Explanation | Always rendered inline beneath the rank; never hidden behind a click | same page | — |
| 24 | RankingEntry → peer ideas | Each peer comparison names the peer as a **link** | `/ideas/:peerId/evaluation` | Breadcrumb |
| 25 | Ranked board row → Idea | Whole row clickable | `/ideas/:id/evaluation` | Back restores profile + filters |
| 26 | Ranked board → compare | Checkbox select 2–4 → "Compare" button | `/rankings/compare?ids=` | "Back to rankings" |
| 27 | RankingRun → its entries | Run selector in `/rankings` header (current + history) | `/rankings/:runId` | Breadcrumb |
| 28 | Idea → ImprovementRecommendations | "Improve" tab; badge shows open count | `/ideas/:id/improve` | Tab bar |
| 29 | Recommendation → revision | "Apply in a new version" on each card | `/ideas/:id/revise?rec=<id>` | "Cancel" returns to Improve tab |
| 30 | Recommendation → target criterion | "Affects: {criterion}" link | `/ideas/:id/evaluation#criterion-<key>` | Tab bar |
| 31 | Idea → IdeaVersions | History tab; version timeline | `/ideas/:id/history` | Tab bar |
| 32 | IdeaVersion → snapshot | Timeline node clickable | `/ideas/:id/versions/:n` | Breadcrumb `... / History / v{n}` |
| 33 | Version pair → diff | "Compare with previous" on each node | `/ideas/:id/history?diff=n-1,n` | Close diff |
| 34 | Idea → StatusHistory | History tab, status lane | `/ideas/:id/history#status` | Tab bar |
| 35 | Idea → Reviews | Review tab (privileged) / read-only review notes on Overview for owner | `/ideas/:id/review` | Tab bar |
| 36 | Review queue row → Idea | Whole row clickable, lands **on the Review tab** | `/ideas/:id/review` | "Back to queue" + breadcrumb; queue position preserved |
| 37 | Department → its Ideas | Department page list | `/departments/:id` | Breadcrumb |
| 38 | Department → parent Department | Parent chip in header | `/departments/:parentId` | Breadcrumb chain |
| 39 | User → their Ideas (others) | Person page list | `/people/:userId` | Breadcrumb |
| 40 | Dashboard tile → filtered list | **Every tile is a link** (e.g. "Ideas requiring review → 12") | `/review` or `/ideas?status=...` | "Back to dashboard" |
| 41 | Dashboard filter → board | Filter chips carry into `/rankings` | `/rankings?department=...` | Chips removable, back restores |
| 42 | Criterion → profiles using it | "Used in 4 profiles" link | `/config/profiles?criterion=<key>` | Breadcrumb |
| 43 | Profile → its weights | Weight table rows link to criterion | `/config/criteria#<key>` | Breadcrumb |
| 44 | AuditLog entry → subject | Entity link column on every row | the entity's canonical route | "Back to audit" |
| 45 | Any AI-generated block → provenance | "AI-generated · not yet validated" chip → explains provenance | `/help/data-and-ai#provenance` | Back |
| 46 | Analysis in progress → live status | Stepper on Overview; each step chip → its section once complete | `analysis#step-<step>` | Tab bar |

## 6.3 Assertions (enforced by `pnpm test:nav`)

1. **Every entity is reachable.** For each entity type in §5.1 there is at least one route
   that renders it, reachable from a role's primary nav in ≤3 clicks. The test walks the
   map from each role's root and fails on an unreached entity type.
2. **No orphans.** Every foreign key displayed to a user is rendered as a link to its
   owner's canonical route. Lint rule: a component rendering a `*Id`-derived name without
   an `<a>`/`<Link>` ancestor fails review; the nav test asserts each row in §6.2 resolves
   to a registered route.
3. **No dead-ends.** Every route declares a `backPath`. Every modal/drawer/popover has an
   explicit close, responds to `Esc`, and returns focus to its trigger. Every empty state
   contains at least one forward action. Every error state contains a retry or a route out.
4. **Back is honest.** List → detail → back restores filters, sort, pagination, and scroll
   position (state lives in the URL, not component memory).
5. **Breadcrumbs are truthful.** The breadcrumb chain is derived from the map, not
   hand-written per page — it cannot drift from the real hierarchy.
6. **Deep links work cold.** Every route renders correctly on a fresh page load with no
   prior client state, including tab and anchor.
7. **Role-scoped reachability.** An entity may be unreachable for a role that must not see
   it — that is correct, not an orphan. The test asserts reachability **per role**, using
   the §4.2 matrix as the expectation, so a permission regression surfaces as a nav failure.

> **Consequence recorded in §16 (D-06):** deferring the admin *write* UI to M2 would have
> orphaned `EvaluationCriterion` and `EvaluationProfile` in M1. MVP1 therefore ships
> `/config/criteria` and `/config/profiles` as **read-only** screens. That is not scope
> creep; it is the cost of assertion 1.

---

# 7. Design System

## 7.1 Design Direction

**"Considered Clarity"** — the feel of a well-kept lab notebook rendered as a modern
analytical console. Calm neutral ground, one restrained accent, evidence shown as small
precise marks. Generous whitespace, because reasoning needs room to be read. Nothing in
the interface shouts, because the product's core promise is that it *evaluates* rather
than *judges* (P-1).

Three rules the direction imposes on everything below:

1. **Ink before colour.** Hierarchy comes from type weight and spacing. Colour is
   information, never decoration.
2. **Borders before shadows.** Surfaces are separated by 1px hairlines. Elevation is
   reserved for things that genuinely float (overlays).
3. **No verdict palette.** Green/red never encode idea quality. They are reserved for
   *system* state (job succeeded, destructive action). This is P-1 expressed in colour.

## 7.2 Tokens — type

Font: `Inter var`, fallback `-apple-system, "Segoe UI", Roboto, sans-serif`.
Numerals: `font-variant-numeric: tabular-nums` is **mandatory** on every score, rank,
percentage, and week range so figures align in columns and do not jitter during `tally`.

| Token | Size | Line-height | Weight | Use |
|---|---|---|---|---|
| `--fs-100` | 0.694rem / 11.1px | 1.45 | 500 | Micro-label, chip, table meta |
| `--fs-200` | 0.833rem / 13.3px | 1.45 | 400/500 | Secondary text, form help |
| `--fs-300` | 1rem / 16px | 1.55 | 400 | Body (default) |
| `--fs-400` | 1.2rem / 19.2px | 1.45 | 500 | Lead paragraph, h4 |
| `--fs-500` | 1.44rem / 23px | 1.35 | 600 | h3, card title |
| `--fs-600` | 1.728rem / 27.6px | 1.3 | 600 | h2, section |
| `--fs-700` | 2.074rem / 33.2px | 1.2 | 600 | h1, page title |
| `--fs-800` | 2.488rem / 39.8px | 1.15 | 600 | Rank / score display |

Scale ratio 1.200 (minor third). Measure capped at `68ch` for prose; `--fs-300` minimum
for any content a user must read to make a decision.

## 7.3 Tokens — colour

Light (default). Dark mode redefines the same token names; components never branch.

```css
:root {
  /* Ink ramp */
  --ink-900:#10141C; --ink-700:#333A48; --ink-500:#5A6478; --ink-400:#7C8598;
  --ink-300:#B4BCCA; --ink-200:#D9DEE7; --ink-100:#EDF0F5; --ink-050:#F7F8FB;
  --ink-000:#FFFFFF;

  /* Semantic surfaces */
  --canvas:var(--ink-050); --surface:var(--ink-000); --surface-sunken:var(--ink-100);
  --border:var(--ink-200); --border-strong:var(--ink-300);
  --text:var(--ink-900); --text-secondary:var(--ink-500); --text-tertiary:var(--ink-400);

  /* Accent — one, calm indigo */
  --accent-700:#2B3BA8; --accent-600:#3548C7; --accent-500:#4C5FDB;
  --accent-100:#E6E9FB; --accent-050:#F2F4FE;
  --focus-ring:var(--accent-500);

  /* Evidence — direction, NOT verdict. Deliberately not green/red. */
  --factor-up:#1F7A6B;      /* raises the ranking   (teal) */
  --factor-up-bg:#E4F2EF;
  --factor-down:#8A5A2B;    /* lowers the ranking   (clay) */
  --factor-down-bg:#F6EDE3;
  --factor-neutral:var(--ink-400);

  /* Score magnitude ramp — neutral to accent, no good/bad reading */
  --ramp-1:#E8EBF2; --ramp-2:#C6CEEA; --ramp-3:#9AA7DF; --ramp-4:#6B7CD2; --ramp-5:#3548C7;

  /* AI provenance (§7.4) */
  --ai-surface:#F5F2FC; --ai-border:#DCD2F2; --ai-ink:#5B4B8A;

  /* System state ONLY — never applied to an idea's score */
  --state-info:#2B6CB0; --state-warn:#B7791F; --state-ok:#2F7A4F; --state-danger:#B03A3A;
}
```

**Dark.** Three-state theming: an explicit choice stamps `data-theme` on the root; the
default "system" setting stamps nothing. Define light on bare `:root`, then redefine the
same token names — never introduce a dark-only token, and never let a component branch on
theme.

```css
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { /* ...dark... */ } }
:root[data-theme="dark"] { /* ...same dark block... */ }

/* dark values */
--ink-900:#EEF1F6; --ink-700:#D3D9E3; --ink-500:#98A2B4; --ink-400:#7A8496;
--ink-300:#4E5768; --ink-200:#333B49; --ink-100:#222935; --ink-050:#171C25;
--ink-000:#1D232E;
/* canvas=--ink-050, surface=--ink-000, sunken=--ink-100 — surface sits ABOVE canvas */

--accent-700:#8E9BFF; --accent-600:#7C8BFA; --accent-500:#9AA6FF;
--accent-100:#252C4A; --accent-050:#1E2438;

--factor-up:#5FC9B4;   --factor-up-bg:#12312C;
--factor-down:#D19A63; --factor-down-bg:#33261A;

--ramp-1:#2A3140; --ramp-2:#3C4766; --ramp-3:#55638F; --ramp-4:#6F7FBE; --ramp-5:#8E9BFF;

--ai-surface:#221E33; --ai-border:#3B3357; --ai-ink:#B6A8E0;

--state-info:#6BA6E8; --state-warn:#E0B056; --state-ok:#5FB37F; --state-danger:#E07A7A;
```

**Elevation inverts in dark.** Shadows do not read on a dark ground, so `--e-1` and `--e-2`
become `none` and separation comes from the surface step plus `--border`. `--e-3`/`--e-4`
keep a deeper black shadow, because overlays must still detach. This is the one place the
token *meaning* changes between themes, so it is stated rather than discovered.

Contrast is re-verified in dark: axe runs the full route sweep in both themes in CI.

**Feasibility statuses** use the ramp and neutral marks plus an icon and a text label —
never colour alone: `Highly Feasible` (ramp-5 dot), `Feasible with Conditions` (ramp-4 half
dot), `Requires Further Investigation` (ramp-2 dot + query glyph), `Currently Not Feasible`
(hollow dot + lock glyph). Status must survive greyscale printing and colour-blind viewing.

Contrast: body text ≥4.5:1; text ≥`--fs-500` ≥3:1; non-text UI and focus ring ≥3:1;
verified by axe in CI on every route.

## 7.4 AI provenance treatment (implements REQUIREMENTS §34)

Machine-written and human-approved content are **visually distinct at a glance**:

- **AI-generated, unvalidated** — sits on `--ai-surface` with a 1px `--ai-border` left
  rule (3px), and a `--fs-100` chip reading `AI-generated · not yet validated`.
- **Human-validated** — default `--surface`, chip `Validated by {name} · {date}`.
- **Human-overridden** — `--surface` + `--factor-*` marker on the changed value and chip
  `Adjusted by {name}` linking to the reason (§6.2 row 20).

This is a **contract, not a style**: `packages/ui` exposes exactly one `<Provenance>`
wrapper, and rendering AI-sourced fields outside it fails the nav/provenance test.

## 7.5 Tokens — spacing, radius, elevation, layout

```css
--sp-0:0; --sp-1:4px; --sp-2:8px; --sp-3:12px; --sp-4:16px; --sp-5:20px;
--sp-6:24px; --sp-8:32px; --sp-10:40px; --sp-12:48px; --sp-16:64px; --sp-20:80px;

--r-sm:4px; --r-md:8px; --r-lg:12px; --r-xl:16px; --r-full:9999px;

--e-0:none;
--e-1:0 1px 2px rgba(16,20,28,.06);
--e-2:0 2px 4px -1px rgba(16,20,28,.08), 0 1px 2px rgba(16,20,28,.04);
--e-3:0 8px 16px -4px rgba(16,20,28,.10), 0 2px 4px rgba(16,20,28,.06);
--e-4:0 16px 32px -8px rgba(16,20,28,.14);

--container:1280px; --content:960px; --prose:68ch;
--bp-sm:640px; --bp-md:768px; --bp-lg:1024px; --bp-xl:1280px;
```

Elevation rule: `--e-1` cards, `--e-2` sticky headers, `--e-3` popovers/drawers,
`--e-4` modals. Nothing else floats.

## 7.6 Component layer — shadcn/ui baseline, custom only where required

**shadcn/ui is the component system (ADR-019).** We do not build or maintain a parallel
in-house library. Components are installed into `packages/ui` — *one* shared location, not
copied per app or per feature — and themed by the §7.3 tokens.

**Baseline from shadcn/ui** (used as-is; restyled through tokens, never forked):
`Button` · `Input` · `Textarea` · `Select` · `Combobox`/`Command` · `Checkbox` · `Radio` ·
`Switch` · `Form` + `Label` · `Card` · `Tabs` · `Breadcrumb` · `Table` · `Badge` ·
`Avatar` · `Tooltip` · `Popover` · `Sheet` (drawer) · `Dialog` (modal) · `Sonner` (toast) ·
`Skeleton` · `Pagination` · `DropdownMenu` · `Accordion` · `Separator` · `ScrollArea` ·
`Alert`.

**Custom — built only because the platform genuinely needs them.** Each is domain
behaviour with no reasonable shadcn equivalent; the justification is the entry criterion:

| Component | Why no shadcn equivalent |
|---|---|
| `ContributionBar` | Weighted criterion contribution with evidence disclosure — the core explainability primitive (P-2) |
| `ScoreDisplay` / `RankBadge` | Tabular-numeral score with `tally` motion and rank-delta state |
| `Provenance` | The AI-vs-human-validated contract (§7.4); a rendering rule, not a widget |
| `ExplanationPanel` | Strengths / constraints / peer comparison composition |
| `EvidenceList` | Evidence strings bound to their criterion |
| `WeightTable` | Profile weights with sum-to-100% display |
| `Stepper` | Six-step determinate analysis progress; shadcn has none |
| `Timeline` | Version history with evaluation deltas |
| `DiffView` | Version-to-version content diff |
| `EmptyState` / `ErrorState` | Thin compositions over `Alert` that enforce the no-dead-end rule (§6.3) |
| `ClickableRow` | Thin `Table` wrapper enforcing whole-row navigation (§6.2) |

Adding a twelfth custom component requires the same justification: name the shadcn
component that does not cover it. "It was easier to write from scratch" is not one.

**shadcn's `Form` is built on `react-hook-form` + Zod** — it *is* ADR-016, not a conflict
with it. Use the shadcn `Form`/`FormField` wiring rather than a parallel `<Field>`.

**Enforcement (unchanged in intent).** `pnpm lint:tokens` fails the build when
`apps/web/src/features/**` contains a raw hex colour, a raw `px` outside a `--sp-*`
reference, or a bare `<button>`/`<input>` not imported from `@iep/ui`. The registry version
is pinned; an upgrade is a reviewed PR, because installed components are our source.

Accessibility baseline for the layer: keyboard operable, visible `2px` focus ring at
`--focus-ring` with `2px` offset, ARIA roles on every composite, `44×44px` minimum touch
target, one `<h1>` per route, skip-to-content link, live regions for async status.

## 7.7 Responsive behaviour

Minimum supported width **360px**. **The page body never scrolls horizontally** — asserted
by `pnpm test:nav` at 360/768/1280. Wide content scrolls inside its own
`overflow-x:auto` container, never the document.

| Surface | ≥1280 | 1024–1279 | 768–1023 | <768 |
|---|---|---|---|---|
| Ranked board | Full table: rank, title, composite, top strength, top constraint, feasibility, maturity, department | Drop percentile | Drop department + maturity into an expandable row | **Card list** — rank, title, composite, top strength, top constraint. Row click unchanged |
| Compare view | 2–4 columns side by side | 2–3 columns | **Criterion-major accordion**: criterion is the row, ideas are columns inside it | Same accordion, 2 ideas max |
| Idea detail tabs | Horizontal tab bar | Horizontal tab bar | Horizontal tab bar | Scrollable chip row, active tab scrolled into view |
| Dashboard tiles | 4-up | 3-up | 2-up | 1-up |
| Submission form | Single column, `--prose` | Single column | Single column | Single column |
| Drawer | Right drawer, 480px | 480px | 420px | **Full-screen sheet** with a visible close control |
| Primary nav | Persistent left rail | Persistent left rail | Collapsible, focus-trapped | Collapsible, focus-trapped |
| Criterion contribution rows | Bar + label + value inline | Inline | Inline | Label wraps above the bar |

Rules that hold at every width: comparison stays comparison (never degrades into two
independent lists); criterion labels **wrap, never truncate** — a truncated criterion name
is an unexplained score; tabular numerals are never dropped; touch targets stay ≥44×44px.

## 7.8 Frontend architecture

**SPA, no SSR.** The whole app is behind auth, SEO is irrelevant, and SSR would complicate
the session model for no user-visible gain (ADR-004).

### State ownership — three lanes, no global store (ADR-017)

| Lane | Owner | Contents |
|---|---|---|
| **Server state** | TanStack Query | Everything fetched. Query keys derived from contract types; one key factory per module |
| **Navigation / view state** | **The URL** | Filters, sort, page, active tab, selected profile, compare ids, diff range, anchors |
| **Ephemeral UI state** | Local component state | Open/closed, hover, focus, in-progress input |

**The rule: if pressing Back should restore it, it lives in the URL.** This is not a
preference — it is what makes §6.3 assertion 4 ("Back is honest") achievable at all. A
filter kept in component memory is a nav-contract failure, not a style choice.

No Redux, no Zustand, no context-as-store in M1. A fourth lane appearing is a
**stop-and-ask**, not a refactor.

### Forms (ADR-016)

`react-hook-form` + `zodResolver` bound to the **same `packages/contracts` schemas** the API
validates with — client and server cannot disagree about what is valid. One `<Field>`
primitive wires label, help text, error, and `aria-describedby`. A server `400` maps its
field paths onto form errors by path, so server-side rejections land on the right input
rather than in a toast.

### Error handling — three tiers, no dead-ends

1. **Route boundary** — every route is wrapped in an `ErrorBoundary` rendering `ErrorState`
   with a retry *and* a route out (§6.3 assertion 3 applies to crashes, not just empty lists).
2. **Panel boundary** — each independently-fetched panel owns its error state. A failed
   risk-analysis panel must not blank the idea page.
3. **Mutation** — toast with retry; optimistic updates roll back (§8.4).

Every boundary logs with the `requestId`, so a user-reported error is greppable against
server logs.

### Code-splitting

Route-level lazy loading for every top-level route, with `/admin/*`, `/config/*`,
`/rankings/compare`, and the diff view as separate chunks — they are rarely-visited and
would otherwise tax the common path. Shared vendor chunk. The ≤220KB gzip budget (§8.5) is
enforced **per route** in Lighthouse CI; a route that exceeds it fails the build.

---

# 8. Experience & Motion

## 8.1 Derivation — motion *is* the theme

"Considered Clarity" means the product reasons in the open. Motion therefore expresses
**derivation and deliberation**, never delight for its own sake. Three consequences:

1. Numbers **arrive** rather than appear — a score is the outcome of a calculation, so it
   fills, it does not pop.
2. Ranks **settle** rather than jump — rank is relative, so when the cohort changes, rows
   glide to their new positions and the movement itself teaches that ranking is comparative.
3. AI output enters **quietly**; human decisions land **crisply**. Motion carries the
   human-in-the-loop distinction (P-3) as clearly as colour does (§7.4).

## 8.2 Motion tokens

```css
--dur-instant:80ms;  --dur-fast:140ms;  --dur-base:200ms;
--dur-reveal:240ms;  --dur-slow:320ms;  --dur-settle:420ms; --dur-tally:600ms;

--ease-standard:cubic-bezier(.2,0,0,1);      /* enter/exit, default        */
--ease-out-quint:cubic-bezier(.22,1,.36,1);  /* reveals, unfolds           */
--ease-settle:cubic-bezier(.34,1.06,.64,1);  /* rank reorder, faint settle */
--ease-in-out:cubic-bezier(.4,0,.2,1);       /* looping / pending          */
--stagger:24ms;                              /* per-item list stagger      */
```

## 8.3 Named transitions (the signature language)

| Name | Where | Spec |
|---|---|---|
| `reveal-reasoning` | Explanation panels, criterion rows, evidence, feasibility findings | Height auto→content + opacity 0→1, `--dur-reveal` `--ease-out-quint`; children stagger `--stagger`, capped at 8 items then instant |
| `tally` | `ContributionBar`, `ScoreDisplay`, timeline phase bars | Bar `scaleX(0→1)` from the left, number counts up, `--dur-tally` `--ease-out-quint`. **First paint only** — never on re-render, never on scroll-back |
| `settle-rank` | Ranked board reorder after recompute or profile switch | FLIP `transform` only, `--dur-settle` `--ease-settle`, per-row stagger by rank distance (max 120ms). Moved rows carry a 1.2s `--accent-100` afterglow and a `+3 / -3` delta chip |
| `commit` | Human actions: validate, override, transition, submit | Button press-in `--dur-instant`, success check draws in `--dur-fast`, toast slides `8px` up. Deliberately short and sharp — decisions feel decisive |
| `defer` | AI content mounting, analysis step completion | Fade + `2px` rise, `--dur-base` `--ease-standard`. No scale, no bounce. AI never arrives with flourish |
| `pending-pulse` | Skeletons and in-flight steps | Opacity `.55→.85→.55`, 1800ms `--ease-in-out`. One shared animation clock so nothing shimmers out of phase |
| `journey-forward` / `journey-back` | Route change within a section | Content `12px` slide + fade, `--dur-base`; direction inferred from nav-map depth so back genuinely feels backwards |
| `provenance-shift` | AI block becomes human-validated | Background crossfades `--ai-surface`→`--surface`, chip swaps, `--dur-slow`. The one moment worth animating slowly, because it is the moment the product is about |
| `drawer` / `modal` | Overlays | Drawer `translateX` `--dur-base`; modal fade+`4px` rise `--dur-fast`; scrim fade `--dur-fast`. Focus trapped, focus restored on close |

## 8.4 Perceived performance

- **Skeletons, not spinners**, for anything with a known layout. Skeletons match the final
  layout box-for-box so nothing reflows (CLS budget below).
- **The analysis stepper is determinate and honest.** Six real steps, driven by real job
  events over SSE. No synthetic percentage. A step that fails shows as failed, with what
  the fallback supplied.
- **Optimistic UI**, with rollback + toast, for: improvement dismiss/reopen, review
  comment, checkbox select-for-compare, and draft autosave. **Never** optimistic for score
  override or status transition — those are audited decisions and must confirm server-side
  before the UI claims them.
- **Prefetch on intent**: hovering or focusing a list row for 120ms prefetches its detail
  query, so `journey-forward` usually renders against warm data.
- Draft autosave every 3s idle, with a `--fs-100` "Saved {relative time}" line.

## 8.5 Performance budget

| Metric | Budget |
|---|---|
| LCP (p75, mid-tier mobile, 4G) | ≤2.0s |
| INP (p75) | ≤200ms |
| CLS | ≤0.05 |
| Initial JS per route (gzip) | ≤220KB |
| API p95 (non-AI) | ≤400ms |
| Animation scripting per frame | ≤4ms; 60fps sustained |
| Animated properties | `transform` and `opacity` **only**; animating layout properties fails review |
| Concurrent animations | ≤3 distinct groups; exactly one FLIP reorder in flight |
| Longest non-pending animation | ≤600ms (`tally`) |

## 8.6 `prefers-reduced-motion: reduce`

Not an afterthought — a parallel definition every named transition must supply:

| Transition | Reduced-motion behaviour |
|---|---|
| `reveal-reasoning` | Instant height, 80ms opacity fade. No stagger |
| `tally` | Final value rendered immediately; bar drawn at full width |
| `settle-rank` | **No FLIP.** Rows re-render in place; moved rows get a 1500ms `--accent-100` ring + delta chip, so the information is preserved without motion |
| `commit` | Toast appears without slide |
| `defer` / `journey-*` | 80ms crossfade, no translation |
| `pending-pulse` | Static skeleton at 0.7 opacity; progress conveyed by the stepper's text and `aria-live` |
| `provenance-shift` | Instant swap |

Implementation: a single `useMotion()` hook reads the media query and returns token
values; components never write raw durations. `pnpm test:nav` asserts every named
transition has both a standard and a reduced definition.

---

# 9. Feature Acceptance Criteria

Format: `Given / When / Then`, testable. Each maps to its FR. "Done when" is never vague —
if a criterion cannot be executed by a test, it does not belong here.

## 9.1 F-01 Authentication & Access (FR-01, NFR-01)

- Given an unauthenticated request to any route except `/login`, when it is made, then the
  response is a redirect to `/login` and no data is returned.
- Given a route with no `requires` declaration, when the API boots, then boot **fails**
  with the offending route named.
- Given an EMPLOYEE and another employee's `DRAFT` idea, when they request it by id, then
  the response is `404` (not `403` — existence is not disclosed).
- Given a REVIEWER who is also the submitter, when they attempt to override a score on
  their own idea, then the write is rejected by a DB constraint and audited as a denial.
- Given each of the 40 cells in the §4.2 matrix, when exercised, then the observed result
  equals the matrix. (Table-driven test; the matrix is the fixture.)

## 9.2 F-02 Idea Submission (FR-02)

- Given the six required fields, when submitted, then a `DRAFT`→`SUBMITTED` idea with
  `version_no = 1` exists and the response is `202` with an analysis-run id.
- Given a missing required field, when submitted, then `400` with the field path, the form
  focuses the first invalid field, and no idea is created.
- Given a 21,000-character description, when submitted, then `400` and the character
  counter showed a warning from 18,000 onward.
- Given optional fields left empty, when submitted, then submission succeeds and the
  structuring step lists them under `missing_information`.
- Given a draft in progress, when the user leaves and returns within 30 days, then their
  content is restored from autosave.
- Given a `.exe` renamed to `.pdf`, when attached, then it is rejected on magic-byte sniff.

## 9.3 F-03 Analysis Pipeline & Progress (FR-03..FR-11, NFR-06)

- Given a submitted idea, when analysis starts, then the Overview shows a six-step
  determinate stepper and each step's real state, updated within 2s of the job event.
- Given analysis completes, when the user views the idea, then all of: structured proposal,
  ≥1 direct use case, all 9 value dimensions banded, a feasibility status with per-dimension
  findings, ≥1 risk each with a mitigation, an implementation plan with effort and cost
  class, and 5 timeline phases each labelled **preliminary**, are present.
- Given a `NOT_CURRENTLY_FEASIBLE` verdict, when persisted, then `constraint_citations` is
  non-empty; otherwise the write fails (FR-06).
- Given the same idea version submitted twice, when the pipeline runs, then the second run
  is short-circuited by `content_hash` and costs zero provider tokens.
- Given the provider is unreachable for 3 retries, when the run finishes, then status is
  `PARTIAL`, the idea is `NEEDS_CLARIFICATION`, fallback factors are recorded with
  `source = FALLBACK` and `confidence = LOW`, and the idea is still rankable.
- Given any AI-produced field, when rendered, then it is wrapped in `<Provenance>` with the
  unvalidated chip.

## 9.4 F-04 Evaluation & Ranking (FR-12, FR-13, FR-17)

- Given a fixture factor-set and a profile, when the engine runs twice, then both outputs
  are byte-identical (deterministic; no clock, no randomness).
- Given a profile whose weights sum to 0.98, when saved, then the transaction is rejected.
- Given a cohort of N ideas, when ranked, then ranks are `1..N` with no gaps, ties broken
  by (higher feasibility → higher maturity → earlier `submitted_at`) and the tie-break is
  stated in the explanation.
- Given the active profile changes from `balanced` to `quick_wins`, when recompute runs,
  then a **new immutable `ranking_run`** is created, previous runs remain readable, and no
  provider call is made.
- Given an idea with high long-term value and low current feasibility, when ranked under
  `strategic_innovation`, then it ranks above an equivalent quick-win idea — and the reverse
  holds under `quick_wins`. (FR-11 / REQUIREMENTS §14 made executable.)
- Given maturity level 1 and a strong composite score, when displayed, then rank and
  maturity are shown as **separate** figures and no copy implies immaturity lowered the rank.
- Given 3,000 ideas, when a full recompute runs, then it completes in ≤30s and holds no
  lock that blocks reads.

## 9.5 F-05 Explanation (FR-14, NFR-03)

- Given any `ranking_entry`, when fetched, then `strengths` and `constraints` are non-empty
  and each names a criterion, its contribution, and evidence.
- Given a rendered rank, when the DOM is inspected, then the explanation is present in the
  initial markup — **not** behind a disclosure, tooltip, or extra request.
- Given ideas ranked #4 and #7, when #4's explanation is generated, then it contains a peer
  comparison naming #7, the criteria that differ, and the direction of each difference,
  and the named peer is a working link.
- Given an explanation claim "strong scalability", when validated, then a
  `criterion_score` for scalability with `contribution > 0` exists. Faithfulness is a
  deterministic check and must pass at 100% (§11.5).
- Given the AI narrative step is disabled or fails, when an explanation is requested, then
  the engine-generated explanation renders unchanged and complete.

## 9.6 F-06 Improvement (FR-15)

- Given an idea below the attention threshold, when analysis completes, then ≥1
  recommendation exists, each with all six FR-15 parts populated.
- Given a recommendation, when rendered, then "Affects: {criterion}" links to that
  criterion row, and "Apply in a new version" opens `/ideas/:id/revise?rec=<id>`.
- Given a recommendation whose `projected_ranking_effect` is `LIKELY_UP`, when rendered,
  then the copy is explicitly conditional ("could raise…") — no guaranteed outcome is stated.
- Given a top-ranked idea, when analysis completes, then recommendations may be zero and
  the Improve tab shows an empty state **with a forward action** (§6.3 assertion 3).

## 9.7 F-07 Re-evaluation & Versioning (FR-16, FR-24)

- Given v1 exists, when the owner revises, then v2 is created with `change_summary`
  required, v1 becomes immutable, and re-analysis runs only for steps whose inputs changed.
- Given v2 is evaluated, when History is viewed, then it shows, per version: content diff,
  evaluation before/after, composite delta, rank delta, timestamp, and the acting user.
- Given a recommendation addressed in v2, when v2 is evaluated, then that recommendation's
  status is `ADDRESSED` with `resolved_in_version_id = v2`.
- Given the Version 1 #31 → Version 2 #18 → Version 3 #9 example from REQUIREMENTS §19,
  when replayed as a fixture, then the History timeline renders exactly that progression.

## 9.8 F-08 Human Review, Overrides & Audit (FR-22, FR-23, FR-29)

- Given a reviewer overrides a criterion score, when they submit without a reason, then it
  is rejected; with a reason, the score updates, `score_overrides` and `audit_log` rows are
  written in the same transaction, and the criterion row shows "Adjusted by {name}".
- Given an override, when the composite is recomputed, then `source = HUMAN` for that
  criterion and the explanation cites the human value, not the AI band.
- Given a transition not permitted for the actor's role, when attempted, then `403`, no
  status change, and a denial audit entry.
- Given `REJECTED` without a comment, when submitted, then rejected by DB constraint.
- Given any audited action, when the audit explorer is filtered to that entity, then a row
  exists with actor, action, before, after, reason, and timestamp, linking to the entity.
- Given the application DB role, when it attempts `UPDATE`/`DELETE` on `audit_log`, then
  permission is denied. (Migration test.)

## 9.9 F-09 Ranked Board & Dashboard (FR-26)

- Given ranked ideas, when the board loads, then each row shows rank, title, composite,
  top strength, top constraint, feasibility pill, maturity, department — and the whole row
  is clickable.
- Given a profile switch, when applied, then rows re-order with `settle-rank`, delta chips
  appear, and the URL carries the profile so the state is shareable.
- Given filters (department, category, status, date, rank band, profile), when applied,
  then the URL updates, and browser-back restores filters, sort, and scroll.
- Given the dashboard, when loaded, then all nine counts of REQUIREMENTS §29 are present
  and **every tile is a link** to its filtered list (§6.2 row 40).
- Given 2–4 selected ideas, when compared, then a side-by-side view shows criterion-level
  contributions and explicitly names where they diverge.

## 9.10 F-10 Configuration Visibility (FR-13, M1 read-only)

- Given any authenticated user, when they open `/config/criteria`, then every active
  criterion is listed with key, label, description, group, direction, and source.
- Given `/config/profiles`, when opened, then each profile shows its weight table summing
  to 100% and links each row to its criterion definition.
- Given M1, when a non-ADMIN attempts a write to either, then `403`; when an ADMIN attempts
  it, then `501 Not Implemented` with a pointer to M2 — the deferral is explicit, never a
  silently dead button.

---

# 10. Journey Acceptance Criteria

Journeys own the seams. Each is a BDD spec (§11.3); starred ones are also E2E (§11.4).

## J-1 ★ Employee: idea to improved idea
`/login` → `/` → `/ideas/new` → submit → Overview with live stepper → analysis completes →
Evaluation tab: rank + explanation → Improve tab: recommendation → "Apply in a new version"
→ `/ideas/:id/revise` → submit v2 → re-analysis → History: v1 #31 → v2 #18 with diff.

**Passes when:** every hop is reachable by click alone (no typed URL); the stepper reflects
real state; the rank is never shown without its explanation; the revise form is pre-scoped
to the chosen recommendation; History shows both versions with deltas; every back-step
returns to the exact prior scroll and filter state; zero dead-ends; axe clean at each hop.

## J-2 ★ Reviewer: queue to recorded decision
`/review` → row click → `/ideas/:id/review` → read AI analysis with provenance chips →
override `technical_feasibility` with a reason → composite and rank update → validate the
analysis → transition to `UNDER_REVIEW` → `/admin/audit` shows both entries →
audit row links back to the idea.

**Passes when:** override without a reason is impossible; the overridden criterion shows
"Adjusted by"; provenance visibly shifts from AI to validated (`provenance-shift`); "Back
to queue" preserves queue position; both audit entries carry before/after values.

## J-3 ★ Management: overview to compared decision
`/dashboard` → tile "Ideas requiring review (12)" → filtered list → back → `/rankings` →
filter to Operations → switch profile to `quick_wins` → rows settle with deltas → select
two → Compare → open one → Analysis tab → implementation requirements and preliminary
timeline → back to `/rankings` **with filters and profile intact**.

**Passes when:** every tile is a link; profile and filters live in the URL; `settle-rank`
runs once with no layout thrash; comparison names divergent criteria; the timeline is
labelled preliminary; back restores full state.

## J-4 Admin: from a number to the rule that produced it
`/ideas/:id/evaluation` → criterion row → "What is this?" → `/config/criteria#business_impact`
→ "Used in 4 profiles" → `/config/profiles` → weight table → breadcrumb back to the idea.

**Passes when:** the chain is fully clickable in both directions; breadcrumbs are derived
from the nav map; the read-only state is explicit, not a broken control.

## J-5 ★ Cross-entity navigation (the orphan hunt)
`/ideas/:id` → department chip → `/departments/:id` → parent department → another idea →
submitter chip → `/people/:userId` → their other idea → rank badge → `/rankings/:runId` →
peer comparison link → peer idea → breadcrumb home.

**Passes when:** no hop requires a typed URL or the browser back button; every breadcrumb
is correct; no route dead-ends; every entity type in §5.1 has been visited by the end of
J-1..J-5 combined. **This journey is the executable form of §6.3 assertions 1–3.**
---

# 11. Test Strategy

Tests are placed by **what can break**, not by convention. Logic gets TDD, flows get BDD,
and only the paths whose failure would make the product unusable get E2E.

## 11.1 Layer 1 — TDD (unit, Vitest) · written test-first

Everything here is pure, fast (<5s whole suite), and has no I/O.

| Under test | Why TDD | Gate |
|---|---|---|
| `packages/scoring` — normalisation, weighting, composite, tie-breaks, ranking, percentile | The product's correctness lives here; it is pure, so there is no excuse not to | **100% branch** + Stryker mutation score ≥80% |
| `packages/scoring/maturity.ts` | Must stay independent of composite (P-5) | 100% branch |
| `packages/scoring/explain.ts` | Faithfulness is a logic property, not a prompt property | 100% branch |
| `packages/contracts/lifecycle.ts` transition table | Illegal transitions must be inexpressible | 100% branch |
| `modules/*/policy.ts` | The §4.2 matrix, table-driven, matrix-as-fixture | 100% of matrix cells |
| `packages/ai` output validators + redaction | Untrusted-input handling | 100% branch |
| Everything else | | ≥85% lines |

Rule: no `packages/scoring` code is written before a failing test names the behaviour.

## 11.2 Layer 2 — Integration (Vitest + Testcontainers Postgres + `StubProvider`)

Per module: route → policy → service → repo → real Postgres. Plus a dedicated
**constraint suite**: every `CHECK`, unique index, and trigger declared in §5 has a test
that asserts the database rejects the invalid write. The constraints in §5 are load-bearing
(they encode FR-06, FR-08, FR-10, FR-15, FR-23, P-2, P-7) — an untested constraint is an
unenforced requirement.

## 11.3 Layer 3 — Contract tests (drift prevention)

The single mechanism that keeps parallel slices honest:

- Every request/response round-trips through its Zod schema in both directions.
- OpenAPI is regenerated in CI; a diff against the committed spec fails the build unless
  the PR carries the `contract-amend` label (§14.1).
- Frontend MSW mocks are **generated** from the same Zod schemas — a backend shape change
  breaks frontend tests immediately rather than at integration time.
- `navigation.map.ts` is asserted against the registered router table in both directions:
  a route not in the map, or a map entry with no route, fails.

## 11.4 Layer 4 — BDD (flows & journeys, Gherkin, API + component level, no browser)

J-1..J-5 from §10, plus flow specs for: analysis failure and fallback, override then
recompute, profile switch and re-rank, revise and resolve a recommendation, permission
denial paths. Fast (<60s) because they skip the browser — so they can run on every push.

## 11.5 Layer 5 — E2E (Playwright, real browser) — **4 paths only**

**J-1**, **J-2**, **J-3**, **J-5**. Seeded database, `StubProvider` for determinism, one
browser (Chromium) in CI. Budget ≤6 minutes total. J-4 stays at BDD level — it is a
navigation chain already covered by J-5's assertions.

We do not add a fifth without removing one. E2E suites rot in proportion to their size.

## 11.6 Layer 6 — Non-functional

- **Accessibility:** axe-core on every route in the nav map, zero serious/critical. Manual
  keyboard-only pass for J-1 and J-2 before each milestone sign-off.
- **Performance:** Lighthouse CI budgets (§8.5) on `/ideas`, `/ideas/:id/evaluation`,
  `/rankings`. Build fails on regression.
- **Load:** k6 — full recompute of 3,000 ideas ≤30s; 200 concurrent users at API p95 ≤400ms.
- **Security:** `npm audit` + Semgrep + `gitleaks` in CI; a `/security-review` pass before
  each milestone; the §4.6 injection suite (below) is blocking.

## 11.7 Layer 7 — AI evals (nightly + pre-release, **not** per-PR)

Non-deterministic, slow, and costly — so they never gate a PR, and they always gate a
release. Golden set and metrics in §12.4.

---

# 12. Intelligence Layer

Applies to the `[AI]` stories only. Everything in this section obeys ADR-005: **the model
produces factors and prose; it never produces a score, a rank, or a decision.**

## 12.1 Common configuration

| Concern | Setting |
|---|---|
| Provider | Anthropic Claude API via `@anthropic-ai/sdk`, behind `packages/ai`'s `AiProvider` interface |
| Model | **Tiered routing (§12.1.1), resolved at runtime from configuration — never a literal in application code** (ADR-020, ADR-021) |
| Thinking / effort | Set **per tier by the router**, not by callers (§12.1.2) — request shape differs by model family and the router normalises it |
| Output | Structured outputs — `output_config.format` with a strict JSON Schema per story; `additionalProperties: false`, closed enums, no numeric score fields anywhere |
| Streaming | `.stream()` + `.finalMessage()` on any call with `max_tokens > 8k` |
| Refusals | `betas: ["server-side-fallback-2026-07-01"]` + `fallbacks: "default"`; `stop_reason` is checked before `content` on every call, and a refusal routes to the non-AI fallback |
| Caching | The frozen system prompt + JSON Schema prefix (~2k tokens, above the ~1024 minimum) carries a `cache_control` breakpoint. Volatile content — the idea text — goes **after** it. `usage.cache_read_input_tokens` is asserted non-zero in the nightly eval; a zero means a silent invalidator crept in |
| Batching | Bulk re-analysis (prompt-version upgrade, backfill) uses the Message Batches API at 50% cost. Interactive submission never uses batch |
| Idempotency | Every call keyed on `sha256(promptVersion + model + inputPayload)`; a hit skips the call entirely |
| MCP servers | **None in MVP1.** No retrieval, no tools, no network from the model. See AI-11 for the M2 candidates |
| Budget | ≤$0.75 per idea version across all stories (measured ~$0.36 typical: ~18k input / ~11k output tokens at $5/$25 per MTok). Hard caps: per-version, per-user-daily, org-daily. Exceeding a cap fails **closed** to the fallback, never silently drops analysis |
| Persistence | Every call records model, `prompt_version`, tokens, cost, latency, and `redaction_applied` on `ai_analyses` |

### 12.1.1 Model routing tiers

Work is routed by **cognitive demand**, not by convenience. Three tiers:

| Tier | For | M1 default | Rate ($/MTok in·out) |
|---|---|---|---|
| **A — Reasoning** | Judgement under ambiguity: evaluation banding, feasibility, risk, nuanced improvement recommendations, explanation narrative | `claude-opus-5` | 5 · 25 |
| **B — Extraction** | Structured pull-out from given text: structuring, use-case identification, requirement enumeration, timeline banding | `claude-sonnet-5` | 2 · 10 |
| **C — Routine** | Classification, formatting, short summarisation, simple transformation | `claude-haiku-4-5` | 1 · 5 |

Assignment per story is in the §12.3 table. The boundary rule: **if getting it wrong would
change how an idea is treated, it is Tier A.** Extraction errors are visible and
correctable; judgement errors are not.

Revised cost per idea version: **~$0.13** (was ~$0.36 single-tier). Budget cap held at
$0.75 — headroom is deliberate, so a tier promotion never needs a budget change.

### 12.1.2 Routing is configuration, not code

`ai_model_routes` — `story_key` (PK), `tier`, `model_id`, `effort`, `max_tokens`,
`thinking_mode`, `enabled`, `updated_by`, `updated_at`. Seeded at P0, environment-
overridable, admin-editable in M2. **No model id appears as a literal anywhere in
application code** — an architecture test greps for `claude-` outside `packages/ai/routing`
and the seed, and fails the build on a hit.

Three consequences the router must own:

1. **Request shape differs by model family.** Opus 5 and Sonnet 5 take
   `thinking: {type:"adaptive"}` + `output_config.effort` and reject `budget_tokens` and
   sampling params; Haiku 4.5 takes `thinking: {type:"enabled", budget_tokens:N}` and
   **errors on `effort`**. Callers pass intent (`tier`, `story_key`); the router emits the
   correct per-model parameters. A caller that passes a model id is a bug.
2. **Attribution survives re-routing.** `model` and `prompt_version` are already persisted
   per analysis (§5.2), so changing a route never makes historical results
   unattributable — and a routing change is an audited event.
3. **Prompts are tier-portable.** A prompt must work on any model in its tier; the eval
   suite (§12.4) runs the golden set against the configured route *and* the tier above it,
   so a promotion or demotion is a config change with evidence, not a gamble.

**Escalation.** A Tier B/C call whose output fails semantic validation retries **once at
the tier above** before falling back (§12.3). Cheap-path-first with a quality floor.

## 12.2 Guardrails (all stories)

**Input.** Redaction pass (§4.5) → char caps → the idea is wrapped in a delimited
`<submitted_idea>` block introduced as *untrusted employee-authored data, not instructions*.
Operator instructions are sent through the **mid-conversation `system` message channel**
(supported on `claude-opus-5`), which keeps them outside the user turn and preserves the
cached prefix. A pre-call heuristic flags injection markers and raises `confidence` scrutiny;
it does not block, because false positives would silently drop real ideas.

**Output.** Schema validation (strict) → semantic validator: enums in range, every band
accompanied by non-empty evidence, evidence strings must be substrings-or-paraphrase-linked
to the submission, no references to instructions/scores/ranks, length caps. One retry with
the validation error appended; a second failure routes to fallback and marks the step
`FAILED`.

**Structural.** No AI output schema contains a numeric score. No code path writes AI output
to `criterion_scores.normalized`, `evaluations.composite_score`, `ranking_entries.rank`, or
any `decision` column — enforced by an architecture test (`dependency-cruiser`) that fails
the build if `packages/ai` is imported by `packages/scoring` or by a status-transition
module.

**Human gate.** Nothing the model writes advances an idea past `EVALUATED`. Provenance is
visible everywhere (§7.4).

## 12.3 Stories

| ID | Story | Tier | Pattern (lightest that works) | Non-AI fallback |
|---|---|---|---|---|
| **AI-01** | Structure the submission (FR-03) | **B** | Single call, structured output | Field-completeness heuristic → `missing_information` from empty optional fields; status `NEEDS_CLARIFICATION` |
| **AI-02** | Identify use cases (FR-04) | **B** | Single call, chained on AI-01's proposal | The submitter's own "expected users"/"example use cases" fields become one DIRECT/SHORT use case, `confidence LOW` |
| **AI-03** | Band the 9 value dimensions (FR-05) | **A** | Single call, all 9 in one structured response | All dimensions `MODERATE`, `source FALLBACK`, `confidence LOW`, evidence = "not analysed; reviewer input required"; the idea is flagged for review |
| **AI-04** | Feasibility findings + status (FR-06) | **A** | Single call. The org-constraints list is a static prompt section (cached), not retrieval | `REQUIRES_INVESTIGATION` with a per-dimension "not assessed" finding. **Never** `NOT_CURRENTLY_FEASIBLE` — the fallback may not make an absolute claim (§16 D-14) |
| **AI-05** | Risks + dependencies (FR-10) | **A** | Single call | A fixed baseline risk set by category with `LEVEL=MEDIUM` and generic mitigations, clearly marked as un-analysed |
| **AI-06** | Implementation requirements + effort/cost class (FR-07, FR-09) | **B** | Single call | Effort/cost `MEDIUM`, requirement lists empty, flagged for reviewer completion |
| **AI-07** | Preliminary timeline (FR-08) | **B** | Same call as AI-06 (one response, two schema sections — saves a round-trip) | A fixed band table keyed on `effort_class` |
| **AI-08** | Improvement recommendations (FR-15) | **A** | Single call, **input is the scoring engine's contribution vector**, not the raw idea — the model explains what the deterministic engine already found weak | Rule-based: for each criterion below the attention threshold, emit a templated six-part recommendation from a catalogue keyed on criterion + band |
| **AI-09** | Narrative polish of the explanation (FR-14) | **B** | **Optional layer only.** The engine's explanation is complete and shippable on its own; this call rewrites it into fluent prose without adding claims | The engine explanation, rendered verbatim. This is the default when AI is unavailable, and it must always be good enough to ship |
| **AI-10** *(M2)* | Similar-idea detection (FR-20) | **C** | **Not generative.** Embeddings + pgvector cosine search; the model is used only to summarise the difference between two matched ideas | Trigram/full-text similarity over title + problem statement |
| **AI-11** *(M2)* | Existing-solution detection (FR-21) | **A** | **Primary: a curated `ExistingSolution` catalogue** (internal systems + approved external tools), admin-maintained, searched by category and embedding, then one call to compare the idea against the top matches. **No MCP on the critical path.** *Optional enrichment:* Atlassian Rovo (Confluence) / Microsoft 365 (SharePoint/Graph), **read-only scopes, no write tools**, output inserted as delimited untrusted DATA, never as instructions — behind a feature flag, degrading to catalogue-only when absent. See the P12 risk note | Catalogue lookup by category surfaced to the reviewer, with no model call at all |

**Tool/CLI classification** (per the gating rule — read is free, mutating and irreversible
are gated):

| Capability | Class | Gate |
|---|---|---|
| Read idea version, criteria, profiles | read | none |
| Capability-catalogue search (M2) | read | none |
| Write `ai_analyses` + children | mutating | worker service account only; never from the API process |
| Populate the embedding index (M2) | mutating | worker only, idempotent by `content_hash` |
| Trigger a full ranking recompute | mutating | ADMIN action, confirmation dialog, audited |
| Prompt-version bump + backfill | mutating, wide blast radius | ADMIN + batch job + dry-run diff report first |
| Database migration | **irreversible** | CI only, reviewed migration, backup verified before apply |
| Purge raw AI payloads past retention | **irreversible** | scheduled job, dry-run count logged, ADMIN-approved |

## 12.4 Evals — golden set + metrics

**Golden set:** 40 idea submissions, human-labelled by two annotators with disagreements
resolved: 10 strong and detailed, 10 vague/underspecified, 10 clearly infeasible under
stated constraints, 10 near-duplicates of each other. Plus **25 adversarial submissions**
containing prompt-injection attempts, PII, and schema-confusing text.

| Metric | Target | Blocking |
|---|---|---|
| Schema validity (first attempt) | 100% | release |
| Use-case extraction F1 vs. human labels | ≥0.80 | release |
| Value-dimension band exact match | ≥0.70; within-one-band ≥0.95 | release |
| Feasibility status exact match | ≥0.75; within-one-band ≥0.95 | release |
| Risk recall (labelled risks found) | ≥0.80 | release |
| **Explanation faithfulness** (every claimed strength maps to a real `contribution > 0`) | **100%** — deterministic check, not a judgement | **PR + release** |
| Injection escapes (any output field influenced by injected text) | **0 / 25** | **PR + release** |
| PII leakage to provider (redaction suite) | **0** | **PR + release** |
| Cost per idea version | ≤$0.75 | release |
| Prompt-cache hit rate on the frozen prefix | ≥90% | warn |
| Fallback path produces a rankable idea | 100% | release |

The three PR-blocking metrics are deterministic and cheap, so they run on every PR; the
model-dependent ones run nightly and gate releases (§11.7).

---

# 13. Architecture Decision Records

**Once recorded, LOCKED.** Changing one requires a new ADR that explicitly supersedes it,
announced before any code is written. Full records live in `docs/adr/`.

| ADR | Decision | Why chosen | Alternatives considered | Tradeoffs accepted |
|---|---|---|---|---|
| **000** | Working codename **IEP**; rename is one find/replace | Naming should not block P0 | Wait for a brand name | A rename PR later |
| **001** | TypeScript monorepo (pnpm + Turbo), one language end-to-end | Shared Zod contracts across FE/BE/worker is the drift-prevention mechanism parallel phases depend on | Python API (better AI ecosystem — but the AI surface is one HTTP client, not a research stack); polyglot services | No Python data-science tooling; Node CPU limits on heavy math — irrelevant at 3k ideas |
| **002** | PostgreSQL 16 + Prisma | Relational data with hard invariants (§5) that we want the DB to enforce; `pgvector` available for M2 without a second datastore | MongoDB (rejected: our constraints are the product); Postgres + Drizzle (closer to SQL, weaker migration ergonomics for a team) | Prisma's abstraction can obscure query plans; raw SQL escape hatch confined to `packages/db` |
| **003** | Fastify + Zod; OpenAPI **generated** from Zod | One schema authority. Hand-maintained OpenAPI drifts; generated cannot | NestJS (more structure, more ceremony); Express (unopinionated, slower); tRPC (rejected: we want a real OpenAPI contract for P0 freeze) | Fastify plugin ecosystem is smaller |
| ~~**004**~~ | ~~In-house `packages/ui` primitive library~~ | — | — | **SUPERSEDED BY ADR-019.** Retained for history; do not implement |
| **005** | **AI emits factors; a deterministic engine emits scores.** No numeric score in any AI schema | REQUIREMENTS §35 verbatim, and the only way explainability, testability, cheap re-weighting, and injection resistance are all achievable at once | LLM-as-judge scoring (cheaper to build, unexplainable, non-reproducible, injectable); hybrid with AI-suggested weights (weights are org policy, not model output) | The factor→criterion mapping is hand-authored config we must maintain |
| **006** | **Explanations are generated deterministically** from the contribution vector; AI narrative is an optional polish layer | An explanation must be *true by construction*, not plausible. Also removes an AI call from the critical path and makes faithfulness a 100% deterministic check | AI-generated explanations (fluent, unverifiable, can cite factors that did not move the score) | Baseline prose is more templated; mitigated by AI-09 |
| **007** | BullMQ + Redis; one job per analysis step; idempotent by `content_hash` | NFR-06 requires async with progress; per-step jobs give real determinate progress, partial-failure recovery, and free deduplication | Synchronous request (rejected: minutes-long HTTP); pg-boss (one less service, weaker tooling); Temporal (right shape, far too heavy here) | A second stateful service to operate |
| **008** | Rankings are **immutable snapshot runs**, not live values | Rank is relative and changes when *other* ideas change. A stored snapshot makes "Version 2: Rank #18" historically true, makes deltas computable, and makes ranking auditable | Compute rank on read (cheap, but no history, no deltas, no audit); materialised view (no per-run provenance) | Storage growth (bounded: 3k rows/run, pruned to monthly after 90 days) |
| **009** | Two-layer RBAC: declarative route permissions + resource policy + repo scope filter, deny by default, boot fails on undeclared routes | Most authz bugs are omissions; make omission impossible rather than reviewable | Middleware-only (leaks via list endpoints); Postgres RLS (strong, but splits policy across two languages and complicates testing) | Slight boilerplate per route |
| **010** | Audit via repository interceptor + transactional outbox; append-only table with no UPDATE/DELETE grant | An audit entry that can be forgotten will be; one that can be edited is not an audit | Service-layer manual writes (forgettable); DB triggers (invisible in code review, no actor context) | All writes route through repositories |
| **011** | `AiProvider` interface with `AnthropicProvider` + `StubProvider` | NFR-07 provider swap, and deterministic tests/E2E without spending tokens | Direct SDK calls (untestable, unswappable); LangChain (heavy abstraction over one HTTP call) | A thin interface to maintain |
| **012** | Reserve `embedding vector(1536)` and the M2/M3 tables **at P0**, unpopulated | Adding a vector column and backfilling 3k rows later is a migration with downtime; reserving it costs nothing now | Add in M2 (rejected: known-future schema change to a frozen contract) | A nullable column carried for a milestone |
| ~~**013**~~ | ~~`claude-opus-5` for every AI story~~ | — | — | **SUPERSEDED BY ADR-020.** Retained for history; do not implement |
| **014** | Feature-flag milestones; trunk-based development; no long-lived branches | Parallel phases must integrate continuously or the P0 freeze buys nothing | GitFlow release branches (merge pain across parallel slices) | Flag hygiene discipline; flags removed at milestone close |
| **015** | Plain-text rendering only in M1 (no rich text, no HTML) | Eliminates stored XSS as a class rather than sanitising it | Sanitised HTML (a permanent sanitiser-maintenance obligation); Markdown subset (M2 candidate) | Ideas cannot be formatted; acceptable for M1 |
| **016** | `react-hook-form` + `zodResolver` bound to the **same** `packages/contracts` schemas | Client and server cannot disagree about validity, because there is one schema. Server `400` field paths map straight onto form errors | Formik (heavier, no first-class Zod path); uncontrolled + manual validation (a second, divergent copy of every rule); native constraint validation (no cross-field rules) | RHF's uncontrolled model needs care with the `Combobox` primitive |
| **017** | Three state lanes — server→TanStack Query, navigation/view→**URL**, ephemeral→local. **No global store** | "If Back should restore it, it lives in the URL" is what makes the §6.3 back-path assertion achievable; a global store makes it optional, and optional means it will not happen | Redux Toolkit / Zustand (a fourth lane that quietly absorbs URL state); React Context as store (re-render breadth, same failure mode) | Some prop-drilling; verbose URL search params on the ranked board |
| **019** | **shadcn/ui (Radix + Tailwind) as the component system**, installed into `packages/ui`; custom components only where the platform needs behaviour shadcn does not cover (§7.6 justifies each of the 11) · **Supersedes ADR-004** | A maintained, accessible, unstyled-by-default Radix baseline delivers the same token control as an in-house layer without the cost of authoring and maintaining ~25 commodity primitives. shadcn's `Form` is `react-hook-form` + Zod, which is already ADR-016 | In-house library (ADR-004 — rejected: real cost, no differentiation on commodity widgets); MUI/Chakra/Ant (opinionated themes to fight); Radix primitives raw (shadcn already is this, plus sane defaults) | Installed components are **our source**: registry pinned, upgrades are reviewed PRs. Divergence risk is contained by keeping one install location and the §7.6 justification bar for anything custom |
| **020** | **Tiered model routing** by cognitive demand — Tier A reasoning / B extraction / C routine (§12.1.1) · **Supersedes ADR-013** | Extraction and judgement are different problems with different error costs. Routing cuts cost ~64% while keeping the highest-capability model exactly where a wrong answer would change how an idea is treated | Single high-capability model (ADR-013 — simple, but pays reasoning rates for pure extraction); single cheap model (fails the judgement-heavy stories); per-call ad-hoc choice (unauditable drift) | Two extra model behaviours to validate; handled by tier-portable prompts and the §12.4 cross-tier eval |
| **021** | **Model selection is runtime configuration** (`ai_model_routes`), never a code literal; the router normalises per-model request shape | "Configurable without modifying the core application" is only true if a model change is a config edit. An architecture test enforces it — a grep for `claude-` outside the routing package fails the build | Env vars only (no per-story granularity); constants in code (the thing being prohibited); a config file (no audit trail, no admin UI path) | The router must encode per-model API differences (adaptive thinking + `effort` vs. `budget_tokens`); one place, tested |
| **018** | SPA with route-level code-splitting; **no SSR** | Entirely behind auth, so SEO is moot; SSR would complicate the session model for no user-visible gain. Splitting is how the ≤220KB per-route budget is actually met | Next.js SSR/RSC (real gains for public pages — we have none); single bundle (blows the budget on first paint) | Slower cold first paint than SSR; mitigated by the budget and prefetch-on-intent |

---

# 14. Phases & Milestones

Every phase lists **Depends on:** the exact entities, contracts, or services it needs. A
phase whose dependencies are all met is **parallel-safe**. Hidden dependencies are how
parallel work breaks, so they are written down or they do not exist.

## Phase 0 — Contract Freeze · **BLOCKING** · M0

Nothing else starts. Not "mostly starts" — nothing.

**Deliverables (all frozen on sign-off):**
1. Prisma schema: every M1 entity in §5, plus the reserved M2/M3 tables and
   `idea_versions.embedding` (ADR-012). Migration applies cleanly to an empty DB.
2. `packages/contracts`: Zod schemas for every request/response; shared enums (status,
   role, band, feasibility status, risk category, criterion group, timeline phase);
   `lifecycle.ts` transition table; `navigation.map.ts` (§6); error-code catalogue;
   `env.ts` boot validation schema.
3. Generated OpenAPI, committed, with the CI diff gate live.
4. Design tokens (§7.2–7.5) as CSS custom properties + Tailwind config + motion tokens
   (§8.2) — **both light and dark palettes**, every `prefers-reduced-motion` variant (§8.6),
   and the responsive rules (§7.7) as breakpoint utilities.
5. `packages/ui`: shadcn/ui installed and **registry version pinned**, §7.3 tokens mapped
   onto shadcn's CSS theme variables (both themes), and the 11 custom components (§7.6)
   frozen as typed prop signatures + stories. Implementations are P1 work.
5b. `ai_model_routes` seed (§12.1.2): tier per story, model id, effort/thinking mode,
   max tokens — plus the architecture test that fails the build on a `claude-` literal
   outside `packages/ai/routing`.
5c. Frontend architecture decisions live (§7.8): the TanStack Query key factory, the URL
   search-param schema per route (Zod-validated, so filters are a contract too), the
   `ErrorBoundary` + `ErrorState` wiring, and the `<Field>`/`react-hook-form` binding.
   These are contracts between parallel UI slices exactly as the API schemas are.
6. AI output JSON Schemas for AI-01..AI-08, with the "no numeric score" architecture test
   in place and passing.
7. Criterion catalogue (keys, groups, directions, source kinds) + the four seeded profiles
   with balanced weights.
8. Engine interfaces: `evaluate()`, `rank()`, `explain()`, `classifyMaturity()` — signatures
   and fixture types only.
9. Fixture corpus: 12 canonical ideas with hand-authored factor sets, spanning strong /
   vague / infeasible / long-term-strategic. Every downstream phase tests against these.
10. CI skeleton: typecheck, lint, `lint:tokens`, unit, contract-diff, architecture test.

**Depends on:** nothing.
**Exit criteria:** items 1–10 merged; `pnpm build && pnpm test && pnpm test:nav` green on
an empty database; contracts package tagged `v1.0.0`; **explicit human sign-off**.

### 14.1 Contract amendment process (after freeze)

- **Additive and backward-compatible** (new optional field, new enum member, new route, new
  token): PR labelled `contract-amend`, updates *all* consumers in the same PR, bumps the
  contracts minor version, appends a line to `docs/adr/CONTRACT-LOG.md`. No stop.
- **Breaking** (removed/renamed field, changed type, changed semantics, changed nav
  relationship): **STOP and ask.** Requires a superseding ADR before any code.

---

## Milestone M1 — MVP1

> **Gate:** M1 is complete only when J-1..J-5 all pass end to end and the product is a
> real, usable, navigable thing on its own. No M2 line is written before that.

### Phase 1 — Identity, Access & App Shell
OIDC login, session, `user_roles`, department sync, the two-layer policy engine (§4.2),
route registration guard, app shell (nav, breadcrumbs from the map, role-aware routing),
shadcn/ui themed to the tokens, and the 11 custom components (§7.6) implemented. **Scope reduced by ADR-019** — ~25 commodity primitives are no longer authored.
**Depends on:** P0 — `users`/`departments` schema, Auth + session contracts, `Permission`
enum, `navigation.map.ts`, design + motion tokens, `packages/ui` signatures.
**Parallel-safe:** yes, immediately after P0.
**Demo:** four seeded users log in and each sees a correctly scoped, navigable empty shell.

### Phase 2 — Idea Capture & Lifecycle
Submission form, draft autosave, attachments, `ideas`/`idea_versions`, the lifecycle state
machine, `status_history`, `/ideas`, `/me/ideas`, idea detail shell with tabs.
**Depends on:** P0 — idea schemas, lifecycle table, nav map · P1 — session, `users`, policy
middleware, app shell, `ui` primitives.
**Parallel-safe:** after P1.
**Demo:** submit an idea, see it listed and openable; illegal transitions rejected.

### Phase 3 — AI Analysis Pipeline
Worker, BullMQ topology, `AiProvider` + `AnthropicProvider` + `StubProvider`, prompts and
schemas for AI-01..AI-07, redaction, validators, retries, `PARTIAL` handling, fallbacks,
SSE progress, the six-step stepper.
**Depends on:** P0 — `idea_versions` schema, AI output schemas, `AiProvider` interface,
fixture corpus · P2 — real `idea_versions` rows *(can be developed against the P0 fixture
corpus and integrated when P2 lands — start in parallel, integrate after)*.
**Parallel-safe:** partially — build against fixtures from day one; wire to P2 at the end.
**Demo:** submitted idea produces a full analysis with live progress; kill the provider and
watch the fallback keep the idea rankable.

### Phase 4 — Evaluation & Ranking Engine
`packages/scoring`: factor→criterion mapping, normalisation, weighting, composite, maturity,
tie-breaks, cohort ranking, immutable runs, recompute trigger.
**Depends on:** **P0 only** — criterion catalogue, factor types, profile schema, engine
interfaces, fixture corpus.
**Parallel-safe:** **yes — fully parallel with P1, P2, and P3.** This is a pure package with
no I/O; it is the largest chunk of genuinely independent work and should start on day one
of M1.
**Demo:** feed the 12 fixtures, get a reproducible ranking; switch profiles, watch the order
change, with no provider call.

### Phase 5 — Explanation & Improvement
Deterministic explanation engine (strengths, constraints, peer comparison), the
`ExplanationPanel`, AI-08 improvement recommendations, AI-09 optional narrative, the Improve
tab.
**Depends on:** P0 — explanation/recommendation schemas · P4 — contribution vector *(hard
dependency)* · P3 — for AI-08/AI-09 only; the engine path ships without it.
**Parallel-safe:** after P4's engine interfaces are implemented.
**Demo:** every rank displays with a true explanation; a weak idea shows six-part recommendations.

### Phase 6 — Human Review, Overrides & Audit
Review queue, review tab, score override with mandatory reason, recompute-on-override,
validation and provenance shift, status transitions, `audit_log` interceptor + outbox,
`/admin/audit`.
**Depends on:** P0 — review/audit schemas · P1 — roles + policy · P2 — lifecycle machine ·
P4 — `criterion_scores` to override.
**Parallel-safe:** after P4.
**Demo:** J-2 end to end.

### Phase 7 — Ranked Board & Management Dashboard
`/rankings`, profile selector, `settle-rank` reorder with deltas, filters in the URL,
compare view, `/dashboard` with nine linked tiles.
**Depends on:** P4 — ranking runs · P5 — explanations · P2 — idea list/detail · P1 — shell.
**Parallel-safe:** after P5.
**Demo:** J-3 end to end.

### Phase 8 — Re-evaluation & Version History
Revise flow from a recommendation, version diff, selective re-analysis by changed inputs,
evaluation before/after, rank delta timeline, recommendation resolution.
**Depends on:** P2 — versioning · P3 — re-run · P4 — deltas · P5 — recommendation linkage.
**Parallel-safe:** after P5.
**Demo:** the REQUIREMENTS §19 progression (#31 → #18 → #9) rendered from real data.

### Phase 9 — Config Viewer (read-only) & M1 Hardening
`/config/criteria`, `/config/profiles` (read-only — closes the orphan identified in §16
D-06), `/help/data-and-ai`, `501` stubs for M2 writes, plus: full axe pass, Lighthouse
budgets, k6 load run, security review, the injection and redaction suites, and the J-1..J-5
walkthrough.
**Depends on:** P0 — criteria/profile schemas · P1 — shell · and, for the walkthrough, all
of P2–P8.
**Parallel-safe:** the config viewer is parallel-safe immediately after P1; the hardening
sub-phase is the M1 gate and runs last.
**Demo:** the M1 sign-off walkthrough.

## Milestone M2 — Signals, Duplication & Configuration
**P10** Admin write UI (criteria, profiles, categories, statuses, users, **`ExistingSolution` capability catalogue** — a P12 prerequisite) · *Depends on: P9
read-only screens, P1 policy, P0 config schemas.*
**P11** Feedback types + demand signals wired as ranking inputs · *Depends on: P4 engine
(`SIGNAL` source kind already exists at P0 — no engine change needed).*
**P12** Duplicate detection (embeddings, pgvector — column reserved at P0) and existing-
solution / build-vs-buy detection · *Depends on: P0 embedding column, P3 pipeline, and a
populated `ExistingSolution` catalogue (P10 admin screen).*

> **P12 risk note — external connectors are off the critical path (deliberate).**
> FR-21 is satisfied by the curated `ExistingSolution` catalogue alone. MCP retrieval
> (Atlassian Rovo, Microsoft 365) is **optional enrichment behind a feature flag**, for
> three reasons: (a) authorising a connector that reads Confluence/SharePoint is an
> IT/security approval — an organisational dependency we do not control, and not one to
> put on a delivery path; (b) retrieval would put internal document content into a model
> call, which changes the §4.5 privacy notice and requires re-consent, not a config edit;
> (c) a reviewed catalogue is a better source for a build/buy recommendation someone will
> act on than a wiki search hit (P-9). **If the connectors are never authorised, P12 ships
> complete.** Their tool surfaces are currently unverified assumptions — confirm the actual
> tools and scopes before designing against them.
**P13** Notification centre + email · *Depends on: P2 lifecycle events, P6 review events.*
**P14** Analytics & reporting · *Depends on: P4 runs, P8 version history, P6 audit.*

## Milestone M3 — Outcomes
**P15** Prototype & pilot tracking (unlocks the remaining lifecycle states) ·
**P16** KPI definition, actual-vs-predicted, ROI · **P17** Internal integrations.

---

# 15. Definition of Done

A phase is `[x]` only when **every** line is true:

1. `pnpm build` succeeds for all packages.
2. `pnpm smoke` passes — the stack boots, `/health` is green, the nav map walks clean.
3. `pnpm test`, `pnpm test:bdd`, and (where the phase touches an E2E path) `pnpm test:e2e`
   are green. Coverage gates in §11.1 met.
4. **Navigation links work** — every §6.2 relationship the phase introduces resolves;
   `pnpm test:nav` green; no orphans, no dead-ends, back-paths honest.
5. `pnpm lint`, `pnpm lint:tokens`, and `pnpm typecheck` clean. No raw hex, no raw px, no
   feature-local component that belongs in `packages/ui`.
6. axe clean on every route the phase adds or changes; keyboard-only path verified.
7. Every acceptance criterion in the phase's §9 feature block is covered by a named test.
8. Any new AI story has its guardrails, evals, and non-AI fallback implemented — not
   planned. The fallback is demonstrated by disabling the provider.
9. Contract changes, if any, went through §14.1 and are logged.
10. Demoed to a human against the phase's stated demo. Then stop for review.

---

# 16. Decisions Log — devil's-advocate pass

One adversarial pass was run against every MUST before finalising. Each entry records the
challenge, the strongest counter-argument, and the outcome. **Amendments are recorded here,
not silently applied** — where the challenge won, the change is named and the section that
changed is cited.

**Outcome key:** `UPHELD` · `AMENDED` (survives, but changed) · `DEFERRED` (correct, but
not in M1) · `REJECTED`.

| ID | MUST challenged | The challenge | Counter-argument | Outcome |
|---|---|---|---|---|
| **D-01** | SPEC is the single source of truth; SPEC wins on conflict | A spec that outranks the requirements doc can quietly drift from what the business actually asked for | True, and that is exactly why §1.4 exists: every FR/NFR is mapped to a milestone, so drift is visible as a coverage gap rather than hidden in prose | **UPHELD** — with the §1.4 coverage matrix added as the anti-drift mechanism, and a rule that any narrowing of a requirement must appear in this log or an ADR |
| **D-02** | AI must never label an idea good/bad, and must never decide | This is usually a policy statement that dies in review. A prompt instruction is not an architecture | Correct — so it is not a prompt instruction. §12.2 and ADR-005 make it structural: no numeric score exists in any AI schema, and `dependency-cruiser` fails the build if `packages/ai` is imported by `packages/scoring` | **UPHELD, strengthened** — moved from prompt-level to build-level enforcement |
| **D-03** | Every score and rank must carry an explanation | If the explanation is AI-generated, it will sometimes cite factors that did not actually move the score. A plausible lie is worse than a bare number | Decisive. Explanations are now generated deterministically from the contribution vector, with the AI reduced to optional prose polish | **AMENDED** — ADR-006 added; faithfulness became a 100% deterministic, PR-blocking check (§12.4) rather than an eval target |
| **D-04** | Ranking must be relative to other ideas (FR-12) | Relative ranking means an idea's position changes when *other* ideas change. "Version 2: Rank #18" is then meaningless, and every recompute invalidates every displayed rank | Right. Ranks became immutable snapshot runs (ADR-008): each run records profile, cohort, engine version, and `previous_rank`. History is true, deltas are computable, and the UI's `settle-rank` motion (§8.3) teaches users that rank is comparative | **AMENDED** — `ranking_runs`/`ranking_entries` replaced a live rank column; §9.4 gained the recompute performance criterion |
| **D-05** | Every entity reachable, no orphans, no dead-ends | Unachievable as stated: `audit_log` must not be reachable by an employee, and reachability for one role is unreachability for another | Fair. The assertion is now **per role**, evaluated against the §4.2 matrix, so an intentional restriction reads as correct and an accidental one reads as a nav failure | **AMENDED** — §6.3 assertion 7 added; the contract is enforceable rather than aspirational |
| **D-06** | Admin configuration write UI can be deferred to M2 | Deferring it orphans `EvaluationCriterion` and `EvaluationProfile` in M1 — and worse, it makes every score in MVP1 unexplainable at the source ("what *is* business impact, and what weight did it carry?") | The write UI is genuinely deferrable; the **visibility** is not, because it underwrites explainability (NFR-03) | **AMENDED** — M1 ships `/config/criteria` and `/config/profiles` as read-only screens (P9); M2 adds writes (P10). M1 write attempts return an explicit `501`, never a dead button |
| **D-07** | Phase 0 freezes schemas, contracts, types, tokens, and the nav map before anything starts | Freezing the full data model before writing a line of feature code is waterfall. We will learn things in P3 that invalidate P0 | Partly right. So P0 freezes the **contract surface** — shapes, names, relationships, enums — not every implementation detail, and §14.1 defines an explicit additive-amendment path that does not require stopping. Only breaking changes stop the line | **AMENDED** — §14.1 amendment process added; without it, "frozen" would have meant "routinely violated in silence" |
| **D-08** | MVP1 must be a real, usable, end-to-end product | The §37 MVP list has 18 items. Built literally, first delivery is far out and the "usable product" test gets met on paper, not in practice | Held, but re-sequenced rather than cut (see the scoping-gate output). Moved out of M1: admin write UI, full FR-07 requirement breakdown, notifications, analytics. Kept in M1: everything the J-1 loop touches, because an evaluation platform that cannot re-evaluate is a demo | **UPHELD via re-sequencing** — nothing dropped; §1.4 proves it |
| **D-09** | One component layer, no one-offs | Every project says this and every project ends up with feature-local styling. A convention with no enforcement is a wish | Agreed, so it is mechanised: `pnpm lint:tokens` fails the build on a raw hex, a raw px, or a bare `<button>`/`<input>` inside `features/**` | **UPHELD, strengthened** — §7.6 enforcement paragraph added |
| **D-10** | A signature motion language, "cinematic" | Motion on an analytical tool is usually decoration that slows people down, and a "signature language" is how animation budgets get blown | Legitimate risk. Motion was therefore derived from the theme and made to carry information: `tally` shows a score being computed, `settle-rank` shows that rank is relative, `provenance-shift` shows AI becoming human-validated. Anything that carried no information was cut, and §8.5 caps it | **AMENDED** — scope narrowed to nine named, informational transitions; a hard performance budget and a full reduced-motion parallel definition (§8.6) added |
| **D-11** | Timeline and cost estimates are AI-generated (FR-08, FR-09) | An LLM's week-range for work in *this* organisation is close to fiction, and users will treat printed numbers as commitments | Real, and unfixable by prompting. Mitigated three ways: `is_preliminary` is a `CHECK`-enforced always-true column (storing a non-preliminary AI estimate is impossible), estimates are ranges not points, and they are reviewer-editable. Coarse classes (Low/Med/High/Very High) carry the ranking weight; week ranges are display-only in M1 | **AMENDED** — timeline contributes to ranking only through `effort_class`, never through raw weeks |
| **D-12** | Feasibility must avoid absolute statements unless supported by explicit organisational constraints (FR-06) | Nothing stops the model from returning `NOT_CURRENTLY_FEASIBLE` with a hand-wave, and that verdict can kill a good idea | Correct, so it is a database constraint: that status cannot be stored without non-empty `constraint_citations`. And the non-AI fallback may **never** emit it (§12.3, AI-04) | **UPHELD, strengthened** — moved from prose guidance to a `CHECK` constraint |
| **D-13** | Every low-ranked idea must receive improvement recommendations (P-4) | Force-generating recommendations for an idea that is simply well-formed-but-low-value produces condescending noise and trains people to ignore the feature | Fair. The trigger is a configurable attention threshold, not "low rank", and recommendations are generated from the **contribution vector** (which criterion is actually weak), not from the raw idea. A strong idea legitimately gets zero, with an empty state that still offers a forward action (§9.6) | **AMENDED** — threshold made configurable; zero recommendations became a valid, tested outcome |
| **D-14** | E2E on 3–5 critical paths only | Four E2E paths cannot cover 29 functional requirements; this will feel like thin coverage at review time | It is meant to. Coverage lives at layers 1–4 (§11), which are fast and stable; E2E exists only to prove the seams hold in a real browser. A large E2E suite is a slow, flaky suite that gets skipped | **UPHELD** — J-4 was deliberately demoted from E2E to BDD to hold the line at four |
| **D-15** | Duplicate detection is deferred to M2 | Deferring the *feature* is fine, but the schema is not deferrable: adding a `vector(1536)` column and backfilling later is a migration against a frozen contract | Accepted immediately | **AMENDED** — ADR-012: `idea_versions.embedding` and the M2/M3 tables are created empty at P0 |
| **D-16** | `claude-opus-5` for every AI story | A cheaper tier would cut the per-idea cost meaningfully, and much of this work is extraction | The delta is roughly $0.20 per idea version against evaluations that shape whether someone's idea is taken seriously — the wrong place to economise. Cost is controlled instead by prompt caching, `content_hash` deduplication, and the Batch API for bulk re-runs, and capped per version and per org | **UPHELD** — with §12.1 budget caps that fail closed to the fallback rather than silently degrading |
| **D-17** | The evaluation engine must be fully configurable (FR-13, P-6) | Full configurability usually means an under-specified rules engine nobody can reason about | Bounded deliberately: configurable means *criteria, weights, profiles, and thresholds as data*. It does **not** mean user-authored formulas. The composite stays additive-weighted, which is what makes §17-style explanation possible at all | **AMENDED (scoped)** — "configurable" defined narrowly in P-6; arbitrary formula authoring recorded as out of scope |
| **D-18** | No requirement may be dropped | Milestone assignment is where requirements quietly die — M3 is a graveyard | Which is why §1.4 is a complete matrix rather than a narrative, every row names a phase, and the M1 gate is a journey walkthrough rather than a checklist | **UPHELD** — with the standing rule that removing a row from §1.4 requires the same sign-off as a breaking contract change |

## 16.1 Supersessions — decisions reversed by the architecture lock

Recorded, not rewritten. The original entries above stand as history; these state what
changed, why, and what survived.

| ID | Supersedes | What changed | What was preserved |
|---|---|---|---|
| **D-09a** | D-09 (*one in-house component layer, no one-offs* — UPHELD) | **Reversed on the library, not the principle.** shadcn/ui is now the baseline (ADR-019); we no longer author ~25 commodity primitives | The *anti-drift* half of D-09 is intact and is what mattered: one install location (`packages/ui`), `lint:tokens` still fails on raw hex/px and on bare `<button>`/`<input>` in `features/**`, and every custom component must name the shadcn component that fails to cover it (§7.6). D-09's real target was per-feature one-offs, and that is still prohibited |
| **D-16a** | D-16 (*`claude-opus-5` for every story* — UPHELD) | **Reversed.** Tiered routing by cognitive demand (ADR-020). My counter-argument — that ~$0.20/idea is the wrong place to economise — was answered better than I answered it: the saving is real (~64%, $0.36 → $0.13) *and* the highest-capability model still runs every story where a wrong answer changes how an idea is treated. Extraction and judgement are different problems; I had treated them as one | The quality floor. Tier A still covers value banding, feasibility, risk, improvement recommendations, and existing-solution comparison. Tier B/C failures escalate one tier before falling back (§12.1.2). The boundary rule is written down so the tiering is auditable rather than ad hoc |
| **D-19** | *(new)* | **Model choice must not be a code literal** (ADR-021) | Enforced, not intended: an architecture test greps for `claude-` outside `packages/ai/routing` and fails the build. "Configurable" that is not tested is a comment |
| **D-20** | *(new)* | **MCP moved off the MVP path entirely** (P12 risk note) | FR-21 ships from the curated `ExistingSolution` catalogue alone. Enterprise connectors are L5, feature-flagged, and additive — their absence removes enrichment, never a requirement |

---

# 17. MVP Architecture Summary (locked)

Derived from §0–§16. **On any conflict, the detailed section wins** — this is a reading
aid, not a second source of truth.

## 17.1 Final MVP architecture

Modular monolith + async worker. One deployable API, one worker, Postgres, Redis.

```
React SPA (shadcn/ui)
   |  HTTPS + session cookie
   v
Fastify API ── policy(RBAC) ── modules ──► packages/scoring  (PURE: evaluate, rank, explain)
   |                                        ▲ deterministic, no I/O, no clock, no randomness
   | enqueue                                │ factors in ──► scores out
   v                                        │
Redis + BullMQ ──► Worker ──► packages/ai ──┘
                                │ AiProvider + ModelRouter (tiered, config-driven)
                                v
                        Anthropic Claude API
Postgres 16 (+pgvector column reserved)
```

The load-bearing boundary is `packages/ai` ⟂ `packages/scoring`: **AI produces factors,
the engine produces scores.** Enforced by an architecture test, not convention.

## 17.2 Final technology stack

| Concern | Choice |
|---|---|
| Language / repo | TypeScript 5 (strict), Node 22, pnpm workspaces + Turborepo |
| API | Fastify 5 + Zod → generated OpenAPI |
| Database | PostgreSQL 16 + Prisma (pgvector column reserved for M2) |
| Queue | BullMQ + Redis 7 |
| Web | React 19 + Vite + React Router + TanStack Query |
| Components | **shadcn/ui** (Radix + Tailwind), tokens mapped to its theme vars; 11 custom |
| Forms | react-hook-form + Zod (shadcn `Form`), sharing the API's schemas |
| AI | Anthropic Claude — **tiered routing**, config-driven (§12.1) |
| Test | Vitest · Testcontainers · Playwright · axe-core · Lighthouse CI · Stryker |

Every row is an **L4 choice** (§0), replaceable without touching requirements or architecture.

## 17.3 Core modules

| Module | Responsibility | Purity |
|---|---|---|
| `identity` | OIDC, sessions, users, departments, roles | I/O |
| `policy` | `can(actor, action, resource)`; route permission registry | **Pure** |
| `idea` | Ideas, versions, attachments, lifecycle state machine | I/O |
| `analysis` | Pipeline orchestration, job state, progress events | I/O |
| `packages/ai` | Prompts, output schemas, validators, redaction, `ModelRouter`, providers | I/O, isolated |
| `packages/scoring` | evaluate · rank · explain · classifyMaturity | **Pure — the core** |
| `review` | Reviews, score overrides, transitions | I/O |
| `ranking` | Runs, entries, recompute triggers | I/O over pure engine |
| `config` | Criteria, profiles, weights, model routes | I/O |
| `audit` | Interceptor + transactional outbox, append-only log | I/O |
| `packages/contracts` | Zod schemas, enums, lifecycle table, navigation map, env | **Pure** |
| `packages/ui` | shadcn baseline + 11 custom + tokens | Pure render |

## 17.4 Database / domain model

Full detail in §5. Twelve clusters:

1. **Identity** — `users`, `user_roles`, `departments`
2. **Idea** — `ideas`, `idea_versions` (immutable once superseded), `attachments`, `idea_categories`
3. **AI output** *(the only place model output lands)* — `ai_analyses`, `ai_structured_proposals`, `use_cases`, `value_findings`
4. **Feasibility** — `feasibility_assessments`, `feasibility_findings`
5. **Risk** — `risks`, `dependencies`
6. **Implementation** — `implementation_plans`, `implementation_requirements`, `timeline_estimates`
7. **Config** — `evaluation_criteria`, `evaluation_profiles`, `profile_weights`, `ai_model_routes`
8. **Evaluation** — `evaluations`, `criterion_scores`, `score_overrides`
9. **Ranking** — `ranking_runs`, `ranking_entries`, `ranking_explanations` *(immutable snapshots)*
10. **Improvement** — `improvement_recommendations`
11. **Governance** — `reviews`, `status_history`, `audit_log` *(append-only)*
12. **Reserved, empty at P0** — `feedback`, `demand_signals`, `similar_ideas`, `existing_solutions`, `notifications`, `kpi_*`, `idea_versions.embedding`

Seven requirements are enforced as **database constraints**, not code: feasibility
citations (FR-06), preliminary-estimate labelling (FR-08), risk mitigation (FR-10),
six-part recommendations (FR-15), rejection reason (FR-23), evidence presence (P-7),
explanation presence (P-2).

## 17.5 AI workflow

```
Submission
  └─► redact PII ─► content_hash (cache/dedup gate)
        └─► 6 idempotent jobs, tier-routed:
              STRUCTURE       Tier B    ─┐
              USE_CASES       Tier B     │  each: strict JSON Schema (no score field)
              VALUE           Tier A     ├─ validate ─► retry once ─► escalate one tier
              FEASIBILITY     Tier A     │              ─► non-AI fallback
              RISK            Tier A     │
              EFFORT_TIMELINE Tier B    ─┘
        └─► factors persisted to ai_* tables, provenance = AI, validated_by = null
              └─► handoff to the scoring engine (§17.6)
Later, human-gated: IMPROVEMENT (Tier A) · EXPLANATION NARRATIVE (Tier B, optional)
```

Every step: prompt-cached frozen prefix, cost/tokens recorded, `stop_reason` checked before
`content`, model + prompt version persisted. **Any step may fail and the idea stays
rankable** — that is the acceptance criterion, tested by disabling the provider.

## 17.6 Ranking workflow

```
factors (any source: AI | HUMAN | SIGNAL | FALLBACK)
  └─► map to criterion values ─► normalise 0..100 ─► apply active profile weights
        └─► contribution[] ─► composite (additive-weighted only; value never × feasibility)
              └─► rank cohort ─► IMMUTABLE ranking_run + entries (+ previous_rank)
                    └─► explain: strengths · constraints · peer comparison
                          (deterministic templates over the contribution vector)
```

No model call anywhere in this path. Reproducible byte-for-byte, stamped with
`engine_version`. Re-weighting is instant and free. **Maturity is computed separately and
never feeds the composite** — a level-1 concept can outrank a level-4 proposal, which is
the point.

## 17.7 Roles & permissions

Deny by default; two layers (route permission registry + resource policy + repo scope
filter). Boot **fails** on a route with no declared permission. Full matrix in §4.2.

| | Employee | Reviewer | Admin | Management |
|---|---|---|---|---|
| Submit / revise own idea | ✔ | ✔ | ✔ | ✔ |
| Read others' ideas | ranked+ | all | all | evaluated+ |
| Adjust evaluation values | — | ✔ *(reason required)* | — | — |
| Comment / request clarification | own | ✔ | ✔ | — |
| Override recommendation, change status | — | ✔ *(per state machine)* | ✔ | — |
| Configure criteria / weights / model routes | — | — | ✔ *(M2 write)* | — |
| Read audit | own idea | own actions | all | — |

DB-level guard: a reviewer cannot decide on their own idea. Every reviewer change writes
`score_overrides` + `audit_log` in the same transaction.

## 17.8 MVP vs Phase 2

**MVP1 (M1) — the core workflow, and nothing that can block it:**
Submit → Understand → Evaluate → Rank → Explain → Improve → Re-evaluate → Human Review.
FR-01..FR-17, FR-22, FR-23, FR-24, FR-26 (basic), FR-29, all NFRs.
Nine phases; P0 blocking; P4 (the scoring engine) fully parallel from day one.

**Phase 2 (M2):** admin write UI + capability catalogue · feedback & demand signals ·
duplicate detection · existing-solution & build-vs-buy · notifications · analytics.
**Phase 3 (M3):** prototype/pilot tracking · KPIs & actual-vs-predicted · integrations.

Nothing is dropped — §1.4 maps all 29 FRs and 8 NFRs to a milestone and a phase.
**No optional integration gates the core workflow.**

## 17.9 Major technical risks

| # | Risk | Impact | Mitigation | Residual |
|---|---|---|---|---|
| R1 | Factor→criterion mapping is hand-authored config; a bad mapping silently skews every rank | High | 100% branch + ≥80% mutation on `packages/scoring`; 12-idea fixture corpus; profile-swap assertions | Medium — needs real-idea calibration in P4 |
| R2 | AI band quality below eval targets → ranks people distrust | High | Golden set with blocking release gates; per-criterion `confidence`; reviewer override; visible provenance | Medium |
| R3 | Tier B/C underperforms on a story assumed cheap | Medium | Cross-tier evals; one-tier escalation on validation failure; routing is a config edit | Low |
| R4 | Rank churn — recompute moves ranks that nobody's idea changed | Medium | Immutable runs + `previous_rank` + delta chips + `settle-rank` motion teaching relativity | Low |
| R5 | Prompt injection in submissions | Medium | No score field in any AI schema (structural); delimited untrusted input; operator instructions on the system channel; 25-case blocking suite | Low |
| R6 | Explanations that read as verdicts despite P-1 | Medium | Copy lint; no verdict palette; separate value/feasibility/maturity axes | Medium — needs review of real copy |
| R7 | Provider outage or cost spike | Medium | Full fallback path keeps ideas rankable; caps fail closed; `content_hash` dedup; Batch for bulk | Low |
| R8 | P0 freeze proves incomplete, parallel slices drift | High | Generated OpenAPI + MSW mocks from one schema; contract diff gate; §14.1 additive amendment path | Low |
| R9 | shadcn components diverge from upstream after local edits | Low | Registry pinned; upgrades are reviewed PRs; one install location; §7.6 justification bar | Low |
| R10 | Audit completeness depends on all writes going through repositories | Medium | Interceptor + transactional outbox; no `UPDATE`/`DELETE` grant; migration test | Low |

## 17.10 Assumptions requiring confirmation

**Blocking — needed before P0 sign-off:**

| # | Assumption | If wrong |
|---|---|---|
| A1 | One OIDC IdP exists and can issue group claims for department mapping | P1 redesign; local accounts become in-scope |
| A2 | Ideas are internal-confidential, **not** regulated (no PHI/PCI/GDPR special category) | §4.5 retention, redaction, and possibly provider region all change |
| A3 | Sending redacted idea text to Anthropic is approved by security/legal | The AI layer needs an on-prem or gateway path — an architecture change, not a config one |
| A4 | An Anthropic API key with an org spend cap is available | P3 blocked; stub-only development |
| A5 | Employees may see each other's ranked ideas (visibility model in §4.2) | Cohort scoping and ranking semantics change — relative ranking within a restricted cohort is a different product |

**Non-blocking — confirm before the phase named:**

| # | Assumption | Needed by |
|---|---|---|
| A6 | ≤10,000 employees, ≤3,000 idea versions/year, ≤200 concurrent | P9 load test |
| A7 | The four seeded profiles reflect real organisational priorities | P4 |
| A8 | Reviewers exist, are named, and have capacity to clear a queue | P6 |
| A9 | Someone owns the `ExistingSolution` capability catalogue | P10/P12 |
| A10 | English-only, single tenant, no mobile-native requirement | M1 close |
| A11 | Attention threshold for triggering improvement recommendations | P5 |

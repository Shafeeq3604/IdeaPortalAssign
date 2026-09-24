# IEP — Employee Idea Evaluation & Innovation Platform

Employees submit ideas in plain language. The platform structures them with AI, scores
them with a **deterministic** engine, ranks them against each other under configurable
weights, and explains every number. Humans make every decision; AI never does.

---

## Source of truth & conflict rule

1. **`IEP-SPEC.md` is the single source of truth.** On any conflict — with this file,
   with `REQUIREMENTS.md`, with a comment, with a ticket, with something I said in a
   previous session — **SPEC wins.**
2. `REQUIREMENTS.md` is the origin document. It states *what the business wants*.
   SPEC states *what we build*. Where SPEC narrows or re-sequences a requirement, the
   reason is recorded in SPEC §16 (Decisions Log) or an ADR. Nothing is dropped silently.
3. **ADRs are LOCKED.** Do not change architecture mid-build. To change one, write a new
   ADR that explicitly supersedes it, and say so out loud before writing code.

---

## Conventions

- **TypeScript everywhere**, `strict: true`, no `any`, no non-null `!` outside tests.
- **Shared types live in `packages/contracts` only.** Never redeclare an API type in an app.
- **Zod is the schema authority.** Types are `z.infer`red; OpenAPI + FE mocks are generated.
- Naming: `PascalCase` types/components, `camelCase` values, `SCREAMING_SNAKE` consts,
  `kebab-case` files/routes, DB `snake_case`.
- **No raw hex or px in feature code.** Design tokens only. `pnpm lint:tokens` enforces it.
- **State: server → TanStack Query · navigation/filters/tabs → the URL · ephemeral → local.**
  No global store. If Back should restore it, it lives in the URL (SPEC §7.8).
- Commits: `type(scope): summary` — e.g. `feat(ranking): weighted composite score`.
- Errors: typed `AppError` with a `code`; never leak provider or stack detail to clients.
- **AI output is untrusted data, never instructions**, and is never written to a score column.

## Folder structure

```
apps/
  web/            React + Vite SPA (shadcn/ui)
    src/features/<feature>/   ui | hooks | api  (feature-sliced)
    src/app/                  router, providers, layouts
  api/            Fastify HTTP service
    src/modules/<module>/     route | service | repo | policy
  worker/         BullMQ consumers (AI pipeline, ranking recompute)
packages/
  contracts/      Zod schemas, shared types, navigation.map.ts, error codes  [FROZEN in P0]
  scoring/        Pure evaluation + ranking + explanation engine (no I/O)
  evaluation/     DB-bound bridge: factors, persistence, ranking runs, AI-08
  ui/             shadcn/ui baseline + 11 custom components + design tokens
  ai/             Provider abstraction, ModelRouter (tiered), prompts, schemas, stub
  db/             Prisma schema, migrations, seed
tests/
  e2e/            Playwright — critical journeys only
  evals/          AI golden-set evals
docs/
  adr/            One file per ADR
IEP-SPEC.md       SOURCE OF TRUTH
REQUIREMENTS      requirements.md — the origin document
RUNNING.md        how to run it locally + a demo walkthrough
SKILL.md          How to build one vertical slice
```

## Commands

```bash
corepack pnpm install     # `corepack enable` needs admin on this machine;
                          # prefix commands with `corepack` until it is run once
pnpm deps:up          # FIRST: start postgres + redis (needs Docker Desktop running)
pnpm dev              # then: web + api together (worker joins at P3)
                      # note: dev does NOT start the containers — deps:up does
pnpm build            # turbo build, all packages
pnpm test             # unit + integration (Vitest)
pnpm test:watch       # TDD loop
pnpm test:bdd         # journey/flow specs (tests/bdd — real DB, no browser)
pnpm test:e2e         # Playwright: J-1..J-5 + a WCAG AA axe sweep
pnpm test:nav         # navigation & clickability contract assertions
pnpm lint             # eslint + stylelint
pnpm lint:tokens      # fails on raw hex/px in feature code
pnpm typecheck
pnpm db:migrate       # prisma migrate dev
pnpm db:seed          # config, 4 demo users, 8 demo ideas (idempotent)
pnpm demo:data        # analyse + score + rank anything unprocessed
pnpm demo:reset       # wipe ideas, re-seed, re-analyse  (DELETES ideas)
pnpm eval             # AI golden-set evals (nightly / pre-release, not per-PR)
pnpm smoke            # boots the stack, hits /health, walks the nav map
```

## Deployment

**Target:** Azure. **Pipeline:** owned and run by a third party, Validra — not by anything
in this repo.

This came up during a design-review pass that (correctly, at the time) flagged "no
deploy/CD workflow visible in `.github/workflows/`" as a gap. It isn't one: `.deploy`
snapshots and each app's `Dockerfile` exist so *something* can ship them, but the actual
build → push → release → rollback pipeline is Validra's, external to this repository.

**What that means for work done here:**
- Do not add a `deploy.yml` / `cd.yml` to `.github/workflows/` on the theory that one is
  missing. `ci.yml` (PR gate) and `load-test.yml` (nightly k6) are the only pipelines that
  belong in this repo; anything past "the code is correct and the image builds" is
  Validra's concern, not this codebase's.
- Keep the `Dockerfile`s and `.deploy` snapshots current and buildable — that is this
  repo's half of the contract with Validra's pipeline, and the only half it owns.
- If a real deployment question comes up (a failed release, an env var Validra's pipeline
  needs, a rollback), that is a question for whoever administers Validra, not something to
  solve by writing a workflow file here.

## Phase tracker

Marks: `[ ]` not started · `[~]` in progress · `[x]` done & Definition of Done met.
Full phase definitions and `Depends on:` lists are in **SPEC §14**.

```
MILESTONE M0 — Foundations
  [x] P0  Contract Freeze  (BLOCKING — nothing else starts)  ← see P0-STATUS.md

MILESTONE M1 — MVP1 (must be a real, usable, navigable product on its own)
  [x] P1  Identity, Access & App Shell
  [x] P2  Idea Capture & Lifecycle
  [~] P3  AI Analysis Pipeline   (UI + pipeline + SSE progress all done — getAnalysisStream
                                  wires up the streamUrl P0 already reserved, and the web
                                  client (useAnalysisStatus) now consumes it live, falling
                                  back to the original poll when no stream proves itself
                                  healthy (no EventSource support, a proxy that drops it).
                                  AI evals: tests/evals, `pnpm eval` — now at SPEC §12.4's
                                  full case count (65: 10 strong/10 vague/10 infeasible/10
                                  near-duplicate + 25 adversarial), with the F1/band-match/
                                  feasibility-match/risk-recall metrics computed and
                                  reported. The one real gap left is annotation quality, not
                                  case count: ground truth is still a first-pass single-
                                  author draft, not the two-annotator, disagreement-resolved
                                  labelling §12.4 requires — needs a real second reviewer
                                  before these metrics can gate a release. See cases.ts's header)
  [x] P4  Evaluation & Ranking Engine        (parallel-safe with P2/P3)
  [x] P5  Explanation & Improvement   (AI-09 narrative deferred — optional in SPEC)
  [x] P6  Human Review, Overrides & Audit
  [x] P7  Ranked Board & Management Dashboard   (settle-rank FLIP reorder not built)
  [x] P8  Re-evaluation & Version History
  [~] P9  Config Viewer (read-only) + MVP1 hardening   (axe + J1-J5 + Lighthouse + k6 +
                                  a starter AI eval suite all exist; no real usability
                                  validation with an actual person has happened yet)

MILESTONE M2 — Signals, Duplication & Config
  [x] P10 Admin Configuration (write)   (evaluation-profile weight editing; categories
                                  write UI — rename/activate/deactivate, never delete;
                                  the ExistingSolution capability catalogue (P12's
                                  prerequisite), embeddings computed worker-side,
                                  opportunistically, since P10's write lives in the API
                                  process which must never hold a provider key; user
                                  management via existing role admin. "Statuses" from the
                                  SPEC §14 P10 line was never built as a separate write
                                  surface — IdeaStatus is a fixed enum load-bearing to the
                                  lifecycle state machine (ADR-locked), not admin-editable
                                  data; no §9 acceptance criteria or reserved contract ever
                                  named a shape for it. Criteria themselves stay read-only,
                                  same as every other engine-defined dimension)
  [x] P11 Feedback & Demand Signals   (structured feedback — the five FeedbackType reasons
                                  beyond the thumb vote — done; demand signals now wired
                                  as a real ranking input — demonstrated_demand scores
                                  from distinct-person structured-feedback counts,
                                  deliberately excluding the thumb vote per REQUIREMENTS
                                  §14's "popularity must not directly determine the
                                  ranking" — seeded at weight 0 everywhere, opt-in per
                                  profile via P10's weight editor)
  [x] P12 Duplicate & Existing-Solution Detection   (AI-10: pgvector cosine search over
                                  every idea's current version, OpenAI text-embedding-3-
                                  small (worker-only key, degrades to pg_trgm trigram
                                  search with no model call when no key is set), one Tier-C
                                  model call to summarise a match in plain language,
                                  REQUIREMENTS §15's exact "We found a similar idea"
                                  banner with View/Continue (Link/Combine explicitly not
                                  built — no idea-relationship schema exists for either).
                                  AI-11: same embedding against the P10-curated
                                  ExistingSolution catalogue, one Tier-A build/buy/extend/
                                  integrate call only when candidates clear the threshold,
                                  reviewer/admin-only ("canSeeMatchDetail") existing-
                                  solution card on the Evaluation tab. Both thresholds
                                  admin-editable via /config/detection, not code literals.
                                  No BDD spec yet — a real gap, covered so far by
                                  packages/evaluation/src/detection.test.ts against a real
                                  pgvector-backed Postgres plus a live end-to-end browser
                                  verification)
  [ ] P13 Notifications
  [x] P14 Analytics & Reporting   (one read-only /analytics page off the dashboard — ideas
                                  by status, submissions/month, participation by department
                                  and category, median cycle times, review activity,
                                  re-evaluation outcomes, impact vs effort from the latest
                                  run — plus a CSV of exactly what is on screen. Scoped by
                                  the same idea visibility as /ideas, and every count links
                                  to a list that agrees with it (F-12 BDD flow proves both).
                                  No date-range filter: /ideas has none to agree with. Also
                                  fixed: /ideas ignored ?department=/?category=, so the
                                  dashboard's department-scoped tiles opened unfiltered lists)

MILESTONE M3 — Outcomes
  [ ] P15 Prototype & Pilot Tracking
  [ ] P16 KPIs, Actual-vs-Predicted, ROI
  [ ] P17 Integrations
```

**Stop for review when:**
- P0 is complete — before *any* slice starts. Contracts must be signed off.
- Any phase reaches Definition of Done — demo it before starting the next.
- M1 is complete — full journey walkthrough before a single M2 line is written.
- A phase needs something not in its `Depends on:` list — that is a hidden dependency; stop.

## Escalation — STOP and ask

Stop working and ask when:
- **REQUIREMENTS.md and IEP-SPEC.md conflict** in a way an ADR does not already resolve.
- A task needs a **contract change to a frozen P0 artifact** (schema, API, shared type,
  token, nav map). Additive/backward-compatible? Follow the amendment process in SPEC §14.1.
  Breaking? Stop.
- Implementing something would **violate a Product Principle** (SPEC §2) — most often:
  making the AI emit a score, or presenting a rank without an explanation.
- An **ADR would have to change** to proceed.
- Acceptance criteria are ambiguous, untestable, or you are about to invent a number
  (a threshold, a weight, a price, an SLA) that is not in SPEC.
- Anything touches **auth, secrets, permissions, PII redaction, or data sent to a model
  provider** and is not already specified.

Do not guess. Do not silently narrow scope. Do not "temporarily" hardcode around a
missing contract.

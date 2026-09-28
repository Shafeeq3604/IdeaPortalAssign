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
  [x] P3  AI Analysis Pipeline   (UI + pipeline + SSE progress (getAnalysisStream, with a
                                  poll fallback). AI evals: tests/evals — 65 golden cases;
                                  the safety metrics (injection 0/25, PII 0, schema 100%,
                                  faithfulness 100%, fallback rankable 100%) block every PR
                                  via `pnpm eval:pr`; the four accuracy metrics are REPORTED
                                  by the real-model `pnpm eval`, not release-blocking, and the
                                  labels may stay single-author — SPEC §16.1 D-22 (owner
                                  decision, 2026-09-24): accuracy is watched via a one-off
                                  spot-check of real analyses + the P6 score-override rate.
                                  tests/evals/labelling/ keeps the annotator workbooks as an
                                  optional tool)
  [x] P4  Evaluation & Ranking Engine        (parallel-safe with P2/P3)
  [x] P5  Explanation & Improvement   (AI-09 narrative deferred — optional in SPEC)
  [x] P6  Human Review, Overrides & Audit
  [x] P7  Ranked Board & Management Dashboard   (settle-rank FLIP reorder not built)
  [x] P8  Re-evaluation & Version History
  [x] P9  Config Viewer (read-only) + MVP1 hardening   (axe + J1-J5 + Lighthouse + k6 +
                                  AI evals all exist. Usability round 1 with real testers
                                  DONE (2026-09-24) and worked through: dark-mode link/text
                                  contrast (links 3.5:1 → 7.1:1), idea byline, light-theme
                                  hero fading to white, Create page contrast + "form" option,
                                  archived ideas out of default lists, parallel AI analysis
                                  steps, chat reply polling + progress wording, idea-chat
                                  history. "Richer, enterprise-grade look" pass DONE for the
                                  Dashboard (attention-led hero, KPI row, top-opportunities
                                  table, pipeline, attention list, activity, departments) and
                                  the idea page (header card + navy score panel on every tab;
                                  Overview "at a glance", analysis findings, why-it-ranks,
                                  timeline) — real data only, no invented deltas — then carried
                                  to every other page through the shared pieces (PageHeading/
                                  PageHero, Card, Table, heading weights) plus a dark-mode
                                  primary-button contrast fix (3.7:1 → 5.2:1). Second look
                                  DONE (2026-09-24), all three notes fixed: Light/Dark/Auto
                                  theme menu (was a 3-click cycle), rank-1 tile on the
                                  podium, "How your data is handled" moved from the account
                                  menu to the sidebar foot; dot grid slightly stronger.
                                  Final checks: e2e 43/43 on the stub provider (as CI), and
                                  the WCAG AA sweep re-run 30/30 in both themes after the
                                  last UI changes. Found on the way:
                                  real-model duplicate-dimension crash fixed in the worker,
                                  and the injection check narrowed — SPEC §16.1 D-23. Owner
                                  marked P9 done 2026-09-24)

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
  [x] P13 Notifications   (in-app centre + header bell + per-event email opt-out; events
                                  = analysis finished, status changed by a person, review
                                  recorded, leadership decision — always to the idea's owner,
                                  never the actor. Email is a worker-drained OUTBOX written in
                                  the event's own transaction; transport defaults to `log`
                                  (sends nothing, masks the address) until SMTP_URL +
                                  EMAIL_FROM are set. F-13 BDD flow covers ownership, self-
                                  action skip, per-person scoping, opt-out, exactly-once send.
                                  Not built: password reset (ADR-023 parked it here — needs
                                  its own security design), Slack/Teams (nothing to target))
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
  [x] P15 Prototype & Pilot Tracking   (PROTOTYPE_CANDIDATE → PILOT → PRODUCTION_CANDIDATE →
                                  IMPLEMENTED unlocked; pilot/production now interruptible per
                                  SPEC §5.4. Pilot dates stamped by the lifecycle itself; scope,
                                  outcome and a progress timeline on the idea's Delivery tab)
  [x] P16 KPIs, Actual-vs-Predicted, ROI   (KPIs with unit/target/prediction/direction,
                                  append-only measurements, actual-vs-predicted as plain
                                  arithmetic; ROI = (benefit − investment) ÷ investment on
                                  PERSON-ENTERED figures only, never estimated, never scored.
                                  Writes: reviewer/admin, delivery stages only, never on their
                                  own idea; every write audited. F-14 BDD flow)
  [ ] P17 Integrations   (BLOCKED on a named target system — owner chose to skip. SPEC
                                  names none and calls connector tool surfaces unverified.
                                  Pick a target (e.g. outbound webhooks, Teams, Jira) to unblock)

MILESTONE M4 — Engagement   (added 2026-09-25, SPEC §14 M4 + §16.1 D-24; nothing here is scored)
  [~] P18 Social layer   (comments + @mentions for anyone who can open the idea — author
                                  edits/deletes own, admin hides with a reason, audited; follow
                                  (auto on comment); team = the existing "I could help build
                                  this" signal made visible + "Join the team"; share link;
                                  COMMENT_ADDED / MENTIONED / FOLLOWED_IDEA_MOVED notifications,
                                  only to people who can open the idea. Thumbs kept. F-15 BDD
                                  flow. Built and tested — awaiting the owner demo)
  [ ] P19 Light gamification   (ON HOLD — owner, 2026-09-25, D-25. Badges, department +
                                  individual leaderboards with opt-out, challenges, digest —
                                  thresholds need sign-off. Milestone moments moved to P20)
  [~] P20 Experience layer     (built before P19 at no new running cost — D-25: no model call,
                                  no new endpoint. Role home at /, "since you were last here",
                                  live analysis reveal, boardroom mode /rankings/boardroom, swipe
                                  to weigh in /ideas/swipe, mobile tab bar, smart filters on
                                  Explore (no AI), interactive portfolio map on Analytics,
                                  settle-rank FLIP, celebrations, "What it achieved" impact card (money + results from
                                  the Delivery figures, RESULTS_RECORDED notification to
                                  submitter + team). The AI "ask the portfolio"
                                  answer was previewed and left out. axe clean on every new or
                                  changed page in both themes. Built and tested — awaiting the
                                  owner demo)
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

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
pnpm db:seed          # demo users, criteria, profiles, ideas
pnpm eval             # AI golden-set evals (nightly / pre-release, not per-PR)
pnpm smoke            # boots the stack, hits /health, walks the nav map
```

## Phase tracker

Marks: `[ ]` not started · `[~]` in progress · `[x]` done & Definition of Done met.
Full phase definitions and `Depends on:` lists are in **SPEC §14**.

```
MILESTONE M0 — Foundations
  [x] P0  Contract Freeze  (BLOCKING — nothing else starts)  ← see P0-STATUS.md

MILESTONE M1 — MVP1 (must be a real, usable, navigable product on its own)
  [x] P1  Identity, Access & App Shell
  [x] P2  Idea Capture & Lifecycle
  [~] P3  AI Analysis Pipeline   (UI + pipeline done; AI evals not written)
  [x] P4  Evaluation & Ranking Engine        (parallel-safe with P2/P3)
  [x] P5  Explanation & Improvement   (AI-09 narrative deferred — optional in SPEC)
  [x] P6  Human Review, Overrides & Audit
  [x] P7  Ranked Board & Management Dashboard   (settle-rank FLIP reorder not built)
  [x] P8  Re-evaluation & Version History
  [~] P9  Config Viewer (read-only) + MVP1 hardening   (axe + J1-J5 done; Lighthouse, k6, AI evals outstanding)

MILESTONE M2 — Signals, Duplication & Config
  [ ] P10 Admin Configuration (write)
  [ ] P11 Feedback & Demand Signals
  [ ] P12 Duplicate & Existing-Solution Detection
  [ ] P13 Notifications
  [ ] P14 Analytics & Reporting

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

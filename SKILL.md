# SKILL.md — Building a Vertical Slice on IEP

A reusable, stack-level playbook. Not feature-specific — this is *how work is done here*,
whoever is doing it and whichever phase they are on.

**`IEP-SPEC.md` is the source of truth. On any conflict, SPEC wins — including over this
file.** If following this playbook would violate SPEC, stop and follow SPEC.

---

## 0. What a vertical slice is

One thin, demoable path through every layer:

```
DB migration -> repo -> service -> policy -> route -> contract -> UI -> nav wiring -> tests
```

Not a layer. Not "the backend for X". A slice a human can click through and a test can walk.
If your branch cannot be demoed by clicking, it is not a slice — it is inventory.

**Slice sizing:** one to three days. If it is bigger, it contains a seam you have not found
yet; split it at that seam. If a slice cannot be demoed without a second slice, they are one
slice, and you found a hidden dependency — record it in the phase's `Depends on:` list
(SPEC §14) before continuing.

---

## 1. Before you write anything

Run this checklist. It takes five minutes and it saves days.

1. **Find the acceptance criteria.** SPEC §9 for the feature, SPEC §10 for the journeys it
   touches. If they are not there, or they are not testable, **stop and ask** — do not
   invent them.
2. **Find your nav rows.** Which numbered rows in SPEC §6.2 does this slice implement? Write
   them in the PR description. A slice that adds a screen and no nav row is creating an
   orphan.
3. **Check your dependencies.** Read the phase's `Depends on:` in SPEC §14. Is everything
   listed actually merged? If you need something not on the list, that is a hidden
   dependency — **stop**, add it to the list, and say so.
4. **Check the contracts you will consume** (§3 below). Are they frozen and sufficient? If
   you would need to change one, decide now whether it is additive (SPEC §14.1, proceed) or
   breaking (**stop and ask**).
5. **Check the principles.** Does anything in this slice make the AI produce a score, show a
   number without an explanation, or let a machine advance a decision? If so it is wrong at
   the design level, not the code level (SPEC §2).

---

## 2. Test-first workflow

The order is not negotiable, because the order is what makes the tests real.

### Step 1 — Write the acceptance criteria as failing tests

Copy the Given/When/Then from SPEC §9 into test names verbatim. Verbatim, so the SPEC and
the suite stay greppable against each other. Run them. **Watch them fail.** A test that has
never failed has never been shown to test anything.

### Step 2 — TDD the logic inward-out

Pure logic first, because it is where the product's correctness lives and where tests are
cheapest.

```
red -> green -> refactor,  in units of one behaviour
```

Anything going into `packages/scoring` is written test-first, no exceptions: it carries a
100% branch gate plus an ≥80% mutation score, and neither is reachable by writing tests
afterwards.

### Step 3 — Grow outward through the layers

Migration → repository → service → policy → route. At each boundary add the test that
belongs to *that* boundary (§2.1), not a fatter test at the edge.

### Step 4 — UI last, against generated mocks

The frontend consumes MSW mocks **generated from the same Zod schemas** as the API. You do
not need the backend running, and you cannot drift from it.

### Step 5 — Wire the navigation, then assert it

Add the §6.2 rows to `navigation.map.ts`, wire the router, run `pnpm test:nav`. Then walk it
yourself in a browser: click in, click back, reload the deep link cold, press Esc in every
overlay.

### Step 6 — Journey level

Extend or add the BDD spec for the journey this slice touches. **The seams are the point** —
list→detail→back, filter persistence, focus return, empty and error states.

### 2.1 Per-layer test mapping

| Layer | Test type | Tool | What it proves | What it must NOT do |
|---|---|---|---|---|
| Pure logic (`scoring`, `maturity`, `explain`, `lifecycle`, `policy`) | **Unit, TDD** | Vitest | Correctness of the calculation or rule | Touch a DB, a clock, a network, or `Math.random` |
| Migration + constraints | Integration | Vitest + Testcontainers | The DB **rejects** invalid writes — every `CHECK` in SPEC §5 has a test | Assert only the happy path |
| Repository | Integration | Vitest + Testcontainers | Query correctness, scope filters, N+1 absence | Mock the database |
| Service | Unit + integration | Vitest | Orchestration, transaction boundaries, audit emission | Re-test the pure logic underneath |
| Policy | Unit, table-driven | Vitest | Every cell of the SPEC §4.2 matrix | Sample a few "representative" cells |
| Route | Contract + integration | Vitest + Supertest | Status codes, validation rejection, authz denial, response shape | Duplicate service tests |
| Contract | Round-trip + diff gate | Zod + OpenAPI diff | FE and BE cannot drift | Be skipped because "nothing changed" |
| Component | Component test | Vitest + Testing Library | Renders states: loading, empty, error, populated, reduced-motion | Snapshot-test markup |
| Nav | Map assertion | `pnpm test:nav` | Reachability, back-paths, no orphans/dead-ends, per-role | Be added after the fact |
| Flow / journey | **BDD** | Gherkin, API+component level | The seams between screens | Need a browser |
| Critical path | **E2E** | Playwright | J-1, J-2, J-3, J-5 only | Grow to a fifth without removing one |
| AI story | Eval | `pnpm eval`, nightly | Golden-set metrics (SPEC §12.4) | Gate a PR (except the 3 deterministic ones) |
| Accessibility | axe | CI, every route | Zero serious/critical | Be waived |

### 2.2 Working on an AI story

Additional, mandatory, in this order:

1. **Build the non-AI fallback first.** If it does not exist, the feature is not shippable —
   and building it first forces the honest question of what the model is actually adding.
2. Define the JSON Schema in `packages/ai/schemas`. Assert it contains **no numeric score
   field** (the architecture test does this; make sure it covers your new schema).
3. Implement against `StubProvider`. All unit, integration, BDD, and E2E tests use the stub.
   No test spends a token.
4. Add the golden-set cases and the metric to SPEC §12.4 before wiring the real provider.
5. Wire `AnthropicProvider`: structured output, cache breakpoint on the frozen prefix,
   `stop_reason` checked before `content`, one retry on validation failure, fallback on the
   second.
6. Demonstrate the fallback by disabling the provider. This is part of Definition of Done,
   not a nice-to-have.

---

## 3. Consuming frozen contracts without drifting

Parallel slices break at contract boundaries. These five rules are the entire defence.

**Rule 1 — `packages/contracts` is the only source of shared shapes.**
Import the type. Never redeclare it, never widen it locally, never `as` it into shape. A
duplicated interface is a fork that compiles.

```ts
// wrong — a fork that will silently diverge
interface Idea { id: string; title: string; status: string }

// right
import { type Idea, IdeaSchema } from "@iep/contracts";
```

**Rule 2 — Parse at the boundary, trust inside.**
Every inbound payload is `.parse()`d once at the edge. After that the type is guaranteed and
no defensive re-checking is needed. This is also why `status: string` is always wrong —
it is an enum in contracts.

**Rule 3 — Generate, never hand-write, the derived artefacts.**
OpenAPI, MSW mocks, and TS types are all generated from Zod. If you find yourself editing a
generated file, you are editing the wrong file.

**Rule 4 — Depend on the contract, not on the other team's progress.**
Build against the P0 fixture corpus (12 canonical ideas with hand-authored factor sets).
Phase 4 shipped its entire engine this way while Phase 3 was still being built. If you need
a shape that does not exist yet, that is a contract gap — raise it, do not stub around it.

**Rule 5 — Amend additively, or stop.**
Additive (new optional field, new enum member, new route, new token): PR labelled
`contract-amend`, all consumers updated in the same PR, contracts minor version bumped, one
line appended to `docs/adr/CONTRACT-LOG.md`.
Breaking (removed/renamed field, changed type, changed semantics, changed nav relationship):
**stop and ask.** It needs a superseding ADR before any code.

**Drift smells** — stop when you see one:
- A type defined in a feature folder that describes an API shape.
- `any`, `as unknown as`, or an optional chain guarding a field the contract says is required.
- A hardcoded string where an enum exists.
- A hex colour, a raw px, or a bare `<button>` in `features/**`.
- A duration literal in a component instead of a motion token.
- A fetch that does not go through the generated client.

---

## 4. Slice recipe (the actual sequence)

```bash
git checkout -b feat/<phase>-<slice>

# 1. Read: SPEC §9 criteria, §6.2 nav rows, §14 Depends on
# 2. Failing acceptance tests, named verbatim from SPEC
pnpm test:watch

# 3. Migration + constraint tests
pnpm db:migrate

# 4. TDD the pure logic
# 5. Repo -> service -> policy -> route, test at each boundary
# 6. Contract check
pnpm typecheck && pnpm test  # OpenAPI diff gate runs here

# 7. UI against generated mocks; states: loading, empty, error, populated, reduced-motion
# 8. Nav wiring + assertions
pnpm test:nav

# 9. Journey
pnpm test:bdd

# 10. Full gate
pnpm build && pnpm lint && pnpm lint:tokens && pnpm smoke
```

### Building UI — the short version

- Compose from `packages/ui`. Need something new? Add it to `packages/ui` with a story and a
  token audit. Never inline it in a feature. (SPEC §7.6 — and `lint:tokens` will fail you.)
- Tokens only: `--sp-*`, `--fs-*`, `--r-*`, `--e-*`, colour tokens, `--dur-*`, `--ease-*`.
- Motion comes from the named transitions in SPEC §8.3 via `useMotion()`. If you are writing
  a duration literal, you are inventing a tenth transition — stop.
- Every named transition needs its reduced-motion behaviour. `useMotion()` gives you both;
  the nav test asserts both exist.
- Four states, always: loading (skeleton matching final layout), empty (**with a forward
  action**), error (**with a retry or a route out**), populated.
- AI-sourced fields render inside `<Provenance>`. Always. This is a contract (SPEC §7.4).
- Tabular numerals on every score, rank, percentage, and week range.

---

## 5. Definition of Done

Copy this into every PR description. A slice is done when all of it is true.

```
[ ] pnpm build          — all packages compile
[ ] pnpm smoke          — stack boots, /health green, nav map walks clean
[ ] pnpm test           — unit + integration green; coverage gates met
                          (packages/scoring: 100% branch + >=80% mutation)
[ ] pnpm test:bdd       — journey specs for the flows this slice touches
                          (An empty suite is a FAILURE, not a pass: scripts/assert-suites-exist.mjs
                           refuses to report success for a suite that does not exist.)
[ ] pnpm test:e2e       — if this slice is on J-1, J-2, J-3, or J-5
[ ] pnpm test:nav       — NAV LINKS WORK: every §6.2 row this slice adds resolves;
                          no orphans, no dead-ends, back-paths honest, per-role reachability
[ ] pnpm lint / lint:tokens / typecheck — clean; no raw hex, no raw px, no feature-local
                          component that belongs in packages/ui
[ ] axe clean on new/changed routes; keyboard-only path walked by hand
[ ] Every SPEC §9 criterion for this slice is covered by a named test
[ ] AI stories: guardrails + evals + non-AI fallback implemented, and the fallback
    DEMONSTRATED with the provider disabled
[ ] Contract changes went through SPEC §14.1 and are logged
[ ] Demoed by clicking through it. Then STOP for review.
```

**"Nav links work" is not a formality.** It is the assertion that this slice did not create
an orphan or a dead-end, and it is the single check most likely to catch a seam that every
other layer's tests missed.

---

## 6. When to stop and ask

Stop. Do not work around it, do not "temporarily" hardcode past it, do not narrow the scope
quietly and mention it later.

- REQUIREMENTS and SPEC conflict in a way no ADR resolves.
- A **breaking** change to a frozen P0 contract would be needed.
- An ADR would have to change (SPEC §13 — ADRs are LOCKED; supersede them explicitly or not
  at all).
- A slice needs something outside its phase's `Depends on:` list — a hidden dependency.
- Acceptance criteria are missing, ambiguous, or untestable.
- You are about to invent a number that is not in SPEC: a weight, a threshold, an SLA, a
  price, a retention period.
- The change touches auth, secrets, permissions, PII redaction, or what gets sent to the
  model provider, and SPEC does not already cover it.
- Implementing it as asked would break a Product Principle (SPEC §2) — most commonly: making
  the AI emit a score, showing a rank without its explanation, or letting an automated step
  advance a decision.

Ask early. A five-minute question at the start of a slice costs less than a rewrite at the
end of one, and far less than a contract change after the freeze.

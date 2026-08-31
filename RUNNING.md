# Running the idea portal locally

Everything below assumes **Docker Desktop is running**. Nothing here spends money: the
default AI provider is a free, offline stub.

---

## First time

```bash
corepack pnpm install     # `corepack enable` needs admin on this machine, so keep the prefix
corepack pnpm deps:up     # postgres on 5433, redis on 6380
corepack pnpm db:migrate  # create the schema
corepack pnpm demo:reset  # clear, seed, analyse, rank — gives you 8 worked-through ideas
```

`demo:reset` prints what it did. Expect eight ideas, each with a composite score, and one
ranking run at the end.

Then, in one terminal:

```bash
corepack pnpm dev
```

Open **http://localhost:5173**.

Wait for three lines before clicking anything:

```
VITE ready
iep-api listening on :3001
iep-worker listening on iep.analysis + iep.ranking · provider=stub
```

The API also prints `routes: 30/30 implemented` at boot. If it says fewer, something did
not register and the UI will get 501s.

---

## Every time after that

```bash
corepack pnpm deps:up   # only if Docker was restarted
corepack pnpm dev
```

`dev` does **not** start the containers. That is deliberate — `deps:up` owns them, so a
crashed database is a visible failure rather than a silent restart.

---

## Signing in

Email and password (ADR-023). The seed sets the same password on all four accounts:

```
innovation-2026
```

| Account | Email | Roles | What it can reach that others cannot |
|---|---|---|---|
| **Erin Employee** | `employee@example.invalid` | EMPLOYEE | Nothing extra — the submitter's view |
| **Rae Reviewer** | `reviewer@example.invalid` | EMPLOYEE, REVIEWER | Review queue, decisions, score overrides |
| **Mo Manager** | `manager@example.invalid` | EMPLOYEE, MANAGEMENT | Dashboard |
| **Ash Admin** | `admin@example.invalid` | EMPLOYEE, ADMIN | Everything, including the audit log and accounts |

Five wrong passwords locks the account for fifteen minutes. If you do that to yourself,
sign in as Ash Admin from another browser and set a new password — that clears the lock.

### Making your own account

**Create an account** on the sign-in page. You get an EMPLOYEE account and are signed in
immediately. Two things to know:

- You arrive with **no department**, so you will not appear in the department filters
  until an administrator sets one (**Administration → People & access → Manage**).
- There is no way to give yourself a role. The sign-up request has no field for it.

### On a deployment that was never seeded

There is no administrator, so nobody can promote anybody. Set `ADMIN_INVITE_CODE` in
`.env`, restart the API, and the sign-up page will show an invite-code field. The account
created with it is an administrator.

**That field disappears the moment an administrator exists, and the code stops working**
— permanently. Every administrator after the first is promoted by an existing one, on the
audit trail (ADR-024).

### Before anyone outside the team can reach this

Set `SIGNUP_ALLOWED_EMAIL_DOMAINS=sageitinc.com` in `.env`. Left empty, **anyone who can
reach the URL can register and read every submitted idea.** Or set `SIGNUP_ENABLED=false`
and create accounts by hand.

---

## Presenting it to other people

The walkthrough below is the full tour, in the order a developer would want it. This is
the shorter version for an audience — about ten minutes, ordered by what is persuasive
rather than by what is complete.

**Lead with the evaluation and the rankings.** Everyone in the room has seen an AI
summarise a document. Almost nobody has seen one where the number is defensible, the
weights are published, and a person signs their name to the decision. That is the part
that is genuinely hard, and it is the part worth the time.

### Do not run the test suites before a demo

If you already have, `pnpm demo:clean` removes what E2E leaves behind and rebuilds the
board. It touches no accounts.

`pnpm test:bdd` and `pnpm test:e2e` run against the REAL development database, on
purpose — that is what makes them worth having. They also leave their fixtures behind:
ideas named `Determinate stepper mtcrr6re`, accounts named `bdd-lockout-12@example.test`.

Test users cannot be cleaned up afterwards. An account that appears in `audit_log` cannot
be deleted, by anyone, because the table is append-only and its actor key is `Restrict`.
The only way back to a clean list of people is to rebuild the database.

So: run the tests, then prepare the demo data. Never the other way round.

### Before you start

- `pnpm deps:up` and `pnpm dev`, and open the app once so the first render is warm.
- Sign in and out once. A failed sign-in on stage costs more than it should.
- Know which idea you are going to open. **Automatic receipt extraction for expense
  claims** ranks first and reads well; **Auto-release meeting rooms nobody turned up to**
  is the useful contrast — it scores well without being anybody's favourite.
- Decide whether you will submit a live idea. Against the real model it takes a couple of
  minutes to analyse, which is a long silence in a demo. Submitting one you prepared
  earlier is not cheating.

### The run

| # | Screen | The one sentence |
|---|---|---|
| 1 | Sign-in | Don't rush past it — it sets the tone for everything after. |
| 2 | Submit an idea | "No form to decode. Write it the way you would say it." |
| 3 | Six-step stepper | Real per-step state, not a spinner. |
| 4 | Analysis tab | "It restates the idea and tells you what is *missing*." Point at the AI-generated chip. |
| 5 | **Evaluation tab** | **"The AI did not produce this number."** Criteria, weights, the arithmetic. |
| 6 | **Rankings → switch profile** | Same ideas, different priorities, different order — and it says why each moved. |
| 7 | Review → override | Refuse it without a reason. Then give one. |
| 8 | Audit log | Who decided, and why. Append-only, enforced by the database. |
| 9 | Thumbs up/down | "Popularity is visible, and deliberately kept out of the score." |

Close on **Administration → People & access**, or on the audit log if the room is more
governance-minded than operational.

### Steps 5 and 6 in more detail, because they carry the demo

**5 — the Evaluation tab.** The composite score, then every criterion with its own score,
its weight under this profile, and what the two multiply to. Say the quiet part out loud:
the model emitted ordinal bands — *low, moderate, high* — and a deterministic engine
turned those into numbers. Run the same analysis twice and you get the same score. That is
an architectural decision (ADR-005), not a setting.

**6 — switching the ranking profile.** On **Rankings**, move from **Balanced** to **Cost
Reduction** and let the room watch the order change. Then point at any row: it names the
criterion that carried it and the one that held it back, with the figures. The URL changes
too, so the view is shareable and Back restores it.

If you want one more beat, tick two ideas and press **Compare** — it leads with where they
differ, widest gap first, rather than listing both in full.

### Questions you should expect

**"Does the AI decide which ideas win?"**
No. It never emits a score, and there is a test that fails the build if a number appears in
an AI output schema. It describes; the engine scores; a person decides and is named for it.

**"What if it gets something wrong?"**
A reviewer overrides any criterion, and the platform refuses the override without a written
reason — in the form, at the API, and in a database constraint. The original value, the new
one and the reason all land in the audit log.

**"Can anyone just sign up?"**
Registration is limited to our own email domain, and a self-registered account is always an
ordinary employee — the sign-up form has no field that could ask for more. Every role above
employee is granted by an administrator, on the audit trail. Before this is reachable from
outside it sits behind the VPN, which also handles identity; email verification is on the
list and is not built yet.

**"Is it secure?"**
Passwords are Argon2id, five failures lock an account, every endpoint declares the
permission it needs and the server refuses at the endpoint rather than hiding a button.
Attachments are identified by their leading bytes rather than their name — an executable
renamed `.pdf` is refused. The known gap is email verification; say so.

**"What does it cost to run?"**
Roughly thirteen cents an idea, because the work is routed by difficulty: extraction goes
to a cheaper model and judgement to the strongest one. There are hard per-idea and
per-organisation caps that fall back rather than overspend.

**"What isn't built yet?"**
Notifications, duplicate detection, analytics, and outcome tracking — the prototype, pilot
and implemented counts on the dashboard read zero for that reason, and the dashboard says
so rather than pretending. Be straight about this; the roadmap is in `IEP-SPEC.md` §14.

### If something breaks on stage

Every error screen has a way out by design — there is a test for it. Click the escape
link, keep talking, and come back to it. Do not open dev tools.

---

## A demo that shows what the product actually claims

Roughly ten minutes. Each step is chosen because it demonstrates a claim that is easy to
assert and hard to prove.

### 1 · Submit an idea and watch it get analysed — *as Erin*

**Submit an idea**. Fill the five required fields and submit.

You land on the idea with a **six-step stepper**. It shows all six steps from the first
paint, with real per-step state — not a spinner and not a synthetic percentage. With the
stub it finishes in about a second; against the real model it takes a couple of minutes.

Watch the terminal: `[analysis] … SUCCEEDED · 6 steps, 0 fallback`.

### 2 · Read the analysis — *Analysis tab*

Everything a model wrote sits on a lilac surface with an **AI-generated · not yet
validated** chip. That treatment is a contract, not styling — there is a test that fails
if an AI-derived block renders outside it.

Note the timeline: every phase says **preliminary**. The type system makes it impossible
to render one that does not.

### 3 · See where the number came from — *Evaluation tab*

A composite score, a rank, and immediately underneath, every criterion with its score, its
weight in this profile, and what the two multiply to. Expand **Show the evidence** on any
row.

The thing worth pointing at: **the AI never produced any of these numbers.** It emitted
ordinal bands; a deterministic engine turned them into scores. Run the same analysis twice
and you get the same number.

### 4 · React to it — *anywhere on the idea*

**Team feedback**, above the tabs. Press the thumb up; the count moves immediately. Press
it again and the vote is withdrawn — one vote per person per idea, and changing your mind
replaces it rather than adding a second.

Now look at the composite score. **It has not moved, and it never will.** Popularity is
shown next to the evaluation and is kept out of it: an idea nobody voted for can outrank
one everybody liked, and the platform will show you exactly why. An end-to-end test
asserts the score is byte-identical before and after a vote.

### 5 · Change the score, and account for it — *as Rae Reviewer*

**Review queue** → open an idea → **Review** tab.

- Press **Apply the adjustment** with no reason. Refused. FR-22 is enforced in the form,
  at the API, and by a database constraint.
- Give a reason and apply. The Evaluation tab now shows **Adjusted by Rae Reviewer** on
  that criterion, its source flips from AI to human, and the rankings recompute.
- Try to **Reject** without a comment. Also refused (FR-23).

### 6 · Compare and re-weight — *as Mo Manager*

**Rankings** → tick two ideas → **Compare**. The comparison leads with *where they differ*,
widest gap first.

Back on the board, switch profile from **Balanced** to **Quick Wins**. The URL changes, so
the view is shareable and Back restores it.

**Dashboard** → nine counts, every one a link to the list it counted.

### 7 · Trace it — *as Ash Admin*

**Audit log**. The override and the review decision are both there, with who, why, and
before/after values. Every row links to its subject.

The table is append-only, enforced by a database trigger — a test that tried to clean up
after itself could not delete a row.

### 8 · Revise and see it move — *back as Erin*

Open the idea you submitted → **Create a new version** → change one field, give a change
summary, save.

**History** shows both versions with their own scores and the delta between them. Only the
steps whose inputs actually changed are re-analysed; the rest are carried forward. The
terminal shows the reduced step count.

---

## Using the real AI instead of the stub

The stub is deterministic and free, and every test uses it. To see genuine analysis:

1. Put `ANTHROPIC_API_KEY=…` in **`apps/worker/.env`** — nowhere else. The API refuses to
   boot if it can see that variable, on purpose: only the worker talks to the provider.
2. Set `AI_PROVIDER=anthropic` in the same file.
3. Restart `pnpm dev`.

Expect roughly **two minutes and about $0.20 per idea**, and genuinely better output. To
re-analyse the seeded ideas with it:

```bash
corepack pnpm demo:reset          # back to the stub baseline, then:
node --env-file=apps/worker/.env node_modules/.bin/tsx scripts/demo-data.mts --provider=anthropic
```

That is eight ideas ≈ **$1.60**. It will say `provider=anthropic (billable)` before it
starts.

---

## Commands

| Command | What it does |
|---|---|
| `pnpm deps:up` | Start postgres + redis |
| `pnpm dev` | web + api + worker together |
| `pnpm db:migrate` | Apply schema migrations |
| `pnpm db:seed` | Config, four users, eight demo ideas. Idempotent |
| `pnpm demo:data` | Analyse + score + rank anything unprocessed |
| `pnpm demo:reset` | Wipe ideas, re-seed, re-analyse. **Deletes ideas** |
| `pnpm smoke` | Boot check: `/health` plus a walk of the nav map |
| `pnpm test` | Unit + integration |
| `pnpm test:bdd` | Flow specs against a real database, no browser |
| `pnpm test:e2e` | Playwright: J-1…J-5 and a WCAG AA sweep. Needs `pnpm dev` running |
| `pnpm test:nav` | Navigation and architecture contract assertions |
| `pnpm lint:tokens` | Fails on raw hex/px in feature code |

---

## When it does not work

**Blank page, or every request fails.** The API is not up. `pnpm dev` runs all three
processes; check the terminal for `iep-api listening on :3001`.

**"The API server is not running".** Exactly what it says — the web app is fine and the
API is not. It is a distinct message from a sign-in failure on purpose.

**API exits complaining about `ANTHROPIC_API_KEY`.** The key is somewhere the API can see
it. It belongs in `apps/worker/.env` only.

**Ideas submit but never get analysed.** Redis is down, or the worker did not start. The
idea is safe — submissions are never failed by a queue outage — but nothing will pick it
up. Check for `iep-worker listening`.

**Ports already taken.** Postgres is on **5433** and Redis on **6380**, not the defaults,
because a local Postgres 18 was already on 5432 on this machine.

**`corepack pnpm` feels redundant.** It is, once `corepack enable` has been run as
administrator. Until then the prefix is required.

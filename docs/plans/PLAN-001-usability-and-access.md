---
kind: plan
id: PLAN-001
status: draft
spec_ref: IEP-SPEC.md · requirements.md
covered: [FR-01, FR-18, FR-26, NFR-01, NFR-03, "SPEC-6.2", "SPEC-6.3", "SPEC-7.2", "SPEC-7.6", "SPEC-7.7"]
uncovered: [FR-19, FR-25, FR-27, FR-28, NFR-04, NFR-05]
adr_refs: [ADR-023]
---

# PLAN-001 — Usability overhaul, real authentication, and feedback

## Readiness

**The automated readiness gate did not pass — it could not run.** `designctl` is not
installed on this machine and `sagent-spec` is not available, so there is no ambiguity
report to check. The skill says to fail closed on a missing report, so this plan is
written under an explicit developer override, recorded here rather than assumed.

Requirement IDs trace to `requirements.md` (FR-/NFR-) and to `IEP-SPEC.md` sections
(SPEC-n.n), which are this project's equivalents of a sagent spec.

## What prompted this

Direct feedback on a demonstration, plus a hostile walk of all 19 routes as all four
roles. The walk found:

| Finding | Evidence |
|---|---|
| Admin is offered the review queue and refused it | `403 /review/queue` as Ash Admin — nav map lists ADMIN, permissions do not grant `review:write` |
| Rankings is the densest page in the product | 1,518 words for nine ideas |
| Evaluation and Analysis are close behind | 838 and 706 words |
| No authentication exists | Anyone can click "Ash Admin" and be an administrator |

Everything else was reachable and rendered, so this is a usability and access problem
rather than a broken-features problem. That distinction shapes the plan: most steps change
presentation, not behaviour.

## Steps

Ordered so the most visible damage is repaired first, and so nothing depends on a later
step.

### Phase A — the front door

**A1. Password authentication.** Implements `FR-01`, `NFR-01`, per `ADR-023`.
`PasswordProvider` as a third `AuthProvider`; Argon2id; `password_hash` and
`password_set_at` on `User`; sign-in rate limiting. The dev provider stays for tests.

**A2. A real sign-in page.** Implements `FR-01`, `SPEC-7.2`.
Email and password, the product's full name, one clear action. Replaces the list of
seeded users — the screen that prompted this work.

**A3. Sign in and sign out as ordinary controls.** Implements `SPEC-6.2`, `SPEC-6.3`.
An account menu in the header carrying the person's name, role and sign-out. Sign-out
exists today but is buried in a sidebar card, which is a discoverability failure.

### Phase B — the shell

**B1. Replace the developer sidebar.** Implements `SPEC-6.2`, `SPEC-6.3`, `SPEC-7.7`.
Remove the `19 of 25` route counter. Remove the permanently-visible "This idea" group and
its `demo-idea` placeholder links — an idea's tabs belong on the idea, and the sidebar
should carry destinations, not a route listing.

**B2. Name the product.** Implements `SPEC-7.2`.
"Employee Idea Evaluation & Innovation Platform" in the header, browser title and sign-in.
"IEP" survives only where space genuinely forces it.

### Phase C — density

**C1. Compress the ranked board.** Implements `FR-26`, `NFR-03`, `SPEC-7.7`.
1,518 words is the single worst number in the audit. A scannable row per idea: rank,
title, score, movement, one strength, one constraint. Detail on the idea, not the board.

**C2. Compress Evaluation and Analysis.** Implements `NFR-03`, `SPEC-7.6`.
Group criteria as collapsible sections with the heaviest contributors open. **The
explanation stays inline and complete** — P-2 forbids hiding it behind a link, so this
step reduces repetition, never the reasoning.

**C3. Cut prose across every page.** Implements `SPEC-7.2`.
Explanatory paragraphs collapse to a line, or move to a tooltip, or go. Where a sentence
was carrying a product principle it stays; where it was narrating the obvious it goes.

### Phase D — access and participation

**D1. Fix the admin/review mismatch.** Implements `FR-01`, `SPEC-6.2`.
The nav map offers ADMIN the review queue; the API refuses it. Decide which is right,
make both agree, and add a contract test asserting every nav-map route's roles can
actually reach that route's endpoints — the existing test checks permissions are grantable
but not that the nav map agrees with them.

**D2. Admin user management.** Implements `FR-01`.
Create a user, assign and change roles, deactivate. Deactivate rather than delete, because
`audit_log` references users and is append-only. Additive contract amendment: three new
endpoints.

**D3. Thumbs up and down on ideas.** Implements `FR-18`.
**Out of phase order** — FR-18 is P11, in Milestone 2, and M1 has not closed. Authorised
explicitly; recorded in the tracker so the phase history does not silently misreport
itself. The `Feedback` table already exists from P0. Signals do **not** feed the ranking
engine in this step: `demonstrated_demand` stays weighted zero, so no score moves because
of a popularity vote. That separation is the point of P-1 and is not being traded away for
a demo.

## Traceability

| Step | Requirement | Verified by |
|---|---|---|
| A1 | FR-01, NFR-01 | BDD flow: wrong password refused, hash never in a response, lockout after repeated failures |
| A2 | FR-01, SPEC-7.2 | E2E: sign in with credentials; axe pass on the new page |
| A3 | SPEC-6.2, SPEC-6.3 | E2E: sign out from any page returns to sign-in |
| B1 | SPEC-6.2, SPEC-6.3, SPEC-7.7 | `test:nav`: no route-count text; no placeholder ids in any href |
| B2 | SPEC-7.2 | E2E: full product name on sign-in and in the document title |
| C1 | FR-26, NFR-03, SPEC-7.7 | Word-count assertion on the board; E2E that rank, score, strength and constraint are all still present |
| C2 | NFR-03, SPEC-7.6 | Existing provenance test; E2E that the explanation is visible without interaction |
| C3 | SPEC-7.2 | Word-count budget per page, asserted |
| D1 | FR-01, SPEC-6.2 | New contract test: nav-map roles vs endpoint permissions, for every route |
| D2 | FR-01 | API integration tests; E2E that a created user can sign in |
| D3 | FR-18 | BDD flow: one vote per person per idea; no criterion score changes |

## Explicitly uncovered

Named so nothing falls through:

- **FR-19** (demand signals feeding evaluation), **FR-25** (KPIs), **FR-27** (analytics),
  **FR-28** (notifications) — later phases, untouched here. D3 deliberately delivers
  FR-18's interaction without FR-19's scoring consequence.
- **NFR-04**, **NFR-05** — still absent from SPEC; see
  `docs/REQUIREMENTS-RECONCILIATION.md` §3a. Unchanged by this plan.
- **A1 (OIDC)** stays open. ADR-023 makes password auth additive to it, not a replacement.

## Risks

- **Owning credentials** is new attack surface. Mitigated by Argon2id, no hash on any
  response path, and rate limiting — but it is a real change in the product's risk profile
  and ADR-023 says so plainly.
- **Cutting text can cut meaning.** Several paragraphs that look like padding are carrying
  P-1, P-2 or P-5. Any sentence removed must be checked against the principle it might be
  holding up; the provenance and explanation tests are the backstop.
- **D3 out of order** sets a precedent. One authorised exception, recorded. If a second
  arrives, the phase plan is wrong and should be re-cut rather than repeatedly overridden.

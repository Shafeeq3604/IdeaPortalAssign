# Requirements ↔ SPEC ↔ code reconciliation

**Date:** 2026-08-27 · **Against:** `requirements.md` (1,280 lines, 42 sections)

`CLAUDE.md` names `requirements.md` the origin document and says nothing is dropped
silently — but the file was untracked, and a search for the uppercase `REQUIREMENTS.md`
missed it. Everything from P0 to P9 was therefore built against `IEP-SPEC.md` alone,
trusting a derived document's account of its own faithfulness to the source.

This is the audit that should have run at P0. It is kept as a file because the same
question will be asked again at M2.

---

## 1. Coverage: every requirement is carried into SPEC

All **29 functional requirements** (FR-01…FR-29) are cited in `IEP-SPEC.md`.

Seven have no implementation, all correctly: FR-18 (feedback), FR-19 (demand signals),
FR-20 (duplicate detection), FR-21 (existing solutions), FR-25 (KPIs), FR-27 (analytics),
FR-28 (notifications) are M2/M3 phases in the tracker.

**All 18 items of the §37 recommended MVP scope are delivered in M1:**

| # | MVP feature | Phase |
|---|---|---|
| 1 | Authentication and roles | P1 |
| 2 | Idea submission | P2 |
| 3 | Idea management | P2 |
| 4 | AI-assisted idea structuring | P3 |
| 5 | Use-case analysis | P3 |
| 6 | Business value analysis | P3 |
| 7 | Feasibility analysis | P3 |
| 8 | Risk analysis | P3 |
| 9 | Implementation requirements | P3 |
| 10 | Preliminary timeline estimation | P3 |
| 11 | Configurable ranking | P4 · P7 (read-only config in M1) |
| 12 | Explainable ranking | P5 |
| 13 | Improvement recommendations | P5 |
| 14 | Idea re-evaluation | P8 |
| 15 | Human review | P6 |
| 16 | Basic management dashboard | P7 |
| 17 | Idea status / lifecycle | P2 |
| 18 | Basic audit logging | P6 |

---

## 2. Corrected in code

### §29 / FR-26 — the dashboard counts

The nine were guessed. Two of the real nine were missing and two invented ones were
present. Now verbatim from the source:

| Required | Status |
|---|---|
| Total ideas | ✔ |
| New ideas | ✔ **was missing** |
| Ideas under evaluation | ✔ |
| Top-ranked ideas | ✔ |
| Prototype candidates | ✔ |
| Pilot projects | ✔ |
| Implemented ideas | ✔ |
| Parked ideas | ✔ **was missing** |
| Ideas requiring review | ✔ |

Removed: "Needs clarification" and "People who have contributed" — invented, and neither
is in §29.

### §20 / FR-17 — maturity level names

Paraphrased ("an initial thought") rather than using the source's own vocabulary. Now
Concept / Defined problem / Defined solution / Validated / Implementation ready, with the
source's one-line definition shown beside each.

---

## 3. Open — needs a decision

### 3a. NFR-04 (Reliability) and NFR-05 (Scalability) are absent from SPEC

These are the only two requirements with **no citation anywhere in `IEP-SPEC.md`**. Every
other FR and NFR is referenced at least once.

The substance is largely built, just never named:

| NFR | Asked for | Built as |
|---|---|---|
| NFR-04 Reliability | Remain available, recover gracefully | Non-AI fallback per step, `PARTIAL` runs, provider retries + one-tier escalation, `DEPENDENCY_UNAVAILABLE` distinct from a 4xx, enqueuers that degrade rather than fail a write |
| NFR-05 Scalability | Growth in employees, ideas, feedback, evaluations, history, AI requests | Queue-based async analysis and ranking, pagination on every list, immutable ranking runs rather than recomputed reads, schema indexes |

**This is a documentation gap, not a build gap** — but it is exactly what the "nothing is
dropped silently" rule exists to catch. Recommended: two entries in SPEC §16 recording
that both are met by the mechanisms above, with no separate section. Not applied here,
because SPEC is the source of truth and editing it is the owner's call.

### 3b. §29's dashboard filters are narrowed to one

REQUIREMENTS asks the dashboard to filter by **department, category, status, date,
ranking and evaluation profile**. The frozen `getDashboard` query accepts `departmentId`
only.

Widening it is an additive contract amendment (SPEC §14.1). Deferred rather than taken,
because the filters would need matching list destinations for every tile to keep the
promise in §6.2 row 40 — a tile's count and the page it opens must agree.

### 3c. `requirements.md` was untracked

Now committed. The origin document of a project whose first rule is "on any conflict, SPEC
wins" has to be in version control, or the conflict cannot be checked.

---

## 4. Verified correct, no change needed

- **§17 / FR-14** — strengths, ranking constraints, comparison with nearby-ranked ideas,
  and "never presented as an unexplained number". Matches `ExplanationPanel` and the
  board rows.
- **§19 / FR-16** — the Version 1 → 2 → 3 rank progression the History tab now renders
  from real per-version evaluations.
- **§34** — "AI should not independently make final organizational decisions" and
  "AI-generated content should be clearly distinguishable from human-approved
  information": P-3 and the `<Provenance>` contract respectively.
- **§40** — all ten product principles map to SPEC's P-1…P-10.

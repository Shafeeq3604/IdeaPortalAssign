# A3 — Approval to send idea text to a model provider

**Status:** APPROVED · 2026-08-27 · recorded by the project owner in session
**Governs:** SPEC §4.5 (Privacy), §12 (Intelligence Layer), P3 onward

Assumption A3 (SPEC §17.10) asked whether employee idea text may leave the network for
analysis by Anthropic. **The answer given was yes.**

This file exists because "we asked and they said yes" is not a control. What was actually
approved has to be written down, or the scope quietly widens later.

## What is approved

Idea content — title, description, problem statement, expected users, expected outcome,
and the optional FR-02 fields — may be sent to Anthropic for analysis.

## What was assumed, and needs confirming

The approval was a plain "yes". Four specifics were not answered, so the SPEC defaults
below are in force. **Each is enforced in code; if any is wrong, say so and it changes.**

| # | Assumed | Enforced by |
|---|---|---|
| 1 | **Redaction is sufficient.** Detected emails, phone numbers and identifiers are stripped before the call; `redaction_applied` is recorded per analysis | `PII_REDACTION_ENABLED=true`, worker pre-call pass |
| 2 | **Raw payloads retained 90 days**, then pruned to metadata (tokens, cost, model, prompt version) | `AI_RAW_PAYLOAD_RETENTION_DAYS=90`, scheduled purge |
| 3 | **No hard exclusions declared.** No data class is currently blocked outright | Nothing enforced — *this is the gap* |
| 4 | Approver identity not recorded beyond this file | — |

**Item 3 is the one worth revisiting.** If any category must never be sent — customer
names, financial figures, anything regulated — it should be enforced as validation that
refuses the submission, not as guidance in a policy document. Ask, and it gets built.

## What is NOT approved by this

- Sending anything beyond idea content. Employee name, email and employee id are never
  transmitted (SPEC §4.5) and no approval changes that without a new record here.
- Retrieval over internal documents. MCP connectors (Confluence, SharePoint) remain off
  the MVP path and would put internal document content into a model call — a different
  question, requiring its own approval (SPEC §14 P12 risk note).
- Training. No data is used for model training; that is a provider-account setting, not a
  code path — confirm zero-data-retention is enabled on the account.

## Consequences

- **P3 (AI Analysis Pipeline) is unblocked.**
- The in-product Data & AI notice (`/help/data-and-ai`) must state items 1–3 in plain
  language before any employee submits a real idea. Employees are told what leaves the
  building; that is the point of the notice.
- If this approval is later withdrawn or narrowed, `packages/ai` needs an on-prem or
  gateway path. `AiProvider` (ADR-011) is the seam that would absorb it — but it is an
  architecture change and requires a superseding ADR.

# ADR-027 — `SimilarIdeaRef.similarity` becomes nullable, and is withheld from employees

- **Status:** Accepted (owner decision, 2026-09-29)
- **Date:** 2026-09-29
- **Supersedes:** the P0-frozen shape of `SimilarIdeaRef.similarity` in
  `packages/contracts/src/schemas/idea.ts` (`z.number().min(0).max(1)`, required). Nothing
  else in that schema, or in any other ADR, changes.
- **Kind under SPEC §14.1:** **breaking** — a changed type (`number` → `number | null`).
  §14.1 requires a superseding ADR before the code; this is it. `@iep/contracts` 1.1.0 →
  **2.0.0**.
- **Requirements:** REQUIREMENTS §15 — "We found a similar idea … Do not expose
  similarity/AI technical details." SPEC §9 FR-20 / AI-10 (P12).

## Context

The frozen contract already made a promise it could not keep. `IdeaDetail.permissions.
canSeeMatchDetail`'s own doc comment says a plain EMPLOYEE sees the similar-idea banner
"in prose only ('We found a similar idea'), never the number behind it", while
`SimilarIdeaRef.similarity` is a **required** number. The API therefore had to send the
number to everyone, and only the web client kept it off an employee's screen. Anyone
calling `GET /ideas/{id}` directly saw the cosine score REQUIREMENTS §15 says not to
expose.

This was found writing the F-16 BDD flow (`tests/bdd/specs/f16-duplicate-detection.spec.ts`),
together with two leaks that the frozen schema already allowed fixing without an ADR
(recorded in `CONTRACT-LOG.md`, 2026-09-29): matched ideas the viewer could not open were
named, and `existingSolutionAssessment` reached employees. This field is the one piece
that could not be fixed inside the existing shape.

## Decision

1. `SimilarIdeaRef.similarity` is `z.number().min(0).max(1).nullable()`.
2. The API sets it to `null` whenever `permissions.canSeeMatchDetail` is false (today: a
   person whose only role is EMPLOYEE), and to the stored cosine similarity otherwise.
   The rule lives in `apps/api/src/modules/idea/present.ts`, beside the existing
   `existingSolutionAssessment` gate, so both halves of "match detail" are withheld in one
   place by one flag.
3. The match itself — `ideaId`, `title`, `differenceSummary` — still reaches an employee
   who can open the matched idea. The banner, and the "View similar idea" link, are the
   feature; only the number behind them is withheld.

## Alternatives considered

- **Leave it.** The number is a similarity score, not idea content, so the exposure is
  small. Rejected by the owner: the contract's own comment promises otherwise, and a
  promise the API does not keep is the kind that fails a security review later.
- **Drop the field for everyone.** Breaks the reviewer/admin view the field exists for
  (P12: "`similarity` is carried for a reviewer/admin view").
- **Make it optional (`.optional()`) instead of nullable.** Also a type change, so no
  cheaper under §14.1, and it makes "withheld" indistinguishable from "a client built
  against an older contract" — `null` says "you may not see this" explicitly.
- **A separate reviewer-only endpoint for match detail.** A new route plus a nav-map and
  OpenAPI change, for one number the existing flag already governs.

## Consequences

- **Consumers:** `apps/web` never reads `similarity` (the banner is prose; the Evaluation
  tab's reviewer card shows the existing-solution assessment, not this field), so no
  client code changes. `openapi.json` is regenerated from the same Zod schema.
- **Tests:** F-16 asserts `similarity` is `null` for an employee and the stored number
  for a reviewer, on the same match.
- **No score, rank, weight or explanation changes** — detection has never fed the engine
  (P-1, ADR-005), and F-16's "nothing here is scored" scenario still holds.
- **Future viewers:** any new role, or any new surface returning `SimilarIdeaRef`, must
  go through the same `canSeeMatchDetail` rule rather than deciding for itself.

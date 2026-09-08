import { describe, expect, it } from "vitest";
import { canTransition } from "./lifecycle.js";
import type { IdeaStatus, Role } from "./enums.js";

/**
 * `canTransition` is the single, authoritative gate for every status change (SPEC §5.4).
 * Owner-initiated archiving (2026-09-08 amendment, docs/adr/CONTRACT-LOG.md) is asserted
 * here in both directions: that it works where it should, and — just as important — that
 * it does not leak into states or targets it was never meant to reach.
 */

const employee = (isSubmitter: boolean, reason = "no longer needed") => ({
  actorRoles: ["EMPLOYEE"] as readonly Role[],
  isSubmitter,
  reason,
});

const reviewer = (reason = "does not meet the bar") => ({
  actorRoles: ["REVIEWER"] as readonly Role[],
  isSubmitter: false,
  reason,
});

describe("owner-initiated archiving", () => {
  it("the submitter may archive their own DRAFT", () => {
    const result = canTransition("DRAFT", "ARCHIVED", employee(true));
    expect(result.ok).toBe(true);
  });

  it("the submitter may archive their own NEEDS_CLARIFICATION idea", () => {
    const result = canTransition("NEEDS_CLARIFICATION", "ARCHIVED", employee(true));
    expect(result.ok).toBe(true);
  });

  it("a reason is required, same as every other archive", () => {
    const result = canTransition("DRAFT", "ARCHIVED", employee(true, ""));
    expect(result).toEqual({ ok: false, code: "REASON_REQUIRED" });
  });

  it("someone who is not the submitter may not archive a DRAFT — no role grants it either", () => {
    const result = canTransition("DRAFT", "ARCHIVED", employee(false));
    expect(result).toEqual({ ok: false, code: "ROLE_NOT_PERMITTED" });
  });

  /**
   * The boundary this whole feature had to respect: "an employee may not move their
   * own idea once it has left their hands" (packages/contracts/src/permissions.test.ts).
   * Once past DRAFT/NEEDS_CLARIFICATION, owner-archiving must not reach — this is the
   * lifecycle-table half of that same rule; permissions.ts's `can()` is the other half.
   */
  it.each([
    "SUBMITTED", "AI_ANALYSIS", "EVALUATED", "RANKED", "UNDER_REVIEW", "PROTOTYPE_CANDIDATE",
  ] as const)("the submitter may NOT archive their own idea once it reaches %s", (from) => {
    const result = canTransition(from, "ARCHIVED", employee(true));
    expect(result).toEqual({ ok: false, code: "ROLE_NOT_PERMITTED" });
  });

  it("ownerAllowed does not leak into PARKED/BLOCKED/REJECTED — those stay reviewer-only", () => {
    for (const to of ["PARKED", "BLOCKED", "REJECTED"] as const) {
      const result = canTransition("NEEDS_CLARIFICATION", to, employee(true));
      expect(result, to).toEqual({ ok: false, code: "ROLE_NOT_PERMITTED" });
    }
  });

  it("a reviewer/admin retains unrestricted archive/reject/park/block on ANY idea — not just their own", () => {
    const interruptible: readonly IdeaStatus[] = [
      "SUBMITTED", "AI_ANALYSIS", "NEEDS_CLARIFICATION", "EVALUATED", "RANKED",
      "UNDER_REVIEW", "PROTOTYPE_CANDIDATE",
    ];
    for (const from of interruptible) {
      for (const to of ["PARKED", "BLOCKED", "REJECTED", "ARCHIVED"] as const) {
        expect(canTransition(from, to, reviewer()).ok, `${from} -> ${to}`).toBe(true);
      }
    }
  });

  it("a reviewer/admin has no power over a DRAFT — it was never theirs to begin with", () => {
    const result = canTransition("DRAFT", "ARCHIVED", reviewer());
    expect(result).toEqual({ ok: false, code: "ROLE_NOT_PERMITTED" });
  });
});

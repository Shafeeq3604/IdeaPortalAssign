import type { IdeaStatus, Role } from "./enums.js";

/**
 * The lifecycle transition table (SPEC §5.4, FR-23). FROZEN AT P0.
 *
 * This is DATA, not a switch statement. An illegal transition is inexpressible —
 * there is no code path that performs a status change except by looking it up here.
 */
export interface Transition {
  readonly from: IdeaStatus;
  readonly to: IdeaStatus;
  /** Any one of these roles may perform it. */
  readonly roles: readonly Role[];
  /** When true, `reason` is mandatory and the write is rejected without it. */
  readonly requiresReason: boolean;
  /** false = the enum member exists but the transition is unreachable until a later milestone. */
  readonly availableInM1: boolean;
  /** Owner-only: the actor must be the idea's submitter. */
  readonly submitterOnly?: boolean;
}

const ANY_REVIEWER: readonly Role[] = ["REVIEWER", "ADMIN"];

export const TRANSITIONS: readonly Transition[] = [
  // ── Employee-driven ──
  { from: "DRAFT", to: "SUBMITTED", roles: ["EMPLOYEE", "REVIEWER", "ADMIN", "MANAGEMENT"], requiresReason: false, availableInM1: true, submitterOnly: true },
  { from: "NEEDS_CLARIFICATION", to: "SUBMITTED", roles: ["EMPLOYEE", "REVIEWER", "ADMIN", "MANAGEMENT"], requiresReason: false, availableInM1: true, submitterOnly: true },

  // ── System-driven (pipeline). Actor is the worker service principal. ──
  { from: "SUBMITTED", to: "AI_ANALYSIS", roles: ["ADMIN"], requiresReason: false, availableInM1: true },
  { from: "AI_ANALYSIS", to: "EVALUATED", roles: ["ADMIN"], requiresReason: false, availableInM1: true },
  { from: "AI_ANALYSIS", to: "NEEDS_CLARIFICATION", roles: ["ADMIN"], requiresReason: true, availableInM1: true },
  { from: "EVALUATED", to: "RANKED", roles: ["ADMIN"], requiresReason: false, availableInM1: true },

  // ── Reviewer-driven. P-3: nothing past EVALUATED moves without a human. ──
  { from: "RANKED", to: "UNDER_REVIEW", roles: ANY_REVIEWER, requiresReason: false, availableInM1: true },
  { from: "UNDER_REVIEW", to: "NEEDS_CLARIFICATION", roles: ANY_REVIEWER, requiresReason: true, availableInM1: true },
  { from: "UNDER_REVIEW", to: "PROTOTYPE_CANDIDATE", roles: ANY_REVIEWER, requiresReason: false, availableInM1: true },

  // ── M3: unreachable until P15. Present so the enum is complete at P0. ──
  { from: "PROTOTYPE_CANDIDATE", to: "PILOT", roles: ANY_REVIEWER, requiresReason: false, availableInM1: false },
  { from: "PILOT", to: "PRODUCTION_CANDIDATE", roles: ANY_REVIEWER, requiresReason: false, availableInM1: false },
  { from: "PRODUCTION_CANDIDATE", to: "IMPLEMENTED", roles: ["ADMIN"], requiresReason: false, availableInM1: false },
];

/** States an idea may be parked/blocked/rejected/archived from. */
const INTERRUPTIBLE: readonly IdeaStatus[] = [
  "SUBMITTED", "AI_ANALYSIS", "NEEDS_CLARIFICATION", "EVALUATED", "RANKED",
  "UNDER_REVIEW", "PROTOTYPE_CANDIDATE",
];

/** Terminal and hold states, generated so they cannot drift out of sync. */
export const INTERRUPT_TRANSITIONS: readonly Transition[] = INTERRUPTIBLE.flatMap((from) =>
  (["PARKED", "BLOCKED", "REJECTED", "ARCHIVED"] as const).map((to) => ({
    from,
    to,
    roles: ANY_REVIEWER,
    requiresReason: true, // FR-23: "Rejected with Reason" — and the same for every hold
    availableInM1: true,
  })),
);

/** PARKED/BLOCKED may return to where they came from — the resume path. */
export const RESUME_TRANSITIONS: readonly Transition[] = (["PARKED", "BLOCKED"] as const).flatMap(
  (from) =>
    INTERRUPTIBLE.map((to) => ({
      from,
      to,
      roles: ANY_REVIEWER,
      requiresReason: true,
      availableInM1: true,
    })),
);

export const ALL_TRANSITIONS: readonly Transition[] = [
  ...TRANSITIONS,
  ...INTERRUPT_TRANSITIONS,
  ...RESUME_TRANSITIONS,
];

export function findTransition(from: IdeaStatus, to: IdeaStatus): Transition | undefined {
  return ALL_TRANSITIONS.find((t) => t.from === from && t.to === to);
}

export interface TransitionCheck {
  readonly actorRoles: readonly Role[];
  readonly isSubmitter: boolean;
  readonly reason?: string | undefined;
  /** M1 rejects transitions flagged availableInM1: false. */
  readonly milestone?: "M1" | "M3";
}

export type TransitionResult =
  | { ok: true; transition: Transition }
  | { ok: false; code: "NO_SUCH_TRANSITION" | "ROLE_NOT_PERMITTED" | "REASON_REQUIRED" | "NOT_SUBMITTER" | "NOT_AVAILABLE_YET" };

/**
 * The single gate for every status change. There is no other way to move an idea.
 * Pure — no I/O, no clock. Unit-tested to 100% branch coverage (SPEC §11.1).
 */
export function canTransition(
  from: IdeaStatus,
  to: IdeaStatus,
  check: TransitionCheck,
): TransitionResult {
  const transition = findTransition(from, to);
  if (!transition) return { ok: false, code: "NO_SUCH_TRANSITION" };

  if ((check.milestone ?? "M1") === "M1" && !transition.availableInM1) {
    return { ok: false, code: "NOT_AVAILABLE_YET" };
  }
  if (!transition.roles.some((r) => check.actorRoles.includes(r))) {
    return { ok: false, code: "ROLE_NOT_PERMITTED" };
  }
  if (transition.submitterOnly && !check.isSubmitter) {
    return { ok: false, code: "NOT_SUBMITTER" };
  }
  if (transition.requiresReason && !check.reason?.trim()) {
    return { ok: false, code: "REASON_REQUIRED" };
  }
  return { ok: true, transition };
}

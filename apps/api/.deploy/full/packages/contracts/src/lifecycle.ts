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
  /** Owner-only: the actor must be the idea's submitter. Narrows `roles` — a role in
   *  `roles` may only use this transition on their own idea. */
  readonly submitterOnly?: boolean;
  /**
   * Widens beyond `roles`: the idea's submitter may perform this transition regardless
   * of role, even one not listed in `roles` at all. Unlike `submitterOnly` (which
   * narrows an already role-granted transition) this is an independent OR-path — it
   * exists so a reviewer's standing power to act on ANY idea and a submitter's power to
   * withdraw only THEIR OWN idea can share one (from, to) row without either widening
   * the other.
   */
  readonly ownerAllowed?: boolean;
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
export const INTERRUPTIBLE: readonly IdeaStatus[] = [
  "SUBMITTED", "AI_ANALYSIS", "NEEDS_CLARIFICATION", "EVALUATED", "RANKED",
  "UNDER_REVIEW", "PROTOTYPE_CANDIDATE",
];

/**
 * Terminal and hold states, generated so they cannot drift out of sync.
 *
 * NEEDS_CLARIFICATION → ARCHIVED alone also carries `ownerAllowed`: it is the one
 * INTERRUPTIBLE state where the idea has bounced back to the submitter rather than
 * moved forward under a reviewer's judgment, so it is still theirs to withdraw — the
 * same boundary EDITABLE draws for editing (permissions.ts). Every other row here,
 * including every OTHER path to ARCHIVED, stays reviewer-only: once an idea has moved
 * forward past that point it has left the owner's hands (permissions.test.ts), and
 * PARKED/BLOCKED/REJECTED are a verdict on the idea's merit regardless of state — SPEC
 * §4.2 reserves that for someone other than its author.
 */
export const INTERRUPT_TRANSITIONS: readonly Transition[] = INTERRUPTIBLE.flatMap((from) =>
  (["PARKED", "BLOCKED", "REJECTED", "ARCHIVED"] as const).map((to) => ({
    from,
    to,
    roles: ANY_REVIEWER,
    requiresReason: true, // FR-23: "Rejected with Reason" — and the same for every hold
    availableInM1: true,
    ...(to === "ARCHIVED" && from === "NEEDS_CLARIFICATION" ? { ownerAllowed: true } : {}),
  })),
);

/**
 * The submitter may also withdraw a DRAFT outright — it has never left their hands at
 * all, so there is no reviewer judgment to override. DRAFT is not in INTERRUPTIBLE (no
 * reviewer has ever had power over a draft; it isn't visible to them), so this is its
 * own entry rather than folded into INTERRUPT_TRANSITIONS above. `roles: []` because
 * this transition has no role-based grant at all — `ownerAllowed` is the only path in.
 */
export const OWNER_WITHDRAW_DRAFT_TRANSITION: Transition = {
  from: "DRAFT",
  to: "ARCHIVED",
  roles: [],
  requiresReason: true,
  availableInM1: true,
  ownerAllowed: true,
};

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
  OWNER_WITHDRAW_DRAFT_TRANSITION,
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

  const roleAllowed = transition.roles.some((r) => check.actorRoles.includes(r));
  const ownerAllowed = Boolean(transition.ownerAllowed) && check.isSubmitter;
  if (!roleAllowed && !ownerAllowed) {
    return { ok: false, code: "ROLE_NOT_PERMITTED" };
  }
  // `submitterOnly` narrows the ROLE-based grant only. The owner path above is already
  // submitter-scoped by construction, so it is never subject to this second check.
  if (roleAllowed && transition.submitterOnly && !check.isSubmitter) {
    return { ok: false, code: "NOT_SUBMITTER" };
  }
  if (transition.requiresReason && !check.reason?.trim()) {
    return { ok: false, code: "REASON_REQUIRED" };
  }
  return { ok: true, transition };
}

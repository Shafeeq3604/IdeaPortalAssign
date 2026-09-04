import type { IdeaStatus, Role } from "./enums.js";

/**
 * The authorization model (SPEC §4.2). FROZEN AT P0-adjacent; P1 implements it.
 *
 * Deny by default, two layers:
 *   1. Route policy   — every endpoint declares `requires` (see api.ts). Boot fails otherwise.
 *   2. Resource policy — `can()` below, evaluated AFTER the resource is loaded, plus a
 *      repository scope filter so a list endpoint cannot leak a row a detail endpoint
 *      would refuse.
 *
 * This file is pure: no I/O, no framework. It is table-driven so the §4.2 matrix can be
 * the test fixture, and every cell of it is asserted (SPEC §11.1).
 */

export const PERMISSIONS = [
  "idea:create",
  "idea:read",
  "idea:read:own",
  "idea:edit:own",
  "idea:transition",
  "review:write",
  "score:override",
  "config:read",
  "config:write",
  "dashboard:read",
  "ranking:recompute",
  "audit:read",
  "user:manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Base grants by role. A user may hold several roles; grants union. */
export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  /**
   * `idea:transition` is granted to EMPLOYEE deliberately — and it is not a widening.
   *
   * The two layers do different jobs: the route permission is COARSE ("this actor may
   * attempt a status change at all"), and `can()` plus the transition table are PRECISE
   * ("…but only their own idea, only from DRAFT/NEEDS_CLARIFICATION, only to SUBMITTED").
   * Without the coarse grant the route rejects an employee before the precise layer can
   * allow it, and nobody can submit their own idea.
   */
  EMPLOYEE: [
    "idea:create", "idea:read", "idea:read:own", "idea:edit:own",
    "idea:transition", "config:read",
  ],
  REVIEWER: [
    "idea:create", "idea:read", "idea:read:own", "idea:transition",
    "review:write", "score:override", "config:read",
  ],
  MANAGEMENT: ["idea:create", "idea:read", "idea:read:own", "config:read", "dashboard:read"],
  ADMIN: [
    "idea:create", "idea:read", "idea:read:own", "idea:transition",
    // `review:write` was missing while every other capability was present. The navigation
    // map has always offered administrators the review queue, and the API refused it —
    // a 403 on a link the product itself put in front of them. The governance rule that
    // matters is unaffected: `can()` still stops anyone reviewing their OWN idea.
    "review:write",
    "config:read", "config:write", "dashboard:read", "audit:read", "user:manage", "ranking:recompute",
  ],
};

export function permissionsFor(roles: readonly Role[]): ReadonlySet<Permission> {
  const out = new Set<Permission>();
  for (const role of roles) for (const p of ROLE_PERMISSIONS[role]) out.add(p);
  return out;
}

export function hasPermission(roles: readonly Role[], required: Permission): boolean {
  return permissionsFor(roles).has(required);
}

export function hasAllPermissions(roles: readonly Role[], required: readonly string[]): boolean {
  if (required.length === 0) return true; // authenticated-only
  const held = permissionsFor(roles);
  return required.every((r) => held.has(r as Permission));
}

/* ────────────────────────── resource-level policy ────────────────────────── */

export type Action =
  | "idea:read"
  | "idea:edit"
  | "idea:submit"
  | "idea:revise"
  | "idea:transition"
  | "review:create"
  | "score:override"
  | "audit:read";

export interface Actor {
  readonly userId: string;
  readonly roles: readonly Role[];
}

export interface IdeaResource {
  readonly ideaId: string;
  readonly submitterId: string;
  readonly status: IdeaStatus;
}

export type Decision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: DenyReason };

export type DenyReason =
  | "NOT_AUTHENTICATED"
  | "ROLE_NOT_PERMITTED"
  | "NOT_SUBMITTER"
  | "CANNOT_REVIEW_OWN_IDEA"
  | "WRONG_STATUS"
  | "NOT_VISIBLE";

const ALLOW: Decision = { allowed: true };
const deny = (reason: DenyReason): Decision => ({ allowed: false, reason });

const has = (a: Actor, r: Role): boolean => a.roles.includes(r);

/** Statuses at which an idea becomes visible to people who did not submit it (A5). */
const RANKED_ONWARD: readonly IdeaStatus[] = [
  "RANKED", "UNDER_REVIEW", "PROTOTYPE_CANDIDATE", "PILOT",
  "PRODUCTION_CANDIDATE", "IMPLEMENTED",
];
const EVALUATED_ONWARD: readonly IdeaStatus[] = ["EVALUATED", ...RANKED_ONWARD];

/** Content is editable only while the idea is still the author's to change. */
const EDITABLE: readonly IdeaStatus[] = ["DRAFT", "NEEDS_CLARIFICATION"];

/**
 * The single resource-authorization decision point.
 *
 * Note the ordering: ownership and status are checked BEFORE role, so an ADMIN reviewing
 * their own idea is refused for the right reason (CANNOT_REVIEW_OWN_IDEA), not silently
 * allowed by their role. That rule is also a DB trigger — this is the friendly half.
 */
export function can(actor: Actor, action: Action, idea?: IdeaResource): Decision {
  if (actor.roles.length === 0) return deny("NOT_AUTHENTICATED");
  const isOwner = idea ? idea.submitterId === actor.userId : false;

  switch (action) {
    case "idea:read": {
      if (!idea) return deny("NOT_VISIBLE");
      if (isOwner) return ALLOW;
      if (has(actor, "REVIEWER") || has(actor, "ADMIN")) return ALLOW;
      if (has(actor, "MANAGEMENT")) {
        return EVALUATED_ONWARD.includes(idea.status) ? ALLOW : deny("NOT_VISIBLE");
      }
      // Employees see other people's ideas only once ranked (assumption A5).
      return RANKED_ONWARD.includes(idea.status) ? ALLOW : deny("NOT_VISIBLE");
    }

    case "idea:edit":
    case "idea:submit": {
      if (!idea) return deny("NOT_VISIBLE");
      if (!isOwner) return deny("NOT_SUBMITTER");
      return EDITABLE.includes(idea.status) ? ALLOW : deny("WRONG_STATUS");
    }

    case "idea:revise": {
      if (!idea) return deny("NOT_VISIBLE");
      if (!isOwner) return deny("NOT_SUBMITTER");
      // Revision is the improvement loop; a draft is edited in place instead.
      return idea.status === "DRAFT" ? deny("WRONG_STATUS") : ALLOW;
    }

    case "idea:transition": {
      if (!idea) return deny("NOT_VISIBLE");
      if (has(actor, "REVIEWER") || has(actor, "ADMIN")) return ALLOW;
      // An employee may only push their own DRAFT to SUBMITTED.
      if (isOwner && EDITABLE.includes(idea.status)) return ALLOW;
      return deny("ROLE_NOT_PERMITTED");
    }

    case "review:create":
    case "score:override": {
      if (!idea) return deny("NOT_VISIBLE");
      // Checked before role: an ADMIN is still not allowed to judge their own idea.
      if (isOwner) return deny("CANNOT_REVIEW_OWN_IDEA");
      if (action === "score:override") {
        return has(actor, "REVIEWER") ? ALLOW : deny("ROLE_NOT_PERMITTED");
      }
      return has(actor, "REVIEWER") || has(actor, "ADMIN") ? ALLOW : deny("ROLE_NOT_PERMITTED");
    }

    case "audit:read":
      return has(actor, "ADMIN") ? ALLOW : deny("ROLE_NOT_PERMITTED");
  }
}

/**
 * Repository scope filter — the second half of layer 2.
 *
 * A list endpoint must not return rows a detail endpoint would refuse, so list queries
 * are narrowed here rather than filtered after the fact.
 */
export interface IdeaScope {
  readonly all: boolean;
  readonly ownerId?: string;
  readonly statusIn?: readonly IdeaStatus[];
}

export function ideaListScope(actor: Actor): IdeaScope {
  if (has(actor, "REVIEWER") || has(actor, "ADMIN")) return { all: true };
  if (has(actor, "MANAGEMENT")) {
    return { all: false, ownerId: actor.userId, statusIn: EVALUATED_ONWARD };
  }
  return { all: false, ownerId: actor.userId, statusIn: RANKED_ONWARD };
}

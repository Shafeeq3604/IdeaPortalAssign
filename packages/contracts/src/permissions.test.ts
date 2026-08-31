import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CompareQuery, ExplanationItem } from "./schemas/evaluation.js";
import { ListIdeasQuery } from "./schemas/idea.js";

const HERE = dirname(fileURLToPath(import.meta.url));
import type { IdeaStatus, Role } from "./enums.js";
import {
  ROLE_PERMISSIONS, can, hasAllPermissions, ideaListScope, permissionsFor,
  type Action, type Actor, type IdeaResource,
} from "./permissions.js";

/**
 * The SPEC §4.2 matrix IS the fixture (SPEC §11.1). Every cell is asserted, not a
 * "representative sample" — authorization bugs are omissions, and sampling misses omissions.
 */

const OWNER = "user-owner";
const OTHER = "user-other";

const actor = (roles: readonly Role[], userId = OTHER): Actor => ({ userId, roles });
const idea = (status: IdeaStatus, submitterId = OWNER): IdeaResource => ({
  ideaId: "idea-1",
  submitterId,
  status,
});

const ROLES: readonly Role[] = ["EMPLOYEE", "REVIEWER", "ADMIN", "MANAGEMENT"];

const ALL_STATUSES: readonly IdeaStatus[] = [
  "DRAFT", "SUBMITTED", "AI_ANALYSIS", "NEEDS_CLARIFICATION", "EVALUATED", "RANKED",
  "UNDER_REVIEW", "PROTOTYPE_CANDIDATE", "PILOT", "PRODUCTION_CANDIDATE", "IMPLEMENTED",
  "PARKED", "BLOCKED", "REJECTED", "ARCHIVED",
];

describe("§4.2 — role → permission grants", () => {
  it.each(ROLES)("%s has a non-empty, deduplicated grant set", (role) => {
    const perms = ROLE_PERMISSIONS[role];
    expect(perms.length).toBeGreaterThan(0);
    expect(new Set(perms).size).toBe(perms.length);
  });

  it("only ADMIN may write config, manage users, or read all audit", () => {
    for (const p of ["config:write", "user:manage", "audit:read"] as const) {
      for (const role of ROLES) {
        expect(permissionsFor([role]).has(p), `${role} / ${p}`).toBe(role === "ADMIN");
      }
    }
  });

  it("only REVIEWER may override a score", () => {
    for (const role of ROLES) {
      expect(permissionsFor([role]).has("score:override"), role).toBe(role === "REVIEWER");
    }
  });

  it("multiple roles union their grants", () => {
    const both = permissionsFor(["EMPLOYEE", "ADMIN"]);
    expect(both.has("idea:create")).toBe(true);
    expect(both.has("user:manage")).toBe(true);
  });

  it("an empty requirement means authenticated-only, not unauthenticated", () => {
    expect(hasAllPermissions(["EMPLOYEE"], [])).toBe(true);
    expect(hasAllPermissions([], [])).toBe(true); // route layer; can() rejects no-roles
  });

  it("deny by default — an unknown permission is never granted", () => {
    expect(hasAllPermissions(["ADMIN"], ["not:a:real:permission"])).toBe(false);
  });
});

describe("§4.2 — read visibility (assumption A5)", () => {
  it("an actor with no roles is refused everything", () => {
    for (const action of ["idea:read", "idea:edit", "review:create"] as Action[]) {
      const d = can({ userId: OTHER, roles: [] }, action, idea("RANKED"));
      expect(d.allowed).toBe(false);
      if (!d.allowed) expect(d.reason).toBe("NOT_AUTHENTICATED");
    }
  });

  it.each(ALL_STATUSES)("the submitter reads their own idea at %s", (status) => {
    expect(can(actor(["EMPLOYEE"], OWNER), "idea:read", idea(status)).allowed).toBe(true);
  });

  it.each(ALL_STATUSES)("a REVIEWER reads any idea at %s", (status) => {
    expect(can(actor(["REVIEWER"]), "idea:read", idea(status)).allowed).toBe(true);
  });

  it.each(ALL_STATUSES)("an ADMIN reads any idea at %s", (status) => {
    expect(can(actor(["ADMIN"]), "idea:read", idea(status)).allowed).toBe(true);
  });

  it.each(ALL_STATUSES)("EMPLOYEE reads another's idea at %s only once ranked", (status) => {
    const ranked = ["RANKED", "UNDER_REVIEW", "PROTOTYPE_CANDIDATE", "PILOT",
      "PRODUCTION_CANDIDATE", "IMPLEMENTED"].includes(status);
    expect(can(actor(["EMPLOYEE"]), "idea:read", idea(status)).allowed).toBe(ranked);
  });

  it.each(ALL_STATUSES)("MANAGEMENT reads another's idea at %s only once evaluated", (status) => {
    const visible = ["EVALUATED", "RANKED", "UNDER_REVIEW", "PROTOTYPE_CANDIDATE", "PILOT",
      "PRODUCTION_CANDIDATE", "IMPLEMENTED"].includes(status);
    expect(can(actor(["MANAGEMENT"]), "idea:read", idea(status)).allowed).toBe(visible);
  });
});

describe("§4.2 — editing is owner-only and status-bound", () => {
  it.each(ALL_STATUSES)("owner may edit at %s only when DRAFT or NEEDS_CLARIFICATION", (status) => {
    const editable = status === "DRAFT" || status === "NEEDS_CLARIFICATION";
    const d = can(actor(["EMPLOYEE"], OWNER), "idea:edit", idea(status));
    expect(d.allowed).toBe(editable);
    if (!d.allowed) expect(d.reason).toBe("WRONG_STATUS");
  });

  it.each(ROLES)("%s cannot edit someone else's idea, whatever their role", (role) => {
    const d = can(actor([role]), "idea:edit", idea("DRAFT"));
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe("NOT_SUBMITTER");
  });

  it("revision is for submitted ideas; a draft is edited in place", () => {
    expect(can(actor(["EMPLOYEE"], OWNER), "idea:revise", idea("DRAFT")).allowed).toBe(false);
    expect(can(actor(["EMPLOYEE"], OWNER), "idea:revise", idea("RANKED")).allowed).toBe(true);
  });
});

describe("§4.2 — the self-review guard (the escalation path that matters)", () => {
  it.each(ROLES)("%s may NOT review their own idea", (role) => {
    const d = can(actor([role], OWNER), "review:create", idea("RANKED", OWNER));
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe("CANNOT_REVIEW_OWN_IDEA");
  });

  it.each(ROLES)("%s may NOT override a score on their own idea", (role) => {
    const d = can(actor([role], OWNER), "score:override", idea("RANKED", OWNER));
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe("CANNOT_REVIEW_OWN_IDEA");
  });

  it("ownership is checked BEFORE role, so an ADMIN is refused for the right reason", () => {
    const d = can(actor(["ADMIN", "REVIEWER"], OWNER), "score:override", idea("RANKED", OWNER));
    expect(d.allowed).toBe(false);
    // Not ROLE_NOT_PERMITTED — they have the role; they are the author.
    if (!d.allowed) expect(d.reason).toBe("CANNOT_REVIEW_OWN_IDEA");
  });

  it("REVIEWER may override on someone else's idea; ADMIN may not", () => {
    expect(can(actor(["REVIEWER"]), "score:override", idea("RANKED")).allowed).toBe(true);
    const adminDecision = can(actor(["ADMIN"]), "score:override", idea("RANKED"));
    expect(adminDecision.allowed).toBe(false);
  });

  it("REVIEWER and ADMIN may both review someone else's idea", () => {
    expect(can(actor(["REVIEWER"]), "review:create", idea("RANKED")).allowed).toBe(true);
    expect(can(actor(["ADMIN"]), "review:create", idea("RANKED")).allowed).toBe(true);
  });

  it.each(["EMPLOYEE", "MANAGEMENT"] as const)("%s may not review at all", (role) => {
    const d = can(actor([role]), "review:create", idea("RANKED"));
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toBe("ROLE_NOT_PERMITTED");
  });
});

describe("the two layers must agree — coarse grant, precise decision", () => {
  /**
   * Regression: an employee held no `idea:transition` grant, so the route guard rejected
   * them before `can()` could allow "your own draft → SUBMITTED". Nobody could submit an
   * idea. The layers have to be checked together, not just individually.
   */
  it("every action can() may allow is also reachable at the route layer", () => {
    const cases: { roles: readonly Role[]; action: Action; permission: string; idea: IdeaResource }[] = [
      { roles: ["EMPLOYEE"], action: "idea:transition", permission: "idea:transition", idea: idea("DRAFT", OWNER) },
      { roles: ["EMPLOYEE"], action: "idea:edit", permission: "idea:edit:own", idea: idea("DRAFT", OWNER) },
      { roles: ["EMPLOYEE"], action: "idea:revise", permission: "idea:edit:own", idea: idea("RANKED", OWNER) },
      { roles: ["REVIEWER"], action: "review:create", permission: "review:write", idea: idea("RANKED") },
      { roles: ["REVIEWER"], action: "score:override", permission: "score:override", idea: idea("RANKED") },
      { roles: ["ADMIN"], action: "audit:read", permission: "audit:read", idea: idea("RANKED") },
    ];

    for (const c of cases) {
      const resourceAllows = can(actor(c.roles, OWNER), c.action, c.idea).allowed;
      const routeAllows = hasAllPermissions(c.roles, [c.permission]);
      if (resourceAllows) {
        expect(
          routeAllows,
          `${c.roles.join("+")} may ${c.action} on the resource, but the route requires ` +
            `"${c.permission}" which they do not hold — the request never reaches can()`,
        ).toBe(true);
      }
    }
  });

  it("the coarse grant does not widen what an employee can actually do", () => {
    // Holding idea:transition must not let an employee move someone else's idea…
    expect(can(actor(["EMPLOYEE"]), "idea:transition", idea("DRAFT")).allowed).toBe(false);
    // …nor move their own idea once it has left their hands.
    expect(can(actor(["EMPLOYEE"], OWNER), "idea:transition", idea("RANKED")).allowed).toBe(false);
  });
});

describe("§4.2 — transitions and audit", () => {
  it("an employee may move only their own DRAFT forward", () => {
    expect(can(actor(["EMPLOYEE"], OWNER), "idea:transition", idea("DRAFT")).allowed).toBe(true);
    expect(can(actor(["EMPLOYEE"], OWNER), "idea:transition", idea("RANKED")).allowed).toBe(false);
    expect(can(actor(["EMPLOYEE"]), "idea:transition", idea("DRAFT")).allowed).toBe(false);
  });

  it.each(["REVIEWER", "ADMIN"] as const)("%s may transition any idea", (role) => {
    expect(can(actor([role]), "idea:transition", idea("RANKED")).allowed).toBe(true);
  });

  it.each(ROLES)("%s reads the audit log only as ADMIN", (role) => {
    expect(can(actor([role]), "audit:read").allowed).toBe(role === "ADMIN");
  });
});

describe("list scope matches detail policy — no leaking rows", () => {
  it("reviewers and admins see everything", () => {
    expect(ideaListScope(actor(["REVIEWER"])).all).toBe(true);
    expect(ideaListScope(actor(["ADMIN"])).all).toBe(true);
  });

  it("employees are scoped to own + ranked", () => {
    const scope = ideaListScope(actor(["EMPLOYEE"]));
    expect(scope.all).toBe(false);
    expect(scope.statusIn).toContain("RANKED");
    expect(scope.statusIn).not.toContain("DRAFT");
  });

  it("management is scoped to own + evaluated onward", () => {
    const scope = ideaListScope(actor(["MANAGEMENT"]));
    expect(scope.statusIn).toContain("EVALUATED");
    expect(scope.statusIn).not.toContain("SUBMITTED");
  });

  /** The invariant that matters: anything the list returns, the detail policy must allow. */
  it.each(ALL_STATUSES)("no status leaks through the employee list scope at %s", (status) => {
    const a = actor(["EMPLOYEE"]);
    const scope = ideaListScope(a);
    const inList = scope.statusIn?.includes(status) ?? false;
    if (inList) {
      expect(can(a, "idea:read", idea(status)).allowed, `${status} listed but not readable`)
        .toBe(true);
    }
  });
});

/**
 * Persisted-shape compatibility.
 *
 * Lives with the permission tests because it is the same class of assertion: a rule that
 * is only true because somebody remembered it is not a rule.
 */
describe("ExplanationItem tolerates a run written before its newest fields", () => {
  /**
   * The exact payload the engine wrote before `normalized` and `headroom` existed.
   *
   * This is not hypothetical. Adding those two as REQUIRED broke the ranking board
   * outright: rows persisted by the older engine failed validation, and the page went to
   * its error boundary showing nothing at all. Explanations are stored as JSON on an
   * immutable ranking run (ADR-008), so there is no migration that can fix an old row —
   * the schema has to tolerate it, and the board has to fall back to `text`.
   */
  const LEGACY = {
    criterionKey: "business_impact",
    criterionLabel: "Business impact",
    contribution: 15.8,
    shareOfTotal: 0.24,
    text: "Business impact scored 88 of 100 and carries 18% of this profile, adding 15.8 points.",
    evidence: ["Staff retype receipt totals by hand."],
  };

  it("parses, with the new fields absent rather than defaulted", () => {
    const parsed = ExplanationItem.safeParse(LEGACY);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);

    /**
     * Absent, NOT zero. A default of 0 would render "0/100" against a criterion that
     * actually scored 88 — a wrong number is worse than a missing one, and the board
     * decides which treatment to use by checking for undefined.
     */
    expect(parsed.success && parsed.data.normalized).toBeUndefined();
    expect(parsed.success && parsed.data.headroom).toBeUndefined();
  });

  it("still refuses a payload missing a field that was always required", () => {
    // The tolerance is specific, not a blanket "accept anything".
    const { text: _text, ...withoutText } = LEGACY;
    expect(ExplanationItem.safeParse(withoutText).success).toBe(false);
  });
});

/**
 * Query arrays, which a querystring cannot actually express.
 *
 * A parser gives a STRING for one occurrence of a key and an ARRAY for two, so a plain
 * `z.array(...)` accepts `?status=A&status=B` and rejects `?status=A`. Filtering by
 * exactly one value — the commonest thing anyone does — was the only case that failed.
 * It shipped that way.
 */
describe("a repeatable query parameter accepts one value as readily as several", () => {
  it("ListIdeasQuery takes a single status, an array, or none", () => {
    // The case that was broken.
    const single = ListIdeasQuery.safeParse({ status: "RANKED" });
    expect(single.success, JSON.stringify(single.error?.issues)).toBe(true);
    expect(single.success && single.data.status).toEqual(["RANKED"]);

    // The case that always worked, still working.
    const many = ListIdeasQuery.safeParse({ status: ["RANKED", "DRAFT"] });
    expect(many.success && many.data.status).toEqual(["RANKED", "DRAFT"]);

    /**
     * Absent stays absent, and is NOT coerced to an empty array. "No filter" and "match
     * nothing" are different queries, and conflating them would silently empty the list.
     */
    const none = ListIdeasQuery.safeParse({});
    expect(none.success && none.data.status).toBeUndefined();
  });

  it("still refuses a value that is not a status", () => {
    // The tolerance is about arity, not about type.
    expect(ListIdeasQuery.safeParse({ status: "NOT_A_STATUS" }).success).toBe(false);
    expect(ListIdeasQuery.safeParse({ status: ["RANKED", "NOPE"] }).success).toBe(false);
  });

  it("CompareQuery keeps its two-to-four bound after the coercion", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const other = "22222222-2222-4222-8222-222222222222";

    // One id is still too few to compare — wrapping it in an array must not smuggle it past.
    expect(CompareQuery.safeParse({ ids: id }).success).toBe(false);
    expect(CompareQuery.safeParse({ ids: [id, other] }).success).toBe(true);
  });

  it("every query schema with an array field goes through the helper", () => {
    /**
     * The three known ones are fixed. This asserts the RULE rather than the instances, so
     * a fourth query schema with a bare `z.array()` fails here instead of in production.
     */
    const sources = [
      readFileSync(join(HERE, "schemas", "idea.ts"), "utf8"),
      readFileSync(join(HERE, "schemas", "review.ts"), "utf8"),
      readFileSync(join(HERE, "schemas", "evaluation.ts"), "utf8"),
    ].join("\n");

    const offenders: string[] = [];
    for (const [, name, body] of sources.matchAll(/export const (\w*Query) = ([\s\S]*?)\n\}\);/g)) {
      if (/(?<!query)\bz\.array\(/.test(body!) && !body!.includes("queryArray(")) {
        offenders.push(name!);
      }
    }
    expect(
      offenders,
      `these query schemas use a bare z.array() and will reject a single value: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});

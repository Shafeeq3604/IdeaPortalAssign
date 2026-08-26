import { describe, expect, it } from "vitest";
import {
  M1_ENTITIES, RELATIONSHIPS, ROUTES, breadcrumbChain, routeById,
} from "../../packages/contracts/src/navigation.map.js";
import { SEARCH_PARAM_SCHEMAS } from "../../packages/contracts/src/search-params.js";
import type { Role } from "../../packages/contracts/src/enums.js";

/**
 * `pnpm test:nav` — the Navigation & Clickability Contract assertions (SPEC §6.3).
 *
 * MUST-level, not polish. These run in CI from P0, before a single screen exists,
 * so the contract can never be "added later".
 */

const ALL_ROLES: readonly Role[] = ["EMPLOYEE", "REVIEWER", "ADMIN", "MANAGEMENT"];

const routesFor = (role: Role) =>
  ROUTES.filter((r) => r.roles.length === 0 || r.roles.includes(role));

describe("assertion 1 — every entity is reachable, per role", () => {
  it("every M1 entity is rendered by at least one route", () => {
    const rendered = new Set(ROUTES.flatMap((r) => r.renders));
    const orphans = M1_ENTITIES.filter((e) => !rendered.has(e));

    expect(
      orphans,
      `Entities in the data model with no route that renders them (SPEC §6.3.1):\n${orphans.join("\n")}`,
    ).toEqual([]);
  });

  it("an ADMIN can reach every M1 entity", () => {
    const rendered = new Set(routesFor("ADMIN").flatMap((r) => r.renders));
    const unreachable = M1_ENTITIES.filter((e) => !rendered.has(e));
    expect(unreachable).toEqual([]);
  });

  it("an EMPLOYEE can reach their own idea's full analysis and explanation", () => {
    const rendered = new Set(routesFor("EMPLOYEE").flatMap((r) => r.renders));
    // NFR-03: an employee must be able to see WHY their idea ranks where it does.
    for (const required of [
      "Idea", "IdeaVersion", "AiAnalysis", "UseCase", "ValueFinding",
      "FeasibilityAssessment", "Risk", "Evaluation", "CriterionScore",
      "RankingEntry", "RankingExplanation", "ImprovementRecommendation",
      "EvaluationCriterion", "EvaluationProfile", "StatusHistory",
    ]) {
      expect(rendered.has(required), `EMPLOYEE cannot reach ${required}`).toBe(true);
    }
  });

  it("role-scoped restriction is correct, not an orphan (assertion 7)", () => {
    const employeeRendered = new Set(routesFor("EMPLOYEE").flatMap((r) => r.renders));
    // Per SPEC §4.2 an employee must NOT reach the audit log or user administration.
    expect(employeeRendered.has("AuditLog")).toBe(false);
    expect(employeeRendered.has("UserRole")).toBe(false);
    expect(employeeRendered.has("AiModelRoute")).toBe(false);
  });
});

describe("assertion 2 — no orphans: every relationship resolves to a registered route", () => {
  it.each(RELATIONSHIPS)("§6.2 row $spec: $from → $to", (r) => {
    expect(routeById(r.destinationRouteId), `unknown destination "${r.destinationRouteId}"`)
      .toBeDefined();
  });

  it("covers all 46 rows of the SPEC §6.2 table, with no gaps or duplicates", () => {
    const nums = RELATIONSHIPS.map((r) => r.spec).sort((a, b) => a - b);
    expect(nums).toEqual(Array.from({ length: 46 }, (_, i) => i + 1));
  });
});

describe("assertion 3 — no dead-ends", () => {
  it("every non-root route declares a backPath", () => {
    const missing = ROUTES.filter((r) => r.backPath === null && !["login", "home"].includes(r.id));
    expect(missing.map((r) => r.id)).toEqual([]);
  });

  it("every declared backPath resolves to a real route path (allowing params)", () => {
    const paths = new Set(ROUTES.map((r) => r.path));
    const broken = ROUTES.filter((r) => r.backPath !== null && !paths.has(r.backPath)).map(
      (r) => `${r.id} → ${r.backPath}`,
    );
    expect(broken, `backPath values with no matching route:\n${broken.join("\n")}`).toEqual([]);
  });
});

describe("assertion 4 — back is honest: view state lives in the URL", () => {
  it("every route that declares searchParams has a Zod schema for them", () => {
    const missing = ROUTES.filter(
      (r) => (r.searchParams?.length ?? 0) > 0 && !(r.id in SEARCH_PARAM_SCHEMAS),
    ).map((r) => r.id);

    expect(
      missing,
      `Routes with URL state but no schema — filters would drift between slices (SPEC §7.8):\n${missing.join("\n")}`,
    ).toEqual([]);
  });

  it("list routes keep filters, sort and pagination in the URL", () => {
    for (const id of ["ideas", "rankings", "review.queue"]) {
      const route = routeById(id)!;
      expect(route.searchParams, `${id} must carry sort`).toContain("sort");
      expect(route.searchParams, `${id} must carry page`).toContain("page");
    }
  });
});

describe("assertion 5 — breadcrumbs are derived, not hand-written", () => {
  it("every route produces a terminating breadcrumb chain", () => {
    for (const route of ROUTES) {
      const chain = breadcrumbChain(route.id);
      expect(chain.length, `${route.id} produced an empty chain`).toBeGreaterThan(0);
      expect(chain.at(-1)!.id, `${route.id} chain must end at itself`).toBe(route.id);
    }
  });

  it("no breadcrumb chain cycles", () => {
    for (const route of ROUTES) {
      const ids = breadcrumbChain(route.id).map((r) => r.id);
      expect(new Set(ids).size, `cycle in breadcrumb chain for ${route.id}`).toBe(ids.length);
    }
  });
});

describe("route registry integrity", () => {
  it("route ids and paths are unique", () => {
    expect(new Set(ROUTES.map((r) => r.id)).size).toBe(ROUTES.length);
    expect(new Set(ROUTES.map((r) => r.path)).size).toBe(ROUTES.length);
  });

  it("every route declares its roles explicitly (deny-by-default is opt-in visible)", () => {
    for (const r of ROUTES) expect(Array.isArray(r.roles), `${r.id} has no roles array`).toBe(true);
  });

  it("P-2 — the ranking explanation is rendered inline, never behind a click", () => {
    const rel = RELATIONSHIPS.find((r) => r.spec === 23)!;
    expect(rel.affordance).toBe("inline");
  });

  it("every role has at least one reachable landing route", () => {
    for (const role of ALL_ROLES) expect(routesFor(role).length).toBeGreaterThan(3);
  });
});

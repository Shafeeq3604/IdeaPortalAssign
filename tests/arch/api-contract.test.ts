import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { zodToJsonSchema } from "zod-to-json-schema";
import { join } from "node:path";
import { ENDPOINTS } from "../../packages/contracts/src/api.js";
import { HTTP_STATUS_BY_CODE } from "../../packages/contracts/src/errors.js";
import { PERMISSIONS, ROLE_PERMISSIONS, permissionsFor } from "../../packages/contracts/src/permissions.js";
import type { Role } from "../../packages/contracts/src/enums.js";

/**
 * API contract assertions (P0 deliverables 2b + 3).
 *
 * These run from P0, before a single route handler exists, so the contract cannot be
 * quietly weakened once implementation starts.
 */

const ROOT = join(import.meta.dirname, "..", "..");
const openapi = JSON.parse(readFileSync(join(ROOT, "openapi.json"), "utf8")) as {
  paths: Record<string, Record<string, { operationId: string; "x-access"?: unknown }>>;
  components: { schemas: Record<string, unknown> };
};

describe("endpoint registry integrity", () => {
  it("operationIds are unique", () => {
    const ids = ENDPOINTS.map((e) => e.operationId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("method + path pairs are unique", () => {
    const keys = ENDPOINTS.map((e) => `${e.method} ${e.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("SPEC §4.2 — every endpoint declares access; omission is impossible", () => {
    const undeclared = ENDPOINTS.filter((e) => e.access === undefined).map((e) => e.operationId);
    expect(undeclared).toEqual([]);
  });

  /**
   * The guard that was missing.
   *
   * A `requires` string that is not a real Permission can never be granted, so the
   * endpoint is permanently 403 — fail-closed, but broken, and invisible until someone
   * with the right role actually tries it. That is exactly how it was found in P1:
   * `"admin"` was not a permission, and every admin endpoint was dead.
   */
  it("every declared permission actually exists", () => {
    const valid = new Set<string>(PERMISSIONS);
    const bogus: string[] = [];
    for (const ep of ENDPOINTS) {
      if (ep.access === "public") continue;
      for (const r of ep.access.requires) {
        if (!valid.has(r)) bogus.push(`${ep.operationId} → "${r}"`);
      }
    }
    expect(bogus, `unknown permissions (these endpoints are permanently 403):\n${bogus.join("\n")}`)
      .toEqual([]);
  });

  it("every declared permission is held by at least one role", () => {
    const roles: Role[] = ["EMPLOYEE", "REVIEWER", "ADMIN", "MANAGEMENT"];
    const grantable = new Set<string>(roles.flatMap((r) => [...permissionsFor([r])]));
    const orphaned: string[] = [];
    for (const ep of ENDPOINTS) {
      if (ep.access === "public") continue;
      for (const r of ep.access.requires) {
        if (!grantable.has(r)) orphaned.push(`${ep.operationId} → ${r}`);
      }
    }
    expect(orphaned, `permissions no role can hold:\n${orphaned.join("\n")}`).toEqual([]);
  });

  it("every permission in the catalogue is granted to someone", () => {
    const granted = new Set<string>(Object.values(ROLE_PERMISSIONS).flat());
    const dead = PERMISSIONS.filter((p) => !granted.has(p));
    expect(dead, `defined but granted to no role: ${dead.join(", ")}`).toEqual([]);
  });

  it("the public endpoints are exactly these four, and each is argued for", () => {
    /**
     * An allow-list, not a rule of thumb. Each entry states why a session cannot be
     * required, because the whole value of asserting the exact set is that a fifth
     * public endpoint has to be argued for in a diff rather than appearing quietly.
     *
     *  - `getHealth`       a liveness probe cannot hold a session, and discloses nothing
     *                      beyond process state.
     *  - `login`           establishing the session IS the endpoint (ADR-023).
     *  - `signup`          same, for someone who does not have an account yet (FR-01a).
     *  - `signupOptions`   the sign-up form has to know whether the door is open before
     *                      anyone types a password. It returns two booleans and a list of
     *                      permitted email domains — no accounts, no names, no counts.
     *
     * The one that deserves a second look is `signupOptions`, because it is the only
     * public GET. `adminBootstrapAvailable` is true ONLY on an installation that has no
     * administrator, which is an installation with no accounts, no ideas and nothing yet
     * to protect. Once one exists it is false forever.
     */
    const publicOnes = ENDPOINTS.filter((e) => e.access === "public")
      .map((e) => e.operationId)
      .sort();
    expect(publicOnes).toEqual(["getHealth", "login", "signup", "signupOptions"]);
  });

  it("no public endpoint returns anything about a person", () => {
    /**
     * The failure this catches is a public endpoint growing a convenience field — a
     * department list on the sign-up form, a count of colleagues, an example address.
     * Each one is individually reasonable and collectively an unauthenticated directory.
     */
    const PERSON_SHAPED = /user|person|email|name|department|actor|submitter/i;

    for (const ep of ENDPOINTS.filter((e) => e.access === "public")) {
      if (ep.operationId === "login" || ep.operationId === "signup") continue; // return YOUR own session
      const shape = JSON.stringify(zodToJsonSchema(ep.response));
      const leaks = [...shape.matchAll(/"(w+)":/g)]
        .map((m) => m[1]!)
        .filter((key) => PERSON_SHAPED.test(key));
      expect(leaks, `${ep.operationId} exposes ${leaks.join(", ")} without a session`).toEqual(
        [],
      );
    }
  });

  it("path params in the URL have a matching schema", () => {
    for (const ep of ENDPOINTS) {
      const declared = [...ep.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!);
      if (declared.length === 0) continue;
      expect(ep.params, `${ep.operationId} has {params} in its path but no params schema`)
        .toBeDefined();
      const shape = Object.keys(
        (ep.params as unknown as { shape: Record<string, unknown> }).shape,
      );
      for (const name of declared) {
        expect(shape, `${ep.operationId} is missing param "${name}"`).toContain(name);
      }
    }
  });

  it("mutating endpoints accept a body or are explicitly bodyless", () => {
    const suspicious = ENDPOINTS.filter(
      (e) => (e.method === "POST" || e.method === "PATCH") && !e.body,
    ).map((e) => e.operationId);
    // logout is the one legitimate bodyless POST.
    expect(suspicious).toEqual(["logout"]);
  });

  it("every declared error code maps to an HTTP status", () => {
    for (const ep of ENDPOINTS) {
      for (const code of ep.errors) {
        expect(HTTP_STATUS_BY_CODE[code], `${ep.operationId}: ${code}`).toBeTypeOf("number");
      }
    }
  });
});

describe("openapi.json is generated, current, and complete", () => {
  it("contains exactly the registry's operations", () => {
    const inDoc = Object.values(openapi.paths).flatMap((ops) =>
      Object.values(ops).map((o) => o.operationId),
    );
    expect(inDoc.sort()).toEqual(ENDPOINTS.map((e) => e.operationId).sort());
  });

  it("every operation carries x-access (authz is documented, not implied)", () => {
    for (const [path, ops] of Object.entries(openapi.paths)) {
      for (const [method, op] of Object.entries(ops)) {
        expect(op["x-access"], `${method.toUpperCase()} ${path}`).toBeDefined();
      }
    }
  });

  it("resolves every $ref it declares", () => {
    const text = JSON.stringify(openapi);
    const refs = [...text.matchAll(/"#\/components\/schemas\/([A-Za-z0-9_]+)"/g)].map((m) => m[1]!);
    const missing = [...new Set(refs)].filter((r) => !(r in openapi.components.schemas));
    expect(missing, `dangling $refs: ${missing.join(", ")}`).toEqual([]);
  });
});

describe("contract invariants that outlive the schema files", () => {
  /** Nested types are inlined by the generator, so navigate rather than look up by name. */
  type JsonSchema = {
    type?: string;
    required?: string[];
    properties?: Record<string, JsonSchema>;
    items?: JsonSchema;
    anyOf?: JsonSchema[];
    minItems?: number;
    enum?: unknown[];
  };
  const schemas = openapi.components.schemas as Record<string, JsonSchema>;
  /** `T | null` becomes an anyOf — unwrap to the object arm. */
  const obj = (s: JsonSchema): JsonSchema =>
    s.anyOf ? (s.anyOf.find((a) => a.type === "object") ?? s) : s;

  it("P-2 — the evaluation response cannot express a rank without an explanation", () => {
    const ranking = obj(schemas["GetIdeaEvaluationResponse"]!.properties!["ranking"]!);
    expect(ranking.required, "ranking must require explanation").toContain("explanation");

    const explanation = ranking.properties!["explanation"]!;
    // Not merely present — non-empty. An empty strengths list would be an unexplained rank.
    expect(explanation.properties!["strengths"]!.minItems).toBe(1);
    expect(explanation.properties!["constraints"]!.minItems).toBe(1);
  });

  it("FR-08 — a timeline estimate cannot be marked non-preliminary", () => {
    const plan = obj(schemas["GetIdeaAnalysisResponse"]!.properties!["plan"]!);
    const item = plan.properties!["timeline"]!.items!;
    expect(item.required).toContain("isPreliminary");
    // enum:[true] — `false` is not merely discouraged, it is unrepresentable.
    expect(item.properties!["isPreliminary"]!.enum).toEqual([true]);
  });

  it("ADR-005 — no score/rank/weight field appears in an AI analysis schema", () => {
    const s = openapi.components.schemas as Record<string, unknown>;
    for (const name of ["StructuredProposal", "UseCase", "ValueFinding", "FeasibilityAssessment", "Risk"]) {
      const json = JSON.stringify(s[name] ?? {});
      for (const banned of ['"score"', '"rank"', '"weight"', '"compositeScore"', '"normalized"']) {
        expect(json, `${name} must not carry ${banned} (ADR-005)`).not.toContain(banned);
      }
    }
  });
});

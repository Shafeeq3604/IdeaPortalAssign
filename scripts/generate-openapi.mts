/**
 * Generate openapi.json from the endpoint registry (P0 deliverable 3).
 *
 *   pnpm openapi:generate   → writes openapi.json
 *   pnpm openapi:check      → fails if the committed file is stale
 *
 * The registry in packages/contracts/src/api.ts is the source of truth. This file only
 * transcribes it — never hand-edit openapi.json, and never let it drift: the CI check
 * is what makes the P0 freeze real rather than decorative (SPEC §11.3, §14.1).
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { ENDPOINTS, type EndpointDef } from "../packages/contracts/src/api.js";
import { ErrorResponse } from "../packages/contracts/src/errors.js";
import { HTTP_STATUS_BY_CODE } from "../packages/contracts/src/errors.js";

const DEFS = "components/schemas";
const definitions: Record<string, unknown> = {};

function schema(z: ZodTypeAny, name: string): unknown {
  const out = zodToJsonSchema(z, {
    name,
    $refStrategy: "root",
    basePath: ["#", DEFS],
    target: "openApi3",
  }) as { definitions?: Record<string, unknown> };
  if (out.definitions) Object.assign(definitions, out.definitions);
  return { $ref: `#/${DEFS}/${name}` };
}

/** JSON Schema for a query/param object → an OpenAPI parameter list. */
function parameters(ep: EndpointDef): unknown[] {
  const params: unknown[] = [];

  const add = (z: ZodTypeAny | undefined, location: "path" | "query") => {
    if (!z) return;
    const js = zodToJsonSchema(z, { target: "openApi3" }) as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    for (const [name, propSchema] of Object.entries(js.properties ?? {})) {
      params.push({
        name,
        in: location,
        required: location === "path" ? true : (js.required ?? []).includes(name),
        schema: propSchema,
      });
    }
  };

  add(ep.params, "path");
  add(ep.query, "query");
  return params;
}

function responses(ep: EndpointDef): Record<string, unknown> {
  const pascal = ep.operationId[0]!.toUpperCase() + ep.operationId.slice(1);
  const out: Record<string, unknown> = {
    [String(ep.successStatus)]: {
      description: "Success",
      content: { "application/json": { schema: schema(ep.response, `${pascal}Response`) } },
    },
  };

  // Group documented error codes by the status they map to.
  const byStatus = new Map<number, string[]>();
  for (const code of ep.errors) {
    const status = HTTP_STATUS_BY_CODE[code];
    byStatus.set(status, [...(byStatus.get(status) ?? []), code]);
  }
  // Universal failure modes — every authenticated endpoint can emit these.
  if (ep.access !== "public") byStatus.set(401, byStatus.get(401) ?? ["UNAUTHENTICATED"]);
  byStatus.set(500, ["INTERNAL_ERROR"]);

  for (const [status, codes] of [...byStatus].sort((a, b) => a[0] - b[0])) {
    out[String(status)] = {
      description: codes.join(" | "),
      content: { "application/json": { schema: { $ref: `#/${DEFS}/ErrorResponse` } } },
    };
  }
  return out;
}

const paths: Record<string, Record<string, unknown>> = {};

for (const ep of ENDPOINTS) {
  const pascal = ep.operationId[0]!.toUpperCase() + ep.operationId.slice(1);
  const operation: Record<string, unknown> = {
    operationId: ep.operationId,
    summary: ep.summary,
    tags: [ep.tag],
    // Declarative authz, mirroring SPEC §4.2. The route guard in apps/api reads the
    // same field, so "every route declares its access" is checkable from the contract.
    "x-access": ep.access === "public" ? "public" : { requires: ep.access.requires },
    security: ep.access === "public" ? [] : [{ sessionCookie: [] }],
    parameters: parameters(ep),
    responses: responses(ep),
  };

  if (ep.body) {
    operation["requestBody"] = {
      required: true,
      content: { "application/json": { schema: schema(ep.body, `${pascal}Request`) } },
    };
  }

  paths[ep.path] ??= {};
  paths[ep.path]![ep.method.toLowerCase()] = operation;
}

// Register the shared error envelope once.
schema(ErrorResponse, "ErrorResponse");

const document = {
  openapi: "3.1.0",
  info: {
    title: "IEP — Employee Idea Evaluation & Innovation Platform",
    version: "1.0.0",
    description:
      "GENERATED FILE — do not edit.\n\n" +
      "Source of truth: packages/contracts/src/api.ts. Regenerate with `pnpm openapi:generate`.\n" +
      "CI fails if this file is stale (SPEC §11.3). Breaking changes require a superseding ADR (SPEC §14.1).",
  },
  servers: [{ url: "/api", description: "IEP API" }],
  components: {
    securitySchemes: {
      sessionCookie: { type: "apiKey", in: "cookie", name: "__Host-iep.sid" },
    },
    schemas: Object.fromEntries(Object.entries(definitions).sort(([a], [b]) => a.localeCompare(b))),
  },
  paths: Object.fromEntries(Object.entries(paths).sort(([a], [b]) => a.localeCompare(b))),
};

const target = join(import.meta.dirname, "..", "openapi.json");
writeFileSync(target, JSON.stringify(document, null, 2) + "\n");

console.log(
  `openapi.json written — ${ENDPOINTS.length} endpoints, ` +
    `${Object.keys(document.components.schemas).length} schemas`,
);

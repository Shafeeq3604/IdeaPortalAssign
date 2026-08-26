import Fastify, { type FastifyInstance } from "fastify";
import { ApiEnv, loadEnv } from "@iep/contracts/env";

/**
 * apps/api — P0.0 shell.
 *
 * DELIBERATELY EMPTY. One route: /health. No auth, no idea routes, no database.
 * This exists so the API message schemas and the generated OpenAPI catalogue
 * (P0 deliverables 2b and 3) have somewhere to live. Features land in P1+.
 *
 * Two SPEC guardrails are wired from line one, because retrofitting either is painful:
 *
 *  1. §4.4 — env is validated at boot; the process REFUSES TO START on a bad value
 *     rather than degrading. That check also rejects an Anthropic key on this process:
 *     only the worker may hold it, and the API must not be able to reach the provider.
 *
 *  2. §4.2 — route registration guard. Every route must declare `requires`. A route
 *     that does not is a boot failure, not a code-review note. Most authz bugs are
 *     omissions, so omission is made impossible. /health is the one public route and
 *     declares itself as such, explicitly.
 */

/** A route either lists the permissions it needs, or is explicitly public. */
export type RouteAccess = { public: true } | { requires: readonly string[] };

interface RouteSpec {
  readonly method: "GET" | "POST" | "PATCH" | "DELETE";
  readonly url: string;
  readonly access: RouteAccess;
  readonly handler: Parameters<FastifyInstance["route"]>[0]["handler"];
}

/**
 * The single registration path. Nothing reaches the router except through here,
 * so "every route declares its access" is enforced structurally.
 */
export function registerRoute(app: FastifyInstance, spec: RouteSpec): void {
  const declared =
    "public" in spec.access ? true : Array.isArray(spec.access.requires);

  if (!declared) {
    // Boot fails loudly and names the offender (SPEC §9.1).
    throw new Error(
      `Route ${spec.method} ${spec.url} has no access declaration. ` +
        `Every route must declare { requires: [...] } or { public: true } (SPEC §4.2).`,
    );
  }

  app.route({
    method: spec.method,
    url: spec.url,
    handler: spec.handler,
  });
}

export interface BuildOptions {
  /** Injected so tests can build a server without touching process.env. */
  readonly env?: NodeJS.ProcessEnv;
}

export function buildServer(options: BuildOptions = {}): FastifyInstance {
  const env = loadEnv(ApiEnv, options.env ?? process.env);

  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      // requestId correlates API logs, traces and every client ErrorBoundary (SPEC §7.8).
      redact: ["req.headers.authorization", "req.headers.cookie"],
    },
    genReqId: () => crypto.randomUUID(),
  });

  registerRoute(app, {
    method: "GET",
    url: "/health",
    access: { public: true },
    handler: async () => ({
      status: "ok",
      service: "iep-api",
      phase: "P0.0",
      // Deliberately no version/commit/dependency detail: /health is unauthenticated,
      // so it says only that the process is alive (SPEC §4.3 — no needless disclosure).
    }),
  });

  return app;
}

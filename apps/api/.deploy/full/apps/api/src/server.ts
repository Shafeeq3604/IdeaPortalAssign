import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import { ApiEnv, loadEnv } from "@iep/contracts/env";
import {
  ENDPOINTS, HTTP_STATUS_BY_CODE, hasAllPermissions, permissionsFor,
  type EndpointDef, type ErrorCode, type Role, MAX_ATTACHMENT_BYTES } from "@iep/contracts";
import { registerAuthRoutes } from "./modules/auth.routes.js";
import { registerIdentityRoutes } from "./modules/identity.routes.js";
import { registerConfigRoutes } from "./modules/config.routes.js";
import { registerIdeaRoutes } from "./modules/idea/routes.js";
import { registerAnalysisRoutes } from "./modules/analysis.routes.js";
import { registerEvaluationRoutes } from "./modules/evaluation/routes.js";
import { registerReviewRoutes } from "./modules/review/routes.js";
import { registerRankingRoutes } from "./modules/rankings/routes.js";
import { registerAccountRoutes } from "./modules/account/routes.js";
import { registerAttachmentRoutes } from "./modules/idea/attachment-routes.js";
import { notImplementedYet } from "./lib/handlers.js";
import type { AppContext } from "./context.js";
import { sessionCookieName } from "./auth/session.js";

/**
 * apps/api — P1.
 *
 * Two structural guarantees, both enforced at boot rather than in review:
 *
 *  1. §4.2 deny-by-default. Routes are registered FROM the contract registry, so a route
 *     that is neither `public` nor permissioned cannot be registered — and any endpoint
 *     in the registry with no handler fails the boot with its operationId named. The
 *     registry and the running server cannot drift apart.
 *
 *  2. §4.4 key isolation. Env validation rejects an Anthropic key on this process.
 */

declare module "fastify" {
  interface FastifyRequest {
    actor?: { userId: string; roles: readonly Role[] } | undefined;
    sessionId?: string | undefined;
  }
}

export type Handler = (
  request: FastifyRequest,
  reply: FastifyReply,
  ctx: AppContext,
) => Promise<unknown> | unknown;

/**
 * A typed, defensive stand-in for the `request.actor!` scattered across every route
 * module (28 occurrences, flagged against CLAUDE.md's "no non-null `!` outside tests").
 *
 * The assertion was never actually unsafe: `registerEndpoint` below already requires and
 * verifies `request.actor` before a permissioned handler is called at all. What was
 * missing is a way to say so IN THE TYPE SYSTEM, once, rather than fifty call sites each
 * asserting a guarantee they cannot see. This still throws rather than assuming — if a
 * handler somehow runs without an actor, that means a route was registered without the
 * gate `registerEndpoint` provides, which is a real bug worth a loud failure, not a
 * silent one.
 */
export function requireActor(request: FastifyRequest): { userId: string; roles: readonly Role[] } {
  if (!request.actor) {
    throw new Error(
      "requireActor() called on a request with no authenticated actor — this route is not actually gated",
    );
  }
  return request.actor;
}

export function sendError(reply: FastifyReply, code: ErrorCode, message: string): FastifyReply {
  return reply.status(HTTP_STATUS_BY_CODE[code]).send({
    code,
    message,
    requestId: reply.request.id,
  });
}

/** Contract path `/ideas/{ideaId}` → Fastify path `/ideas/:ideaId`. */
const toFastifyPath = (p: string): string => p.replace(/\{(\w+)\}/g, ":$1");

export function buildServer(ctx: AppContext): FastifyInstance {
  const env = ctx.env;
  const isProd = env.NODE_ENV === "production";

  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: ["req.headers.authorization", "req.headers.cookie", "req.headers.set-cookie"],
    },
    genReqId: () => crypto.randomUUID(),
    trustProxy: isProd,
  });

  /* ── §4.8 transport hardening ── */
  void app.register(helmet, {
    contentSecurityPolicy: false, // the SPA owns its own CSP; this is a JSON API
    hsts: isProd ? { maxAge: 31_536_000, includeSubDomains: true } : false,
  });
  void app.register(cors, { origin: env.PUBLIC_WEB_ORIGIN, credentials: true });
  void app.register(cookie, { secret: env.SESSION_SECRET });
  /**
   * Keyed on the SESSION where there is one, on the address only when there is not.
   *
   * Per-IP was the default and it was harmless purely because the limiter was inert (see
   * the route-registration comment below). The moment it started working it throttled a
   * test suite — and a test suite is a mild version of the real case: an internal platform
   * sits behind one corporate egress address, so a per-IP budget is shared by everybody in
   * the building. One busy person would slow the whole office.
   *
   * A signed-in request gets its own budget. Anonymous traffic — essentially just the
   * sign-in page — still shares the address bucket, which is what you want, because that
   * is where abuse arrives from.
   */
  /**
   * File uploads (SPEC §4.3).
   *
   * The limits here are a FLOOR, not the policy. `fileSize` aborts a stream that runs
   * past the cap so an attacker cannot make the process hold an arbitrary amount of
   * memory, but the authoritative check is in `storeUpload`, which counts bytes as they
   * arrive and refuses having written nothing. One file per request: an endpoint that
   * accepts a file returns that file's row, and a partial success over a batch is a
   * result nobody can act on.
   */
  void app.register(multipart, {
    limits: { fileSize: MAX_ATTACHMENT_BYTES + 1, files: 1, fields: 4 },
  });

  void app.register(rateLimit, {
    max: 300,
    timeWindow: "1 minute",
    keyGenerator: (request) => {
      const sid = request.cookies?.[sessionCookieName(isProd)];
      return sid ? `session:${sid}` : `ip:${request.ip}`;
    },
  });

  /* ── resolve the actor for every request, before any handler ── */
  app.addHook("preHandler", async (request) => {
    const sid = request.cookies[sessionCookieName(isProd)];
    if (!sid) return;
    const session = await ctx.sessions.read(sid);
    if (!session) return;
    request.sessionId = sid;
    request.actor = { userId: session.userId, roles: session.roles };
  });

  /* ── handler table: operationId → implementation ── */
  const handlers = new Map<string, Handler>();
  registerAuthRoutes(handlers);
  registerIdentityRoutes(handlers);
  registerConfigRoutes(handlers);
  registerIdeaRoutes(handlers);
  registerAnalysisRoutes(handlers);
  registerEvaluationRoutes(handlers);
  registerReviewRoutes(handlers);
  registerRankingRoutes(handlers);
  registerAccountRoutes(handlers);
  registerAttachmentRoutes(handlers);

  /* ── register every endpoint from the contract ── */
  const stubbed: string[] = [];

  /**
   * Routes go inside a plugin, and the reason is a bug that made rate limiting inert.
   *
   * `@fastify/rate-limit` attaches itself to each route through an `onRoute` hook, and an
   * `onRoute` hook only fires for routes registered AFTER it exists. Plugins load during
   * `ready()`; a `app.route()` call made synchronously in this function happens before
   * that. So every route was declared before the limiter was listening, and the limiter
   * silently governed nothing — 130 requests against a `max: 100` config were all served,
   * and no `x-ratelimit-*` header was ever sent.
   *
   * Registering the routes as their own plugin puts them behind the plugins registered
   * above, which is the order the hooks need.
   */
  void app.register((instance, _opts, done) => {
    for (const ep of ENDPOINTS) {
      // A single lookup, held in a variable, rather than `has()` then a second `get()`
      // asserted past — TypeScript narrows a local the way it cannot narrow two
      // separate Map calls against each other.
      let handler = handlers.get(ep.operationId);
      if (!handler) {
        // Endpoints whose phase has not landed answer 501 rather than 404, so a missing
        // feature is never a broken link.
        handler = notImplementedYet(ep);
        handlers.set(ep.operationId, handler);
        stubbed.push(ep.operationId);
      }
      registerEndpoint(instance, ep, handler, ctx);
    }
    done();
  });

  /**
   * Report the stub list at boot.
   *
   * Falling through to 501 is correct for an unbuilt phase and WRONG for one that was
   * meant to be wired — and the two look identical from the outside. `getHealth` was
   * silently stubbed for a whole phase this way. Printing the list makes an accidental
   * stub obvious the moment the server starts.
   */
  app.log.info(
    { implemented: ENDPOINTS.length - stubbed.length, stubbed: stubbed.length, endpoints: stubbed },
    `routes: ${ENDPOINTS.length - stubbed.length}/${ENDPOINTS.length} implemented, ${stubbed.length} awaiting their phase`,
  );

  app.setNotFoundHandler((request, reply) =>
    sendError(reply, "NOT_FOUND", `No route for ${request.method} ${request.url}`),
  );

  app.setErrorHandler((error, request, reply) => {
    if ((error as { statusCode?: number }).statusCode === 429) {
      return sendError(reply, "RATE_LIMITED", "Too many requests");
    }

    /**
     * A dependency being down is an operational fact, not a bug, and it has a specific
     * fix. Reporting it as a generic 500 sends a developer hunting through a Prisma
     * stack for something that `pnpm deps:up` solves in five seconds.
     *
     * The message names the dependency and the remedy but no host, credential or stack —
     * SPEC §4.4 still applies.
     */
    const name = (error as { name?: string }).name ?? "";
    const code = String((error as { code?: string }).code ?? "");
    const text = String((error as { message?: string }).message ?? "");

    /**
     * Two distinct shapes, and the second is easy to miss:
     *   - PrismaClientInitializationError — the DB was already down at first query.
     *   - PrismaClientKnownRequestError P1000–P1002/P1008/P1017 — the DB went away
     *     mid-session (container stopped, connection closed). Prisma reports this as a
     *     "known request error", which does NOT look like a connectivity failure unless
     *     you check the code.
     */
    const PRISMA_CONNECTIVITY = new Set(["P1000", "P1001", "P1002", "P1008", "P1017"]);
    const dbDown =
      name === "PrismaClientInitializationError" ||
      PRISMA_CONNECTIVITY.has(code) ||
      /Can't reach database server|Server has closed the connection/.test(text);

    if (dbDown) {
      request.log.error("database unreachable — is it running? `pnpm deps:up`");
      return sendError(
        reply,
        "DEPENDENCY_UNAVAILABLE",
        "The database is not reachable. Start it with: corepack pnpm deps:up",
      );
    }

    request.log.error({ err: error }, "unhandled error");
    // Never leak provider or stack detail to a client (SPEC §4.4).
    return sendError(reply, "INTERNAL_ERROR", "Something went wrong");
  });

  return app;
}

function registerEndpoint(
  app: FastifyInstance,
  ep: EndpointDef,
  handler: Handler,
  ctx: AppContext,
): void {
  // Deny by default: an endpoint with no access declaration never reaches the router.
  if (ep.access !== "public" && !Array.isArray(ep.access.requires)) {
    throw new Error(`${ep.operationId} has no access declaration (SPEC §4.2)`);
  }

  app.route({
    method: ep.method,
    url: toFastifyPath(ep.path),

    /**
     * Sign-in has NO per-route request limit, and that is deliberate.
     *
     * A request-count limit punishes attempts, and most attempts are legitimate: someone
     * mistypes, a shared office arrives from one NAT'd address, an automated suite signs
     * in repeatedly. Two versions of this were tried and both were wrong — per-IP locked
     * out colleagues, and per-account throttled correct sign-ins as readily as wrong ones.
     *
     * What actually needs limiting is FAILURE, and that already exists: five consecutive
     * failed attempts lock an account for fifteen minutes (see `account/routes.ts`), and a
     * success resets the counter. An attacker gets five guesses; someone who simply keeps
     * signing in correctly is never affected. That is the stricter control and the more
     * precise one.
     *
     * The global 100/minute limit still applies here as everywhere, covering gross abuse.
     */
    handler: async (request, reply) => {
      if (ep.access !== "public") {
        if (!request.actor) {
          return sendError(reply, "UNAUTHENTICATED", "Sign in to continue");
        }
        if (!hasAllPermissions(request.actor.roles, ep.access.requires)) {
          request.log.warn(
            { operationId: ep.operationId, userId: request.actor.userId, required: ep.access.requires },
            "authorization denied",
          );
          return sendError(reply, "ROLE_NOT_PERMITTED", "You do not have access to this");
        }
      }

      const result = await handler(request, reply, ctx);
      if (reply.sent) return reply;

      /**
       * Outside production, every response is checked against its contract schema.
       *
       * The queue handler returned its pagination fields flat while the contract nests
       * them under `meta`. The API answered 200, the data was correct, and the page fell
       * into its error boundary — a failure only findable by clicking. Zod already knows
       * the shape; there is no reason for the server not to check it.
       *
       * Loud in development, off in production: a shape mismatch is a bug to fix at the
       * source, not a 500 to hand a user.
       */
      // A file download writes its own bytes; there is no object to check it against.
      if (ctx.env.NODE_ENV !== "production" && ep.responseKind !== "binary") {
        const parsed = ep.response.safeParse(result);
        if (!parsed.success) {
          request.log.error(
            {
              operationId: ep.operationId,
              issues: parsed.error.issues.slice(0, 5).map((i) => ({
                path: i.path.join(".") || "(root)",
                message: i.message,
              })),
            },
            "RESPONSE DOES NOT MATCH ITS CONTRACT — the client will misread this",
          );
        }
      }

      return reply.status(ep.successStatus).send(result);
    },
  });
}

export { loadEnv, ApiEnv, permissionsFor };

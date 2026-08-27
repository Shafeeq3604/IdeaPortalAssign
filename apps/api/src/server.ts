import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { ApiEnv, loadEnv } from "@iep/contracts/env";
import {
  ENDPOINTS, HTTP_STATUS_BY_CODE, hasAllPermissions, permissionsFor,
  type EndpointDef, type ErrorCode, type Role,
} from "@iep/contracts";
import { registerAuthRoutes } from "./modules/auth.routes.js";
import { registerIdentityRoutes } from "./modules/identity.routes.js";
import { registerConfigRoutes } from "./modules/config.routes.js";
import { registerIdeaRoutes } from "./modules/idea/routes.js";
import { registerAnalysisRoutes } from "./modules/analysis.routes.js";
import { registerEvaluationRoutes } from "./modules/evaluation/routes.js";
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
  void app.register(rateLimit, { max: 100, timeWindow: "1 minute" });

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

  /* ── register every endpoint from the contract ── */
  const stubbed: string[] = [];

  for (const ep of ENDPOINTS) {
    if (!handlers.has(ep.operationId)) {
      // Endpoints whose phase has not landed answer 501 rather than 404, so a missing
      // feature is never a broken link.
      handlers.set(ep.operationId, notImplementedYet(ep));
      stubbed.push(ep.operationId);
    }
    registerEndpoint(app, ep, handlers.get(ep.operationId)!, ctx);
  }

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
      return reply.status(ep.successStatus).send(result);
    },
  });
}

export { loadEnv, ApiEnv, permissionsFor };

import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Role, SessionResponse } from "@iep/contracts";
import type { AppContext } from "../context.js";
import type { Handler } from "../server.js";
import { sendError } from "../server.js";
import { sessionCookieName, sessionCookieOptions } from "../auth/session.js";
import { rolesFromGroups } from "../auth/provider.js";

/** Auth endpoints (FR-01). */

export function registerAuthRoutes(handlers: Map<string, Handler>): void {
  /**
   * Liveness probe. Deliberately says only that the process is alive — no version,
   * commit, or dependency detail, because this endpoint is unauthenticated (SPEC §4.3).
   */
  handlers.set("getHealth", () => ({
    status: "ok" as const,
    service: "iep-api",
    phase: "P1",
  }));

  handlers.set("getSession", async (request, reply, ctx) => {
    if (!request.actor) return sendError(reply, "UNAUTHENTICATED", "Not signed in");

    const user = await ctx.db.user.findUnique({
      where: { id: request.actor.userId },
      include: { department: true, roles: true },
    });
    // The session outlived the user (deactivated, deleted): revoke rather than 500.
    if (!user || !user.isActive) {
      if (request.sessionId) await ctx.sessions.destroy(request.sessionId);
      void reply.clearCookie(sessionCookieName(ctx.env.NODE_ENV === "production"), { path: "/" });
      return sendError(reply, "SESSION_EXPIRED", "Your session is no longer valid");
    }

    const body: SessionResponse = {
      user: {
        id: user.id,
        displayName: user.displayName,
        email: user.email,
        roles: user.roles.map((r) => r.role as Role) as [Role, ...Role[]],
        department: user.department ? { id: user.department.id, name: user.department.name } : null,
      },
    };
    return body;
  });

  handlers.set("logout", async (request, reply, ctx) => {
    // Server-side revocation is the whole reason sessions are not stateless (SPEC §4.1).
    if (request.sessionId) await ctx.sessions.destroy(request.sessionId);
    void reply.clearCookie(sessionCookieName(ctx.env.NODE_ENV === "production"), { path: "/" });
    return { ok: true as const };
  });
}

/**
 * Dev-only sign-in.
 *
 * Deliberately NOT in the contract registry: it is not part of the API surface, so it
 * must never appear in openapi.json. It refuses to register outside development, and
 * `DevAuthProvider` refuses to construct in production — two independent guards, because
 * one of them will eventually be edited by someone who does not know about the other.
 */
export function registerDevLogin(app: FastifyInstance, ctx: AppContext): void {
  if (ctx.env.NODE_ENV === "production" || ctx.auth.kind !== "dev") return;

  app.post("/auth/dev/login", async (request, reply) => {
    const parsed = z.object({ email: z.string().email() }).safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, "VALIDATION_FAILED", "An email of a seeded user is required");
    }

    const identity = await ctx.auth.completeLogin({ email: parsed.data.email });
    const user = await ctx.db.user.findUnique({
      where: { email: identity.email },
      include: { roles: true },
    });
    if (!user || !user.isActive) {
      return sendError(reply, "NOT_FOUND", "No such seeded user — run `pnpm db:seed`");
    }

    const roles = user.roles.map((r) => r.role as Role);
    // Session id rotates on login: a pre-set id is worthless (SPEC §4.1).
    const sid = await ctx.sessions.create({ userId: user.id, roles, createdAt: Date.now() });
    const isProd = ctx.env.NODE_ENV === "production";

    void reply.setCookie(sessionCookieName(isProd), sid, sessionCookieOptions(isProd));
    return reply.status(200).send({ ok: true, userId: user.id, roles });
  });

  app.get("/auth/dev/users", async (_request, _reply) => {
    const users = await ctx.db.user.findMany({
      where: { isActive: true },
      include: { roles: true },
      orderBy: { email: "asc" },
    });
    return {
      users: users.map((u) => ({
        email: u.email,
        displayName: u.displayName,
        roles: u.roles.map((r) => r.role),
      })),
    };
  });
}

export { rolesFromGroups };

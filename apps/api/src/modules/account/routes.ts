import {
  CreateUserRequest, LoginRequest, SetFeedbackRequest, SignupRequest, UpdateUserRequest, can,
} from "@iep/contracts";
import type { IdeaStatus, Role, SessionResponse, SignupOptions } from "@iep/contracts";
import type { Handler } from "../../server.js";
import { requireActor, sendError } from "../../server.js";
import { sessionCookieName, sessionCookieOptions } from "../../auth/session.js";
import { hashPassword, passwordProblem, safeEqual, verifyPassword } from "../../auth/password.js";
import { writeAudit } from "../../lib/audit.js";
import type { Tx } from "../../lib/audit.js";

/**
 * Sign-in, account management and idea feedback (ADR-023, FR-01, FR-18).
 *
 * The three sit together because they share one rule: a password hash never leaves this
 * file. Nothing here selects `passwordHash` into a response, and the contract types have
 * no field that could carry one even by accident.
 */

/** Lock the account after this many consecutive failures (NFR-01). */
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

/** One message for every sign-in failure. */
const SIGNIN_FAILED =
  "That email and password do not match an active account.";

export function registerAccountRoutes(handlers: Map<string, Handler>): void {
  handlers.set("login", async (request, reply, ctx) => {
    const parsed = LoginRequest.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, "VALIDATION_FAILED", "Enter your email and password");
    }

    const email = parsed.data.email.toLowerCase();
    const user = await ctx.db.user.findUnique({
      where: { email },
      include: { roles: true },
    });

    /**
     * Locked accounts are refused before the hash is even checked, and the message is the
     * only one that differs — a person who has locked themselves out needs to know why,
     * and an attacker learns nothing they did not already cause.
     */
    if (user?.lockedUntil && user.lockedUntil > new Date()) {
      const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
      return sendError(
        reply, "RATE_LIMITED",
        `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}, ` +
          "or ask an administrator to reset your password.",
      );
    }

    /**
     * The hash is verified even when there is no user, against a decoy.
     *
     * Returning early on an unknown email makes that case microseconds fast and a real
     * one ~50ms slow, which turns the sign-in form into an account-enumeration oracle.
     */
    const ok =
      (await verifyPassword(user?.passwordHash ?? null, parsed.data.password)) &&
      (user?.isActive ?? false);

    // `!user` is redundant with `!ok` in practice — `ok` cannot be true without a user —
    // but stating it here is what lets TypeScript narrow `user` for the rest of the
    // function, instead of five separate `user!` assertions doing it by hand.
    if (!ok || !user) {
      if (user) {
        const failed = user.failedLogins + 1;
        await ctx.db.user.update({
          where: { id: user.id },
          data: {
            failedLogins: failed,
            lockedUntil:
              failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
          },
        });
      }
      // Identical for wrong password, unknown email and deactivated account.
      return sendError(reply, "UNAUTHENTICATED", SIGNIN_FAILED);
    }

    const roles = user.roles.map((r) => r.role as Role);
    // The session id rotates on every sign-in — a pre-set one is worthless (SPEC §4.1).
    const sid = await ctx.sessions.create({ userId: user.id, roles, createdAt: Date.now() });
    const isProd = ctx.env.NODE_ENV === "production";
    void reply.setCookie(sessionCookieName(isProd), sid, sessionCookieOptions(isProd));

    await ctx.db.user.update({
      where: { id: user.id },
      data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    const full = await ctx.db.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { department: true, roles: true },
    });

    const body: SessionResponse = {
      user: {
        id: full.id,
        displayName: full.displayName,
        email: full.email,
        roles: full.roles.map((r) => r.role as Role) as [Role, ...Role[]],
        department: full.department
          ? { id: full.department.id, name: full.department.name }
          : null,
      },
    };
    return body;
  });

  /* ── Self-registration (FR-01a) ── */

  handlers.set("signupOptions", async (_request, _reply, ctx) => {
    const body: SignupOptions = {
      enabled: ctx.env.SIGNUP_ENABLED,
      allowedEmailDomains: ctx.env.SIGNUP_ALLOWED_EMAIL_DOMAINS,
      // Whether the bootstrap window is open, not whether a code was configured. Saying
      // "a code exists" to an anonymous caller would be an invitation to guess it.
      adminBootstrapAvailable:
        Boolean(ctx.env.ADMIN_INVITE_CODE) && (await bootstrapOpen(ctx.db)),
    };
    return body;
  });

  handlers.set("signup", async (request, reply, ctx) => {
    if (!ctx.env.SIGNUP_ENABLED) {
      return sendError(
        reply, "ROLE_NOT_PERMITTED",
        "Self-registration is turned off here. Ask an administrator for an account.",
      );
    }

    const parsed = SignupRequest.safeParse(request.body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return sendError(reply, "VALIDATION_FAILED", first?.message ?? "Check the details");
    }

    const problem = passwordProblem(parsed.data.password);
    if (problem) return sendError(reply, "VALIDATION_FAILED", problem);

    const email = parsed.data.email.toLowerCase();
    const domain = email.slice(email.lastIndexOf("@") + 1);
    const allowed = ctx.env.SIGNUP_ALLOWED_EMAIL_DOMAINS;
    if (allowed.length > 0 && !allowed.includes(domain)) {
      return sendError(
        reply, "VALIDATION_FAILED",
        `Registration is open to ${allowed.map((d) => "@" + d).join(", ")} addresses.`,
      );
    }

    /**
     * ADMIN, but only into an empty building.
     *
     * Both halves are checked here and again inside the transaction, because between the
     * two a real administrator may have been created and the window must have closed. The
     * unique index on `email` plus the re-check under the transaction is what makes two
     * simultaneous bootstrap attempts resolve to one administrator rather than two.
     */
    const wantsAdmin = Boolean(
      parsed.data.inviteCode &&
        ctx.env.ADMIN_INVITE_CODE &&
        safeEqual(parsed.data.inviteCode, ctx.env.ADMIN_INVITE_CODE),
    );
    if (parsed.data.inviteCode && !wantsAdmin) {
      return sendError(reply, "VALIDATION_FAILED", "That invite code is not valid.");
    }

    if (await ctx.db.user.findUnique({ where: { email } })) {
      return sendError(
        reply, "CONCURRENT_MODIFICATION",
        "An account already exists for that email. Try signing in instead.",
      );
    }

    let created;
    try {
      created = await ctx.db.$transaction(async (tx) => {
        const stillOpen = wantsAdmin && (await bootstrapOpen(tx));
        if (wantsAdmin && !stillOpen) {
          throw new BootstrapClosed();
        }

        const roles: Role[] = stillOpen ? ["EMPLOYEE", "ADMIN"] : ["EMPLOYEE"];

        const user = await tx.user.create({
          data: {
            email,
            displayName: parsed.data.displayName,
            externalSubject: `password|${email}`,
            // Left unset on purpose: an administrator assigns the department, because a
            // self-declared one would end up in the dashboards as fact.
            departmentId: null,
            passwordHash: await hashPassword(parsed.data.password),
            passwordSetAt: new Date(),
          },
        });
        await tx.userRole.createMany({
          data: roles.map((role) => ({ userId: user.id, role })),
        });

        /**
         * Only the bootstrap admin is audited, and it is audited as its own actor.
         *
         * An ordinary person registering themselves is not a decision anybody made — the
         * account row and its createdAt already record it, and writing every signup to
         * the governance trail would bury the decisions that trail exists for. Same
         * argument that keeps thumbs up and down out of it.
         *
         * Granting the very FIRST administrator is a decision, taken by whoever held
         * the code, and it is the one signup somebody will need to find later.
         *
         * A second consequence worth naming: `audit_log` is append-only by trigger and
         * its actor foreign key is Restrict, so an audited account can never be deleted
         * afterwards. Right for an administrator; wrong as a blanket rule for everyone
         * who ever filled in the sign-up form.
         */
        if (stillOpen) {
          await writeAudit(tx, {
            actorId: user.id,
            action: "user.signup",
            entityType: "user",
            entityId: user.id,
            after: { email, roles, adminBootstrap: true },
            requestId: request.id,
          });
        }

        return { user, roles };
      });
    } catch (error) {
      if (error instanceof BootstrapClosed) {
        return sendError(
          reply, "CONCURRENT_MODIFICATION",
          "An administrator already exists, so the invite code no longer applies. Sign up " +
            "without it and ask them to grant you access.",
        );
      }
      throw error;
    }

    // Signed in immediately: making someone type the password they just chose, on the
    // screen they just left, is a step with no purpose.
    const isProd = ctx.env.NODE_ENV === "production";
    const sid = await ctx.sessions.create({
      userId: created.user.id,
      roles: created.roles,
      createdAt: Date.now(),
    });
    void reply.setCookie(sessionCookieName(isProd), sid, sessionCookieOptions(isProd));
    await ctx.db.user.update({
      where: { id: created.user.id },
      data: { lastLoginAt: new Date() },
    });

    const body: SessionResponse = {
      user: {
        id: created.user.id,
        displayName: created.user.displayName,
        email: created.user.email,
        roles: created.roles as [Role, ...Role[]],
        department: null,
      },
    };
    return reply.status(201).send(body);
  });

  handlers.set("createUser", async (request, reply, ctx) => {
    const parsed = CreateUserRequest.safeParse(request.body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return sendError(reply, "VALIDATION_FAILED", first?.message ?? "Check the details");
    }

    const problem = passwordProblem(parsed.data.initialPassword);
    if (problem) return sendError(reply, "VALIDATION_FAILED", problem);

    const email = parsed.data.email.toLowerCase();
    if (await ctx.db.user.findUnique({ where: { email } })) {
      return sendError(reply, "CONCURRENT_MODIFICATION", "An account with that email already exists");
    }

    const actor = requireActor(request);
    const created = await ctx.db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          displayName: parsed.data.displayName,
          // No external IdP yet, so the subject is the local account's own identity.
          externalSubject: `password|${email}`,
          departmentId: parsed.data.departmentId ?? null,
          passwordHash: await hashPassword(parsed.data.initialPassword),
          passwordSetAt: new Date(),
        },
      });
      await tx.userRole.createMany({
        data: parsed.data.roles.map((role) => ({ userId: user.id, role })),
      });
      await writeAudit(tx, {
        actorId: actor.userId,
        action: "user.create",
        entityType: "user",
        entityId: user.id,
        // The roles granted are the security-relevant part. The password is not recorded
        // in any form, not even as "a password was set".
        after: { email, roles: parsed.data.roles },
        requestId: request.id,
      });
      return user;
    });

    return reply.status(201).send(await presentAdminUser(ctx, created.id));
  });

  handlers.set("listDepartments", async (_request, _reply, ctx) => {
    const items = await ctx.db.department.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    return { items };
  });

  handlers.set("updateUser", async (request, reply, ctx) => {
    const parsed = UpdateUserRequest.safeParse(request.body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return sendError(reply, "VALIDATION_FAILED", first?.message ?? "Check the details");
    }

    const { userId } = request.params as { userId: string };
    const actor = requireActor(request);
    const existing = await ctx.db.user.findUnique({ where: { id: userId }, include: { roles: true } });
    if (!existing) return sendError(reply, "NOT_FOUND", "No user with that id");

    if (parsed.data.newPassword) {
      const problem = passwordProblem(parsed.data.newPassword);
      if (problem) return sendError(reply, "VALIDATION_FAILED", problem);
    }

    /**
     * An administrator may not remove their own last administrator role, and may not
     * deactivate themselves.
     *
     * Both are one click from locking the organisation out of its own platform, and
     * neither has a legitimate use — another admin can always do it for them.
     */
    if (userId === actor.userId) {
      if (parsed.data.isActive === false) {
        return sendError(reply, "VALIDATION_FAILED", "You cannot deactivate your own account.");
      }
      if (parsed.data.roles && !parsed.data.roles.includes("ADMIN")) {
        return sendError(
          reply, "VALIDATION_FAILED",
          "You cannot remove your own administrator role. Ask another administrator.",
        );
      }
    }

    await ctx.db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          ...(parsed.data.displayName ? { displayName: parsed.data.displayName } : {}),
          ...(parsed.data.departmentId !== undefined
            ? { departmentId: parsed.data.departmentId }
            : {}),
          ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
          ...(parsed.data.newPassword
            ? {
                passwordHash: await hashPassword(parsed.data.newPassword),
                passwordSetAt: new Date(),
                // A new password clears a lockout: that is what the admin is fixing.
                failedLogins: 0,
                lockedUntil: null,
              }
            : {}),
        },
      });

      if (parsed.data.roles) {
        await tx.userRole.deleteMany({ where: { userId } });
        await tx.userRole.createMany({
          data: parsed.data.roles.map((role) => ({ userId, role })),
        });
      }

      await writeAudit(tx, {
        actorId: actor.userId,
        action: "user.update",
        entityType: "user",
        entityId: userId,
        before: {
          roles: existing.roles.map((r) => r.role),
          isActive: existing.isActive,
        },
        after: {
          roles: parsed.data.roles ?? existing.roles.map((r) => r.role),
          isActive: parsed.data.isActive ?? existing.isActive,
          // Recorded as a fact, never as a value.
          passwordChanged: Boolean(parsed.data.newPassword),
        },
        requestId: request.id,
      });
    });

    return presentAdminUser(ctx, userId);
  });

  /* ── Feedback (FR-18) ── */

  handlers.set("getIdeaFeedback", async (request, reply, ctx) => {
    const { ideaId } = request.params as { ideaId: string };
    const idea = await readableIdea(request, ctx, ideaId);
    if (!idea) return sendError(reply, "NOT_FOUND", "No idea with that id");
    return summariseFeedback(ctx, ideaId, requireActor(request).userId);
  });

  handlers.set("setIdeaFeedback", async (request, reply, ctx) => {
    const parsed = SetFeedbackRequest.safeParse(request.body);
    if (!parsed.success) return sendError(reply, "VALIDATION_FAILED", "Send UP, DOWN or null");

    const { ideaId } = request.params as { ideaId: string };
    const idea = await readableIdea(request, ctx, ideaId);
    if (!idea) return sendError(reply, "NOT_FOUND", "No idea with that id");

    const userId = requireActor(request).userId;

    /**
     * One row per person per idea, replaced on change and deleted on clear.
     *
     * Storing a history of votes would let someone's changed mind read as two votes, and
     * the totals are all this is for. No audit entry either: a thumb is not a decision
     * about an idea's fate, and filling the governance trail with them would bury the
     * decisions that are.
     */
    await ctx.db.feedback.deleteMany({
      where: { ideaId, userId, type: { in: ["WOULD_USE", "SEE_RISK"] } },
    });

    if (parsed.data.vote) {
      await ctx.db.feedback.create({
        data: {
          ideaId,
          userId,
          // Mapped onto the P0 enum rather than widening it: "I would use this" and
          // "I see a risk here" are what a thumb up and down actually mean here.
          type: parsed.data.vote === "UP" ? "WOULD_USE" : "SEE_RISK",
        },
      });
    }

    return summariseFeedback(ctx, ideaId, userId);
  });
}

/* ── helpers ── */

/**
 * True while the platform has no active administrator. Closes for good on the first.
 *
 * Takes a transaction client OR the root client, because the answer has to be re-read
 * inside the signup transaction as well as outside it.
 */
async function bootstrapOpen(db: Tx | Parameters<Handler>[2]["db"]): Promise<boolean> {
  const admins = await db.user.count({
    where: { isActive: true, roles: { some: { role: "ADMIN" } } },
  });
  return admins === 0;
}

/** Thrown inside the signup transaction when an administrator appeared underneath it. */
class BootstrapClosed extends Error {}

async function readableIdea(
  request: Parameters<Handler>[0],
  ctx: Parameters<Handler>[2],
  ideaId: string,
) {
  const idea = await ctx.db.idea.findUnique({ where: { id: ideaId } });
  if (!idea) return null;
  return can(requireActor(request), "idea:read", {
    ideaId: idea.id,
    submitterId: idea.submitterId,
    status: idea.status as IdeaStatus,
  }).allowed
    ? idea
    : null;
}

async function summariseFeedback(
  ctx: Parameters<Handler>[2],
  ideaId: string,
  userId: string,
) {
  const [up, down, mine] = await Promise.all([
    ctx.db.feedback.count({ where: { ideaId, type: "WOULD_USE" } }),
    ctx.db.feedback.count({ where: { ideaId, type: "SEE_RISK" } }),
    ctx.db.feedback.findFirst({
      where: { ideaId, userId, type: { in: ["WOULD_USE", "SEE_RISK"] } },
      select: { type: true },
    }),
  ]);

  return {
    ideaId,
    up,
    down,
    myVote: mine ? (mine.type === "WOULD_USE" ? ("UP" as const) : ("DOWN" as const)) : null,
  };
}

/** The admin view of a user. Note what is absent: any password field at all. */
async function presentAdminUser(ctx: Parameters<Handler>[2], userId: string) {
  const user = await ctx.db.user.findUniqueOrThrow({
    where: { id: userId },
    include: { department: true, roles: true, _count: { select: { ideas: true } } },
  });
  return {
    id: user.id,
    displayName: user.displayName,
    email: user.email,
    roles: user.roles.map((r) => r.role as Role),
    department: user.department ? { id: user.department.id, name: user.department.name } : null,
    isActive: user.isActive,
    ideaCount: user._count.ideas,
  };
}

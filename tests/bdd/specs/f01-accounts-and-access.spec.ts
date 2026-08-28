import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@iep/db";
import type { ApiEnv } from "@iep/contracts/env";
import { buildServer } from "@iep/api/src/server.js";
import type { AppContext } from "@iep/api/src/context.js";
import { MemorySessionStore, sessionCookieName } from "@iep/api/src/auth/session.js";

/**
 * F-01 — Getting in, and being let in (FR-01, FR-01a, ADR-023), as a FLOW.
 *
 * This is the first HTTP-level suite in the repository, and it exists because the rules
 * that matter here are not in any one function. "A self-registered account cannot be an
 * administrator" is true only if the contract has no field for it, the handler ignores
 * what it is sent, AND the response reflects that. Only a request can check all three.
 *
 * It drives the real Fastify instance through `app.inject()` — real routing, real
 * validation, real cookies, real Argon2 — against a real database, with only the session
 * store and the two queues replaced. Those two are replaced because Redis being down must
 * not turn a security assertion into a flake.
 */

const DATABASE_URL = process.env["DATABASE_URL"] ?? "postgresql://iep:iep@localhost:5433/iep";
const db = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

const INVITE_CODE = "bdd-invite-code-long-enough";
/** Long enough to satisfy the server's own rule, so a rejection means something else. */
const GOOD_PASSWORD = "correct horse battery staple";

let reachable = false;
const createdUsers: string[] = [];

function makeApp(overrides: Partial<ApiEnv> = {}) {
  const env = {
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    DATABASE_URL,
    REDIS_URL: "redis://localhost:6380",
    PORT: 3001,
    PUBLIC_WEB_ORIGIN: "http://localhost:5173",
    SESSION_SECRET: "bdd-session-secret-at-least-32-characters",
    OIDC_ISSUER: "https://example-idp.invalid",
    OIDC_CLIENT_ID: "bdd",
    OIDC_CLIENT_SECRET: "bdd",
    OIDC_REDIRECT_URI: "http://localhost:3001/auth/callback",
    ATTACHMENT_STORAGE_DIR: "./.storage",
    SIGNUP_ENABLED: true,
    SIGNUP_ALLOWED_EMAIL_DOMAINS: [] as string[],
    ...overrides,
  } as ApiEnv;

  const ctx: AppContext = {
    env,
    db,
    sessions: new MemorySessionStore(),
    auth: { authorizeUrl: () => "", exchange: async () => ({ subject: "", email: "", name: "" }) } as never,
    analysis: { enqueue: async () => true },
    ranking: { enqueue: async () => true },
  };
  return buildServer(ctx);
}

/** A unique address per assertion, so one spec's leftovers never fail the next. */
let seq = 0;
const freshEmail = (label: string) => `bdd-${label}-${(seq += 1)}-${process.pid}@example.test`;

beforeAll(async () => {
  try {
    await db.$queryRaw`SELECT 1`;
    reachable = true;
  } catch {
    /* left unreachable; guard() reports it per test */
  }
});

afterAll(async () => {
  if (reachable && createdUsers.length > 0) {
    /**
     * One at a time, and best-effort.
     *
     * `audit_log` is append-only by trigger and its actor foreign key is Restrict, so
     * an account that has appeared in it CANNOT be deleted — not by this suite and not
     * by anyone. Ordinary signups are not audited, so those go; anything that is stays,
     * and says so rather than throwing in a hook where the message would be lost.
     */
    const stuck: string[] = [];
    for (const id of createdUsers) {
      await db.user.delete({ where: { id } }).catch(() => stuck.push(id));
    }
    if (stuck.length > 0) {
      console.warn(
        `f01: left ${stuck.length} account(s) in place — they appear in the audit log, ` +
          "which is append-only by design.",
      );
    }
  }
  await db.$disconnect();
});

const guard = () => {
  if (!reachable) throw new Error("database unreachable — run `pnpm deps:up` before the BDD flows");
};

/** Track everything the suite creates, whatever the outcome, so cleanup is complete. */
async function trackByEmail(email: string) {
  const user = await db.user.findUnique({ where: { email: email.toLowerCase() } });
  if (user) createdUsers.push(user.id);
  return user;
}

describe("F-01 · self-registration", () => {
  it("Given a new person, When they sign up, Then they are an EMPLOYEE and signed in", async () => {
    guard();
    const app = makeApp();
    const email = freshEmail("employee");

    const response = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { displayName: "New Person", email, password: GOOD_PASSWORD },
    });
    const user = await trackByEmail(email);

    expect(response.statusCode, response.body).toBe(201);
    expect(response.json().user.roles).toEqual(["EMPLOYEE"]);

    // Signed in on the spot — no second trip through the sign-in form.
    expect(
      response.cookies.map((c) => c.name),
      "no session cookie — they would have to sign in again immediately",
    ).toContain(sessionCookieName(false));

    /**
     * The password is stored as an Argon2id hash and as nothing else.
     *
     * Asserted against the DATABASE, not the response, because the response not containing
     * it proves only that the presenter is careful today.
     */
    expect(user?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user?.passwordHash).not.toContain(GOOD_PASSWORD);
    expect(JSON.stringify(response.json())).not.toContain(GOOD_PASSWORD);

    await app.close();
  });

  it("Given a request that asks for ADMIN, Then the extra field is ignored entirely", async () => {
    guard();
    const app = makeApp();
    const email = freshEmail("escalate");

    const response = await app.inject({
      method: "POST",
      url: "/auth/signup",
      // The field does not exist in the contract. This asserts what happens when someone
      // sends it anyway, which is the only version of this test worth having.
      payload: {
        displayName: "Would Be Admin",
        email,
        password: GOOD_PASSWORD,
        roles: ["ADMIN"],
        isActive: true,
      },
    });
    await trackByEmail(email);

    expect(response.statusCode).toBe(201);
    expect(response.json().user.roles).toEqual(["EMPLOYEE"]);

    const roles = await db.userRole.findMany({
      where: { user: { email: email.toLowerCase() } },
      select: { role: true },
    });
    expect(roles.map((r) => r.role)).toEqual(["EMPLOYEE"]);

    await app.close();
  });

  it("Given a domain allowlist, Then an address outside it is refused", async () => {
    guard();
    const app = makeApp({ SIGNUP_ALLOWED_EMAIL_DOMAINS: ["sageitinc.com"] });
    const email = freshEmail("outsider");

    const response = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { displayName: "Outsider", email, password: GOOD_PASSWORD },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain("@sageitinc.com");
    expect(await db.user.findUnique({ where: { email: email.toLowerCase() } })).toBeNull();

    await app.close();
  });

  it("Given signup is turned off, Then nobody registers and the form is told so", async () => {
    guard();
    const app = makeApp({ SIGNUP_ENABLED: false });
    const email = freshEmail("closed");

    const attempt = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { displayName: "Too Late", email, password: GOOD_PASSWORD },
    });
    expect(attempt.statusCode).toBe(403);
    expect(await db.user.findUnique({ where: { email: email.toLowerCase() } })).toBeNull();

    // …and the page can find that out before anyone types a password.
    const options = await app.inject({ method: "GET", url: "/auth/signup-options" });
    expect(options.json().enabled).toBe(false);

    await app.close();
  });

  it("Given a password under 12 characters, Then it is refused with the rule stated", async () => {
    guard();
    const app = makeApp();
    const email = freshEmail("short");

    const response = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { displayName: "Short", email, password: "hunter2" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().message).toMatch(/12 characters/);
    expect(await db.user.findUnique({ where: { email: email.toLowerCase() } })).toBeNull();

    await app.close();
  });
});

describe("F-01 · the administrator bootstrap window", () => {
  it("Given an administrator already exists, Then the invite code grants nothing", async () => {
    guard();

    /**
     * The seeded database has an administrator, which is the state every real deployment
     * is in after its first day. If this assertion ever needs the seed removed to pass,
     * the window is not closing when it should.
     */
    const admins = await db.user.count({
      where: { isActive: true, roles: { some: { role: "ADMIN" } } },
    });
    expect(admins, "the seeded admin is missing — run `pnpm db:seed`").toBeGreaterThan(0);

    const app = makeApp({ ADMIN_INVITE_CODE: INVITE_CODE });

    // The public options endpoint does not advertise a window that is shut.
    const options = await app.inject({ method: "GET", url: "/auth/signup-options" });
    expect(options.json().adminBootstrapAvailable).toBe(false);

    const email = freshEmail("late-admin");
    const response = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: {
        displayName: "Late Admin",
        email,
        password: GOOD_PASSWORD,
        inviteCode: INVITE_CODE,
      },
    });
    await trackByEmail(email);

    // Refused outright rather than quietly downgraded: someone holding a code that no
    // longer works needs to be told, not handed an account that is not what they asked for.
    expect(response.statusCode).toBe(409);
    expect(response.json().message).toMatch(/administrator already exists/i);

    await app.close();
  });

  it("Given a wrong invite code, Then the signup is refused rather than downgraded", async () => {
    guard();
    const app = makeApp({ ADMIN_INVITE_CODE: INVITE_CODE });
    const email = freshEmail("wrong-code");

    const response = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: {
        displayName: "Guesser",
        email,
        password: GOOD_PASSWORD,
        inviteCode: "not-the-code-but-long-enough",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(await db.user.findUnique({ where: { email: email.toLowerCase() } })).toBeNull();

    await app.close();
  });

  it("Given no code is configured, Then presenting one is still refused", async () => {
    guard();
    const app = makeApp();
    const email = freshEmail("no-code-configured");

    const response = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: {
        displayName: "Hopeful",
        email,
        password: GOOD_PASSWORD,
        inviteCode: "anything-at-all-here",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(await db.user.findUnique({ where: { email: email.toLowerCase() } })).toBeNull();

    await app.close();
  });
});

describe("F-01 · signing in", () => {
  it("Given the account they just made, Then they can sign in with it", async () => {
    guard();
    const app = makeApp();
    const email = freshEmail("roundtrip");

    await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { displayName: "Round Trip", email, password: GOOD_PASSWORD },
    });
    await trackByEmail(email);

    const signIn = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: email.toUpperCase(), password: GOOD_PASSWORD },
    });

    // Upper-cased on purpose: an address is not case-sensitive, and someone whose phone
    // capitalised the first letter must not be locked out by it.
    expect(signIn.statusCode, signIn.body).toBe(200);
    expect(signIn.json().user.email).toBe(email.toLowerCase());

    await app.close();
  });

  it("Given a wrong password and an unknown email, Then the two are indistinguishable", async () => {
    guard();
    const app = makeApp();
    const email = freshEmail("enumeration");

    await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { displayName: "Known", email, password: GOOD_PASSWORD },
    });
    await trackByEmail(email);

    const wrongPassword = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email, password: "definitely not the password" },
    });
    const unknownEmail = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: freshEmail("nobody"), password: "definitely not the password" },
    });

    /**
     * Identical status AND identical text.
     *
     * A different message for "no such account" turns the sign-in form into a way to test
     * whether a given colleague has registered — which is a disclosure on its own, and on
     * a platform where people submit criticism of their own department, not a small one.
     */
    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownEmail.statusCode).toBe(401);
    expect(wrongPassword.json().message).toBe(unknownEmail.json().message);

    await app.close();
  });

  it("Given five failures, Then the account locks and says for how long", async () => {
    guard();
    const app = makeApp();
    const email = freshEmail("lockout");

    await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { displayName: "Locked Out", email, password: GOOD_PASSWORD },
    });
    await trackByEmail(email);

    for (let i = 0; i < 5; i += 1) {
      await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email, password: `wrong-${i}` },
      });
    }

    // Even the RIGHT password is refused now. A lockout that the real password walks
    // through protects nothing.
    const afterLock = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email, password: GOOD_PASSWORD },
    });

    expect(afterLock.statusCode).toBe(429);
    expect(afterLock.json().message).toMatch(/minute/);

    await app.close();
  });

  it("Given a deactivated account, Then sign-in fails with the same message as any other", async () => {
    guard();
    const app = makeApp();
    const email = freshEmail("deactivated");

    await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { displayName: "Gone", email, password: GOOD_PASSWORD },
    });
    await trackByEmail(email);
    await db.user.update({
      where: { email: email.toLowerCase() },
      data: { isActive: false },
    });

    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email, password: GOOD_PASSWORD },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().message).toMatch(/do not match an active account/);

    await app.close();
  });
});

describe("F-01 · what a response may carry", () => {
  it("Given any account endpoint, Then no response body contains a password hash", async () => {
    guard();
    const app = makeApp();
    const email = freshEmail("no-hash");

    const signup = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { displayName: "No Hash", email, password: GOOD_PASSWORD },
    });
    const user = await trackByEmail(email);
    const cookie = signup.cookies.map((c) => `${c.name}=${c.value}`).join("; ");

    const session = await app.inject({ method: "GET", url: "/auth/session", headers: { cookie } });

    /**
     * The hash is the thing an attacker actually wants, and it leaks by accident — one
     * Prisma `include` in place of a `select` puts every user column into a payload that
     * looks fine. That exact bug shipped once in this repository, on idea reads.
     */
    for (const body of [signup.body, session.body]) {
      expect(body).not.toContain("$argon2");
      expect(body).not.toContain("passwordHash");
      expect(body).not.toContain("password_hash");
      if (user?.passwordHash) expect(body).not.toContain(user.passwordHash);
    }

    await app.close();
  });
});

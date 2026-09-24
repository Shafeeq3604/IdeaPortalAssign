import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@iep/db";
import type { ApiEnv } from "@iep/contracts/env";
import { buildServer } from "@iep/api/src/server.js";
import type { AppContext } from "@iep/api/src/context.js";
import { MemorySessionStore } from "@iep/api/src/auth/session.js";
import { makeIdeaRepo } from "@iep/api/src/modules/idea/repo.js";
import { LocalDiskBackend } from "@iep/api/src/modules/idea/attachments.js";

/**
 * F-10 — Structured feedback: the five reasons beyond the thumb vote (FR-18, P11), as a
 * FLOW.
 *
 * Built against a deliberate decision, not the open-ended "comments and discussion" a
 * feature request first asked for: the P0-frozen `Feedback` table caps one person to one
 * row per `(idea, reason)` — `@@unique([ideaId, userId, type])` — so this is a structured
 * signal (pick a reason, optionally explain why, once), never a reply thread. That
 * constraint is the thing worth proving here, alongside the P-1 rule every reaction in
 * this product already follows: none of it ever reaches the ranking engine.
 */

const DATABASE_URL = process.env["DATABASE_URL"] ?? "postgresql://iep:iep@localhost:5433/iep";
const db = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

let reachable = false;
let submitterId = "";
let otherUserId = "";
let thirdUserId = "";
const createdIdeas: string[] = [];

function makeApp() {
  const ctx: AppContext = {
    env: {
      NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL,
      REDIS_URL: "redis://localhost:6380", PORT: 3001,
      PUBLIC_WEB_ORIGIN: "http://localhost:5173",
      SESSION_SECRET: "bdd-session-secret-at-least-32-characters",
      OIDC_ISSUER: "https://x.invalid", OIDC_CLIENT_ID: "x",
      OIDC_CLIENT_SECRET: "x", OIDC_REDIRECT_URI: "http://localhost:3001/cb",
      ATTACHMENT_STORAGE_DIR: "./.storage",
      SIGNUP_ENABLED: true, SIGNUP_ALLOWED_EMAIL_DOMAINS: [],
    } as unknown as ApiEnv,
    db,
    sessions: new MemorySessionStore(),
    auth: {} as never,
    analysis: { enqueue: async () => true },
    ranking: { enqueue: async () => true },
    discovery: { enqueue: async () => true },
    ideaCreation: { enqueue: async () => true },
    attachments: new LocalDiskBackend("./.storage"),
  };
  return buildServer(ctx);
}

beforeAll(async () => {
  try {
    await db.$queryRaw`SELECT 1`;
    reachable = true;
  } catch {
    return;
  }
  const employee = await db.user.findUnique({ where: { email: "employee@example.invalid" } });
  const reviewer = await db.user.findUnique({ where: { email: "reviewer@example.invalid" } });
  // ADMIN, not MANAGEMENT: the read policy is "ranked+" for an EMPLOYEE and "evaluated+"
  // for MANAGEMENT (permission matrix), and these fixtures are merely SUBMITTED — no
  // pipeline actually runs (the analysis queue is stubbed). REVIEWER/ADMIN can read any
  // idea regardless of status, which is what this suite's "a third reader" needs.
  const admin = await db.user.findUnique({ where: { email: "admin@example.invalid" } });
  submitterId = employee?.id ?? "";
  otherUserId = reviewer?.id ?? "";
  thirdUserId = admin?.id ?? "";
});

afterAll(async () => {
  if (reachable && createdIdeas.length > 0) {
    await db.feedback.deleteMany({ where: { ideaId: { in: createdIdeas } } });
    await db.idea.deleteMany({ where: { id: { in: createdIdeas } } });
  }
  await db.$disconnect();
});

const guard = () => {
  if (!reachable) throw new Error("database unreachable — run `pnpm deps:up` before the BDD flows");
  if (!submitterId || !otherUserId || !thirdUserId) {
    throw new Error("seeded users missing — run `pnpm db:seed`");
  }
};

async function givenASubmittedIdea(label: string) {
  const { ideaId } = await makeIdeaRepo(db).createWithFirstVersion({
    submitterId,
    departmentId: null,
    categoryId: null,
    submit: true,
    fields: {
      title: `F-10 ${label} ${createdIdeas.length}`,
      description: "A description long enough to be meaningful for the feedback tests.",
      problemStatement: "Receipts are retyped by hand.",
      expectedUsers: "Everyone who claims expenses.",
      expectedOutcome: "Claims take less time.",
    },
  });
  createdIdeas.push(ideaId);
  return ideaId;
}

async function signIn(app: ReturnType<typeof makeApp>, userId: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const response = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email: user.email, password: "innovation-2026" },
  });
  if (response.statusCode !== 200) {
    throw new Error(`could not sign in as ${user.email} — run \`pnpm db:seed\``);
  }
  return response.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

describe("F-10 · structured feedback beyond the thumb vote", () => {
  it("Given a reason with a note, When recorded, Then it appears with the submitter's name (FR-18)", async () => {
    guard();
    const app = makeApp();
    const cookie = await signIn(app, otherUserId);
    const ideaId = await givenASubmittedIdea("note");

    const set = await app.inject({
      method: "POST",
      url: `/ideas/${ideaId}/signals`,
      headers: { cookie },
      payload: { type: "HAVE_PROBLEM", active: true, comment: "My team hits this weekly." },
    });

    expect(set.statusCode, set.body).toBe(200);
    expect(set.json().mine).toEqual(["HAVE_PROBLEM"]);

    const listed = await app.inject({
      method: "GET",
      url: `/ideas/${ideaId}/signals`,
      headers: { cookie: await signIn(app, thirdUserId) },
    });
    const entries = listed.json().entries as { type: string; comment: string; submitter: { id: string } }[];
    expect(entries).toHaveLength(1);
    expect(entries[0]?.type).toBe("HAVE_PROBLEM");
    expect(entries[0]?.comment).toBe("My team hits this weekly.");
    expect(entries[0]?.submitter.id).toBe(otherUserId);

    await app.close();
  });

  it("Given the same person and the same reason twice, Then the second call updates the note in place, not a second row (P0 schema)", async () => {
    guard();
    const app = makeApp();
    const cookie = await signIn(app, otherUserId);
    const ideaId = await givenASubmittedIdea("update");

    await app.inject({
      method: "POST", url: `/ideas/${ideaId}/signals`, headers: { cookie },
      payload: { type: "SIMILAR_USE_CASE", active: true, comment: "First note." },
    });
    const second = await app.inject({
      method: "POST", url: `/ideas/${ideaId}/signals`, headers: { cookie },
      payload: { type: "SIMILAR_USE_CASE", active: true, comment: "Revised note." },
    });

    expect(second.statusCode, second.body).toBe(200);
    const rows = await db.feedback.findMany({ where: { ideaId, type: "SIMILAR_USE_CASE" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.comment).toBe("Revised note.");

    await app.close();
  });

  it("Given an active reason, When set to inactive, Then it is removed entirely, comment included", async () => {
    guard();
    const app = makeApp();
    const cookie = await signIn(app, otherUserId);
    const ideaId = await givenASubmittedIdea("remove");

    await app.inject({
      method: "POST", url: `/ideas/${ideaId}/signals`, headers: { cookie },
      payload: { type: "CAN_PROVIDE_DATA", active: true, comment: "Happy to share numbers." },
    });
    const cleared = await app.inject({
      method: "POST", url: `/ideas/${ideaId}/signals`, headers: { cookie },
      payload: { type: "CAN_PROVIDE_DATA", active: false },
    });

    expect(cleared.statusCode, cleared.body).toBe(200);
    expect(cleared.json().mine).toEqual([]);
    const rows = await db.feedback.findMany({ where: { ideaId, type: "CAN_PROVIDE_DATA" } });
    expect(rows).toHaveLength(0);

    await app.close();
  });

  it("Given two different people, Then each may hold the same reason at once, independently (a real signal, not a single flag)", async () => {
    guard();
    const app = makeApp();
    const ideaId = await givenASubmittedIdea("independent");

    const cookieA = await signIn(app, otherUserId);
    const cookieB = await signIn(app, thirdUserId);
    await app.inject({
      method: "POST", url: `/ideas/${ideaId}/signals`, headers: { cookie: cookieA },
      payload: { type: "HAVE_IMPROVEMENT", active: true },
    });
    await app.inject({
      method: "POST", url: `/ideas/${ideaId}/signals`, headers: { cookie: cookieB },
      payload: { type: "HAVE_IMPROVEMENT", active: true },
    });

    const rows = await db.feedback.findMany({ where: { ideaId, type: "HAVE_IMPROVEMENT" } });
    expect(rows.map((r) => r.userId).sort()).toEqual([otherUserId, thirdUserId].sort());

    await app.close();
  });

  it("Then nothing here ever reaches the ranking engine (P-1) — no score, weight or rank field anywhere in the response", async () => {
    guard();
    const app = makeApp();
    const cookie = await signIn(app, otherUserId);
    const ideaId = await givenASubmittedIdea("no-score");

    const set = await app.inject({
      method: "POST", url: `/ideas/${ideaId}/signals`, headers: { cookie },
      payload: { type: "CAN_HELP_IMPLEMENT", active: true, comment: "I know this codebase." },
    });

    const text = JSON.stringify(set.json()).toLowerCase();
    expect(text).not.toMatch(/score|weight|rank/);

    await app.close();
  });
});

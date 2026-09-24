import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@iep/db";
import type { ApiEnv } from "@iep/contracts/env";
import { buildServer } from "@iep/api/src/server.js";
import type { AppContext } from "@iep/api/src/context.js";
import { MemorySessionStore } from "@iep/api/src/auth/session.js";
import { makeIdeaRepo } from "@iep/api/src/modules/idea/repo.js";
import { LocalDiskBackend } from "@iep/api/src/modules/idea/attachments.js";

/**
 * F-11 — Personal activity summary + contribution timeline (SPEC §6.1 person page), as a
 * FLOW.
 *
 * The three items held back from the "comments/discussions vs. gamification" decision
 * that REQUIREMENTS §32 leaves room for: plain counts, a plain history — no points, no
 * levels, no badges, no streaks (see the "Gamification Preview" artifact for what was
 * deliberately left out). What genuinely needs proving is the permission scoping: two
 * different viewers of the SAME profile see two different counts, because one of them
 * cannot read the idea an activity is about (permission matrix, P-1) — a profile page is
 * not an audit export, and it must not leak "this person did something to idea X" to a
 * viewer who cannot otherwise see idea X.
 */

const DATABASE_URL = process.env["DATABASE_URL"] ?? "postgresql://iep:iep@localhost:5433/iep";
const db = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

let reachable = false;
let employeeId = "";
let reviewerId = "";
let adminId = "";
let managerId = "";
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
  const admin = await db.user.findUnique({ where: { email: "admin@example.invalid" } });
  const manager = await db.user.findUnique({ where: { email: "manager@example.invalid" } });
  employeeId = employee?.id ?? "";
  reviewerId = reviewer?.id ?? "";
  adminId = admin?.id ?? "";
  managerId = manager?.id ?? "";
});

afterAll(async () => {
  if (reachable && createdIdeas.length > 0) {
    // `Feedback` has no FK to `Idea` (P0-reserved, relation-less table), so it does not
    // cascade with the idea delete below and needs its own cleanup, same as f10.
    await db.feedback.deleteMany({ where: { ideaId: { in: createdIdeas } } });
    await db.idea.deleteMany({ where: { id: { in: createdIdeas } } });
  }
  await db.$disconnect();
});

const guard = () => {
  if (!reachable) throw new Error("database unreachable — run `pnpm deps:up` before the BDD flows");
  if (!employeeId || !reviewerId || !adminId || !managerId) {
    throw new Error("seeded users missing — run `pnpm db:seed`");
  }
};

async function givenASubmittedIdea(label: string) {
  const { ideaId } = await makeIdeaRepo(db).createWithFirstVersion({
    submitterId: employeeId,
    departmentId: null,
    categoryId: null,
    submit: true,
    fields: {
      title: `F-11 ${label} ${createdIdeas.length}`,
      description: "A description long enough to be meaningful for the activity tests.",
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

describe("F-11 · personal activity summary + contribution timeline", () => {
  it("Given an idea, feedback and a review, Then each profile's counts and timeline reflect only what that person did (FR-18, SPEC §6.1)", async () => {
    guard();
    const app = makeApp();

    // Baselines, not zero: the seeded demo data and other BDD specs' own leftover ideas
    // mean `employeeId` may already have submitted ideas before this test runs — the
    // real assertion is the DELTA this test's own actions cause, and that MANAGEMENT's
    // count does not move at all (below), not that either number starts at a fixed value.
    const activityCounts = async (profileId: string, viewerId: string) => {
      const res = await app.inject({
        method: "GET",
        url: `/people/${profileId}/activity`,
        headers: { cookie: await signIn(app, viewerId) },
      });
      return (
        res.json() as {
          counts: { ideasSubmitted: number; feedbackGiven: number; reviewsGiven: number };
        }
      ).counts;
    };
    const adminBaseline = (await activityCounts(employeeId, adminId)).ideasSubmitted;
    const managerBaseline = (await activityCounts(employeeId, managerId)).ideasSubmitted;
    const feedbackBaseline = (await activityCounts(adminId, employeeId)).feedbackGiven;
    const reviewsBaseline = (await activityCounts(reviewerId, employeeId)).reviewsGiven;

    // A merely-SUBMITTED idea, deliberately: it is what forces the permission-scoping
    // test below to be real rather than trivial (an EVALUATED+ idea is readable by
    // everyone anyway, per the permission matrix).
    const ideaId = await givenASubmittedIdea("scoped");

    // ADMIN can read any idea regardless of status, so this both records a real
    // FEEDBACK_GIVEN entry on admin's own profile AND is a legitimate action to take on
    // a not-yet-evaluated idea.
    const setSignal = await app.inject({
      method: "POST",
      url: `/ideas/${ideaId}/signals`,
      headers: { cookie: await signIn(app, adminId) },
      payload: { type: "HAVE_PROBLEM", active: true },
    });
    expect(setSignal.statusCode, setSignal.body).toBe(200);

    // A review, written straight to the database (same as f08) — `CreateReviewRequest`
    // gates on idea status via the route, and this test is about the activity summary
    // reading it back, not re-proving the review-creation flow.
    await db.review.create({
      data: { ideaId, reviewerId, decision: "NEEDS_CLARIFICATION", comment: null },
    });

    // The submitter's own profile: ADMIN can read anything, so sees the real count.
    const asAdmin = await app.inject({
      method: "GET",
      url: `/people/${employeeId}/activity`,
      headers: { cookie: await signIn(app, adminId) },
    });
    expect(asAdmin.statusCode, asAdmin.body).toBe(200);
    const adminView = asAdmin.json();
    expect(adminView.counts.ideasSubmitted).toBe(adminBaseline + 1);
    expect(adminView.entries.some((e: { type: string; idea: { id: string } }) =>
      e.type === "IDEA_SUBMITTED" && e.idea.id === ideaId)).toBe(true);

    // The same profile, viewed by MANAGEMENT: the permission matrix requires "evaluated+"
    // for MANAGEMENT to read someone else's idea, and this one is only SUBMITTED — so
    // the count and the timeline entry must both disappear for this viewer.
    const asManager = await app.inject({
      method: "GET",
      url: `/people/${employeeId}/activity`,
      headers: { cookie: await signIn(app, managerId) },
    });
    expect(asManager.statusCode, asManager.body).toBe(200);
    const managerView = asManager.json();
    expect(managerView.counts.ideasSubmitted).toBe(managerBaseline);
    expect(managerView.entries.some((e: { idea: { id: string } }) => e.idea.id === ideaId)).toBe(false);

    // Admin's own profile: the feedback they just gave shows up as their own activity.
    const adminActivity = await app.inject({
      method: "GET",
      url: `/people/${adminId}/activity`,
      headers: { cookie: await signIn(app, employeeId) },
    });
    expect(adminActivity.statusCode, adminActivity.body).toBe(200);
    const adminActivityView = adminActivity.json();
    // The employee viewer can see this because THEY are the idea's submitter (always
    // readable to its own owner, regardless of status) — a different reason than
    // admin's own "reads anything", proving the scoping check runs per viewer, not
    // just per role.
    expect(adminActivityView.counts.feedbackGiven).toBe(feedbackBaseline + 1);
    expect(adminActivityView.entries[0]).toMatchObject({ type: "FEEDBACK_GIVEN", detail: "HAVE_PROBLEM" });

    // Reviewer's own profile: the review they just wrote shows up the same way.
    const reviewerActivity = await app.inject({
      method: "GET",
      url: `/people/${reviewerId}/activity`,
      headers: { cookie: await signIn(app, employeeId) },
    });
    expect(reviewerActivity.statusCode, reviewerActivity.body).toBe(200);
    const reviewerActivityView = reviewerActivity.json();
    expect(reviewerActivityView.counts.reviewsGiven).toBe(reviewsBaseline + 1);
    expect(reviewerActivityView.entries[0]).toMatchObject({ type: "REVIEW_GIVEN", detail: "NEEDS_CLARIFICATION" });
  });

  it("Then nothing here ever reaches the ranking engine (P-1) — no score, weight or rank field anywhere in the response", async () => {
    guard();
    const app = makeApp();
    const response = await app.inject({
      method: "GET",
      url: `/people/${employeeId}/activity`,
      headers: { cookie: await signIn(app, adminId) },
    });

    const text = JSON.stringify(response.json()).toLowerCase();
    expect(text).not.toMatch(/score|weight|rank/);
  });

  it("Given an unknown user id, Then the endpoint answers NOT_FOUND rather than an empty summary", async () => {
    guard();
    const app = makeApp();
    const response = await app.inject({
      method: "GET",
      url: "/people/00000000-0000-0000-0000-000000000000/activity",
      headers: { cookie: await signIn(app, adminId) },
    });
    expect(response.statusCode).toBe(404);
  });
});

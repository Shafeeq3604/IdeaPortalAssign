import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@iep/db";
import type { ApiEnv } from "@iep/contracts/env";
import type { AnalyticsResponse, DashboardResponse, ListIdeasResponse } from "@iep/contracts";
import { buildServer } from "@iep/api/src/server.js";
import type { AppContext } from "@iep/api/src/context.js";
import { MemorySessionStore } from "@iep/api/src/auth/session.js";
import { makeIdeaRepo } from "@iep/api/src/modules/idea/repo.js";
import { LocalDiskBackend } from "@iep/api/src/modules/idea/attachments.js";

/**
 * F-12 — Organisational analytics (P14, FR-27), as a FLOW.
 *
 * What genuinely needs proving is not the arithmetic (aggregate.test.ts covers that) but
 * the three promises the page makes:
 *   1. a department filter narrows EVERY section, not just some of them;
 *   2. every idea count's href opens a list that returns the same number (§6.2 row 40);
 *   3. "no data" is reported as null with a sample size of 0, never as a 0-day median.
 *
 * Isolated by a department created for this run, so seeded demo ideas and other specs'
 * leftovers cannot move any number asserted here.
 */

const DATABASE_URL = process.env["DATABASE_URL"] ?? "postgresql://iep:iep@localhost:5433/iep";
const db = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

let reachable = false;
let employeeId = "";
let reviewerId = "";
let managerId = "";
let departmentId = "";
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
  const manager = await db.user.findUnique({ where: { email: "manager@example.invalid" } });
  employeeId = employee?.id ?? "";
  reviewerId = reviewer?.id ?? "";
  managerId = manager?.id ?? "";
  const dept = await db.department.create({ data: { name: `F-12 analytics ${Date.now()}` } });
  departmentId = dept.id;
});

afterAll(async () => {
  if (reachable) {
    if (createdIdeas.length > 0) await db.idea.deleteMany({ where: { id: { in: createdIdeas } } });
    if (departmentId) await db.department.delete({ where: { id: departmentId } });
  }
  await db.$disconnect();
});

const guard = () => {
  if (!reachable) throw new Error("database unreachable — run `pnpm deps:up` before the BDD flows");
  if (!employeeId || !reviewerId || !managerId) throw new Error("seeded users missing — run `pnpm db:seed`");
};

async function signIn(app: ReturnType<typeof makeApp>, email: string) {
  const response = await app.inject({
    method: "POST", url: "/auth/login", payload: { email, password: "innovation-2026" },
  });
  if (response.statusCode !== 200) throw new Error(`could not sign in as ${email} — run \`pnpm db:seed\``);
  return response.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

async function givenASubmittedIdeaInTheDepartment(label: string) {
  const { ideaId } = await makeIdeaRepo(db).createWithFirstVersion({
    submitterId: employeeId,
    departmentId,
    categoryId: null,
    submit: true,
    fields: {
      title: `F-12 ${label}`,
      description: "A description long enough to be meaningful for the analytics flow.",
      problemStatement: "Meeting rooms sit booked and empty.",
      expectedUsers: "Everyone who books a room.",
      expectedOutcome: "Rooms free up when nobody turns up.",
    },
  });
  createdIdeas.push(ideaId);
  return ideaId;
}

describe("F-12 · organisational analytics", () => {
  it("Given a department's ideas and a review, Then every section is scoped to it, and every count's link agrees with it", async () => {
    guard();
    const app = makeApp();
    const manager = await signIn(app, "manager@example.invalid");

    const ideaA = await givenASubmittedIdeaInTheDepartment("A");
    await givenASubmittedIdeaInTheDepartment("B");
    const analytics = async () => {
      const res = await app.inject({
        method: "GET", url: `/analytics?departmentId=${departmentId}`, headers: { cookie: manager },
      });
      expect(res.statusCode).toBe(200);
      return res.json() as AnalyticsResponse;
    };

    // 0. Visibility first: MANAGEMENT reads ideas only from EVALUATED onward (SPEC §4.2),
    //    so merely-SUBMITTED ideas are not counted for them — an aggregate must not
    //    disclose what the list it links to would refuse to show.
    expect((await analytics()).totalIdeas).toBe(0);

    // The dashboard's tiles keep the same rule (they used to count every idea in the
    // table, so a Manager's "New ideas: 2" opened a list of 0).
    const dashboard = async () => {
      const res = await app.inject({
        method: "GET", url: `/dashboard?departmentId=${departmentId}`, headers: { cookie: manager },
      });
      expect(res.statusCode).toBe(200);
      return new Map((res.json() as DashboardResponse).tiles.map((t) => [t.key, t]));
    };
    expect((await dashboard()).get("new")?.count).toBe(0);
    expect((await dashboard()).get("total")?.count).toBe(0);

    // The worker's own move (SUBMITTED → EVALUATED once scored), done directly here: this
    // flow is about analytics, not the pipeline (f03 covers that).
    await db.idea.updateMany({ where: { id: { in: createdIdeas } }, data: { status: "EVALUATED" } });
    await db.review.create({ data: { ideaId: ideaA, reviewerId, decision: "VALIDATED", comment: "F-12" } });

    const data = await analytics();

    // Dashboard, once visible: the count and the list it opens agree for this Manager.
    const evaluating = (await dashboard()).get("under_evaluation");
    expect(evaluating?.count).toBe(2);
    const evalHref = new URL(evaluating?.href ?? "/", "http://x.invalid");
    const evalList = await app.inject({
      method: "GET",
      url: `/ideas?${evalHref.searchParams.getAll("status").map((s) => `status=${s}`).join("&")}&departmentId=${departmentId}`,
      headers: { cookie: manager },
    });
    expect((evalList.json() as ListIdeasResponse).meta.total).toBe(evaluating?.count);

    // 1. Scoped everywhere.
    expect(data.totalIdeas).toBe(2);
    expect(data.byDepartment).toHaveLength(1);
    expect(data.byDepartment[0]).toMatchObject({ departmentId, ideas: 2, contributors: 1, reviewed: 1, advanced: 0 });
    expect(data.reviewActivity.reviews).toBe(1);
    expect(data.reviewActivity.byDecision).toEqual([{ decision: "VALIDATED", count: 1 }]);
    expect(data.submissionsByMonth.at(-1)?.count).toBe(2);
    const statusTotal = data.statusBreakdown.reduce((s, r) => s + r.count, 0);
    expect(statusTotal).toBe(2);

    // 2. Every status count opens a list of the same size. The page's hrefs use the nav
    //    map's `department`; the list endpoint's own query name is `departmentId` — the
    //    web list page does that translation, so the flow does it here too.
    for (const row of data.statusBreakdown) {
      const href = new URL(row.href, "http://x.invalid");
      expect(href.pathname).toBe("/ideas");
      expect(href.searchParams.get("department")).toBe(departmentId);
      const list = await app.inject({
        method: "GET",
        url: `/ideas?status=${href.searchParams.get("status")}&departmentId=${departmentId}`,
        headers: { cookie: manager },
      });
      expect((list.json() as ListIdeasResponse).meta.total).toBe(row.count);
    }

    // 3. No evaluation exists for these ideas, so the scored-based cycle times have no
    //    sample — said as null/0, never as a 0-day median.
    const firstScoreToReview = data.cycleTimes.find((c) => c.key === "FIRST_SCORE_TO_FIRST_REVIEW");
    expect(firstScoreToReview).toEqual(expect.objectContaining({ medianDays: null, sampleSize: 0 }));
    expect(data.revisions.revisedIdeas).toBe(0);
    expect(data.revisions.medianCompositeDelta).toBeNull();
    expect(data.impactVsEffort.points).toEqual([]);
  });

  it("Given an EMPLOYEE, When they request analytics, Then it is refused (dashboard:read)", async () => {
    guard();
    const app = makeApp();
    const res = await app.inject({
      method: "GET", url: "/analytics", headers: { cookie: await signIn(app, "employee@example.invalid") },
    });
    expect(res.statusCode).toBe(403);
  });
});

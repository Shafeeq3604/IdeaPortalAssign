import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@iep/db";
import type { ApiEnv } from "@iep/contracts/env";
import type { IdeaDeliveryResponse } from "@iep/contracts";
import { buildServer } from "@iep/api/src/server.js";
import type { AppContext } from "@iep/api/src/context.js";
import { MemorySessionStore } from "@iep/api/src/auth/session.js";
import { makeIdeaRepo } from "@iep/api/src/modules/idea/repo.js";
import { LocalDiskBackend } from "@iep/api/src/modules/idea/attachments.js";

/**
 * F-14 — Delivery tracking (P15 prototype & pilot, P16 KPIs / actual-vs-predicted / ROI),
 * as a FLOW.
 *
 * What needs a real database and real routes to prove:
 *   1. the M3 lifecycle is reachable, and the lifecycle itself stamps the pilot's dates
 *      (enter PILOT → started; park it → ended; resume → reopened, original start kept);
 *   2. only a reviewer/admin who did not submit the idea may record delivery results, and
 *      only while the idea is in a delivery stage;
 *   3. actual-vs-predicted and ROI are arithmetic on entered figures, nothing more;
 *   4. every delivery write lands in the audit trail.
 */

const DATABASE_URL = process.env["DATABASE_URL"] ?? "postgresql://iep:iep@localhost:5433/iep";
const db = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

let reachable = false;
let employeeId = "";
let reviewerId = "";
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
  employeeId = (await db.user.findUnique({ where: { email: "employee@example.invalid" } }))?.id ?? "";
  reviewerId = (await db.user.findUnique({ where: { email: "reviewer@example.invalid" } }))?.id ?? "";
});

afterAll(async () => {
  // Every P15/P16 table cascades from `ideas` (FKs added at P15), so this is the cleanup.
  if (reachable && createdIdeas.length > 0) await db.idea.deleteMany({ where: { id: { in: createdIdeas } } });
  await db.$disconnect();
});

const guard = () => {
  if (!reachable) throw new Error("database unreachable — run `pnpm deps:up` before the BDD flows");
  if (!employeeId || !reviewerId) throw new Error("seeded users missing — run `pnpm db:seed`");
};

async function signIn(app: ReturnType<typeof makeApp>, email: string) {
  const res = await app.inject({ method: "POST", url: "/auth/login", payload: { email, password: "innovation-2026" } });
  if (res.statusCode !== 200) throw new Error(`could not sign in as ${email} — run \`pnpm db:seed\``);
  return res.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

async function givenAnIdeaUnderReview(label: string, submitterId = employeeId) {
  const { ideaId } = await makeIdeaRepo(db).createWithFirstVersion({
    submitterId, departmentId: null, categoryId: null, submit: true,
    fields: {
      title: `F-14 ${label}`,
      description: "A description long enough to be meaningful for the delivery flow.",
      problemStatement: "Expense claims are retyped by hand.",
      expectedUsers: "Everyone who claims expenses.",
      expectedOutcome: "Claims take minutes, not days.",
    },
  });
  createdIdeas.push(ideaId);
  await db.idea.update({ where: { id: ideaId }, data: { status: "UNDER_REVIEW" } });
  return ideaId;
}

describe("F-14 · delivery tracking", () => {
  it("Given a reviewer moves an idea through prototype and pilot, Then the lifecycle keeps the pilot's dates", async () => {
    guard();
    const app = makeApp();
    const reviewer = await signIn(app, "reviewer@example.invalid");
    const ideaId = await givenAnIdeaUnderReview("lifecycle");
    const move = (to: string, reason?: string) =>
      app.inject({ method: "POST", url: `/ideas/${ideaId}/status`, headers: { cookie: reviewer }, payload: { to, ...(reason ? { reason } : {}) } });

    expect((await move("PROTOTYPE_CANDIDATE")).statusCode).toBe(200);
    expect((await move("PILOT")).statusCode).toBe(200);
    const started = await db.pilotRecord.findUniqueOrThrow({ where: { ideaId } });
    expect(started.startedAt).not.toBeNull();
    expect(started.endedAt).toBeNull();

    // SPEC §5.4 "any non-terminal → PARKED": a pilot can be paused, and resumed.
    expect((await move("PARKED", "Waiting on the finance system upgrade")).statusCode).toBe(200);
    expect((await db.pilotRecord.findUniqueOrThrow({ where: { ideaId } })).endedAt).not.toBeNull();
    expect((await move("PILOT", "Upgrade is done")).statusCode).toBe(200);
    const resumed = await db.pilotRecord.findUniqueOrThrow({ where: { ideaId } });
    expect(resumed.endedAt).toBeNull();
    expect(resumed.startedAt?.getTime()).toBe(started.startedAt?.getTime());

    expect((await move("PRODUCTION_CANDIDATE")).statusCode).toBe(200);
    expect((await db.pilotRecord.findUniqueOrThrow({ where: { ideaId } })).endedAt).not.toBeNull();
    // IMPLEMENTED stays ADMIN-only, as the P0 table always said.
    expect((await move("IMPLEMENTED")).statusCode).toBe(403);
  });

  it("Given who may write, Then only a reviewer who did not submit it, while in a delivery stage", async () => {
    guard();
    const app = makeApp();
    const reviewer = await signIn(app, "reviewer@example.invalid");
    const owner = await signIn(app, "employee@example.invalid");

    const notYet = await givenAnIdeaUnderReview("not-yet");
    const early = await app.inject({
      method: "POST", url: `/ideas/${notYet}/delivery/updates`, headers: { cookie: reviewer }, payload: { note: "Too early" },
    });
    expect(early.statusCode).toBe(403);
    const view = (await app.inject({ method: "GET", url: `/ideas/${notYet}/delivery`, headers: { cookie: reviewer } })).json() as IdeaDeliveryResponse;
    expect(view).toMatchObject({ canWrite: false, inDeliveryStage: false });

    const ideaId = await givenAnIdeaUnderReview("writers");
    await db.idea.update({ where: { id: ideaId }, data: { status: "PROTOTYPE_CANDIDATE" } });
    // The owner has no transition permission at all.
    const byOwner = await app.inject({
      method: "POST", url: `/ideas/${ideaId}/delivery/updates`, headers: { cookie: owner }, payload: { note: "Mine" },
    });
    expect(byOwner.statusCode).toBe(403);
    // A reviewer on an idea they submitted themselves is refused too.
    const ownByReviewer = await givenAnIdeaUnderReview("reviewer-own", reviewerId);
    await db.idea.update({ where: { id: ownByReviewer }, data: { status: "PROTOTYPE_CANDIDATE" } });
    const selfJudged = await app.inject({
      method: "POST", url: `/ideas/${ownByReviewer}/delivery/updates`, headers: { cookie: reviewer }, payload: { note: "Mine" },
    });
    expect(selfJudged.statusCode).toBe(403);

    const ok = await app.inject({
      method: "POST", url: `/ideas/${ideaId}/delivery/updates`, headers: { cookie: reviewer }, payload: { note: "Prototype built in two weeks" },
    });
    expect(ok.statusCode).toBe(201);
    const body = ok.json() as IdeaDeliveryResponse;
    expect(body.canWrite).toBe(true);
    expect(body.updates[0]).toMatchObject({ stage: "PROTOTYPE_CANDIDATE", note: "Prototype built in two weeks" });

    // The owner can READ it.
    const ownerView = await app.inject({ method: "GET", url: `/ideas/${ideaId}/delivery`, headers: { cookie: owner } });
    expect(ownerView.statusCode).toBe(200);
    expect((ownerView.json() as IdeaDeliveryResponse).canWrite).toBe(false);
  });

  it("Given a KPI, a measurement and ROI figures, Then the tab shows plain arithmetic on them, and every write is audited", async () => {
    guard();
    const app = makeApp();
    const reviewer = await signIn(app, "reviewer@example.invalid");
    const ideaId = await givenAnIdeaUnderReview("kpis");
    await db.idea.update({ where: { id: ideaId }, data: { status: "PILOT" } });

    const created = (await app.inject({
      method: "POST", url: `/ideas/${ideaId}/kpis`, headers: { cookie: reviewer },
      payload: { name: "Minutes per claim", unit: "minutes", direction: "LOWER_IS_BETTER", predictedValue: 40, targetValue: 30 },
    })).json() as IdeaDeliveryResponse;
    const kpiId = created.kpis[0]?.id ?? "";

    const future = await app.inject({
      method: "POST", url: `/ideas/${ideaId}/kpis/${kpiId}/measurements`, headers: { cookie: reviewer },
      payload: { actualValue: 10, measuredAt: new Date(Date.now() + 7 * 86_400_000).toISOString() },
    });
    expect(future.statusCode).toBe(400);

    const measured = (await app.inject({
      method: "POST", url: `/ideas/${ideaId}/kpis/${kpiId}/measurements`, headers: { cookie: reviewer },
      payload: { actualValue: 30, measuredAt: new Date().toISOString() },
    })).json() as IdeaDeliveryResponse;
    // Lower is better and 30 < 40 predicted → ahead, by 10 minutes (25%).
    expect(measured.kpis[0]?.versusPredicted).toEqual({ difference: -10, percent: -25, standing: "AHEAD" });

    const badCurrency = await app.inject({
      method: "PATCH", url: `/ideas/${ideaId}/financials`, headers: { cookie: reviewer },
      payload: { currency: "DOLLARS", investmentToDate: 1000 },
    });
    expect(badCurrency.statusCode).toBe(400);

    const partial = (await app.inject({
      method: "PATCH", url: `/ideas/${ideaId}/financials`, headers: { cookie: reviewer },
      payload: { currency: "usd", investmentToDate: 1000 },
    })).json() as IdeaDeliveryResponse;
    expect(partial.financials).toMatchObject({ currency: "USD", roi: null });

    const full = (await app.inject({
      method: "PATCH", url: `/ideas/${ideaId}/financials`, headers: { cookie: reviewer },
      payload: { currency: "USD", realizedBenefit: 1250, basisNote: "First six months" },
    })).json() as IdeaDeliveryResponse;
    expect(full.financials).toMatchObject({ investmentToDate: 1000, realizedBenefit: 1250, roi: 0.25 });

    const pilot = (await app.inject({
      method: "PATCH", url: `/ideas/${ideaId}/delivery/pilot`, headers: { cookie: reviewer },
      payload: { scope: "Finance, London office", outcome: "SUCCEEDED" },
    })).json() as IdeaDeliveryResponse;
    expect(pilot.pilot).toMatchObject({ scope: "Finance, London office", outcome: "SUCCEEDED" });

    const actions = (await db.auditLog.findMany({ where: { entityId: ideaId }, select: { action: true } })).map((a) => a.action);
    for (const action of ["delivery.kpi", "delivery.kpiMeasurement", "delivery.financials", "delivery.pilot"]) {
      expect(actions, action).toContain(action);
    }
  });

  it("Given a result is recorded, Then the submitter and the idea's team hear about it — not the recorder, not anyone else", async () => {
    guard();
    const app = makeApp();
    const reviewer = await signIn(app, "reviewer@example.invalid");
    const managerId = (await db.user.findUniqueOrThrow({ where: { email: "manager@example.invalid" } })).id;
    const adminId = (await db.user.findUniqueOrThrow({ where: { email: "admin@example.invalid" } })).id;
    const ideaId = await givenAnIdeaUnderReview("results");
    await db.idea.update({ where: { id: ideaId }, data: { status: "PILOT" } });
    // Mo said "I could help build this" — that is what puts someone on the team.
    await db.feedback.create({ data: { ideaId, userId: managerId, type: "CAN_HELP_IMPLEMENT" } });

    const kpiId = ((await app.inject({
      method: "POST", url: `/ideas/${ideaId}/kpis`, headers: { cookie: reviewer },
      payload: { name: "Hours saved", unit: "hours", direction: "HIGHER_IS_BETTER", predictedValue: 100 },
    })).json() as IdeaDeliveryResponse).kpis[0]?.id ?? "";
    // Defining a KPI is not a result; nobody is told yet.
    expect(await db.notification.count({ where: { entityId: ideaId, event: "RESULTS_RECORDED" } })).toBe(0);

    await app.inject({
      method: "POST", url: `/ideas/${ideaId}/kpis/${kpiId}/measurements`, headers: { cookie: reviewer },
      payload: { actualValue: 120, measuredAt: new Date().toISOString() },
    });
    await app.inject({
      method: "PATCH", url: `/ideas/${ideaId}/financials`, headers: { cookie: reviewer },
      payload: { currency: "USD", investmentToDate: 1000, realizedBenefit: 1800 },
    });

    const rows = await db.notification.findMany({ where: { entityId: ideaId, event: "RESULTS_RECORDED" } });
    const to = (userId: string) => rows.filter((r) => r.userId === userId);
    expect(to(employeeId)).toHaveLength(2);
    expect(to(managerId)).toHaveLength(2);
    expect(to(reviewerId)).toHaveLength(0);
    expect(to(adminId)).toHaveLength(0);

    const ownerMeasurement = to(employeeId)
      .map((r) => r.payload as Record<string, unknown>)
      .find((p) => p["kind"] === "MEASUREMENT");
    expect(ownerMeasurement).toMatchObject({
      audience: "OWNER", kpiName: "Hours saved", unit: "hours", actualValue: 120, predictedValue: 100,
    });
    expect(to(managerId).map((r) => (r.payload as Record<string, unknown>)["audience"])).toEqual(["TEAM", "TEAM"]);
    // Money is never quoted in a notification — it is on the idea for whoever may open it.
    for (const r of rows) expect(JSON.stringify(r.payload)).not.toContain("1800");

    // The owner's centre renders it, and it links to the impact card.
    const owner = await signIn(app, "employee@example.invalid");
    const centre = (await app.inject({ method: "GET", url: "/notifications?perPage=50", headers: { cookie: owner } })).json() as {
      items: { title: string; body: string; href: string; event: string }[];
    };
    const line = centre.items.find((n) => n.event === "RESULTS_RECORDED" && n.body.includes("Hours saved"));
    expect(line).toMatchObject({ title: "Your idea’s results are in", href: `/ideas/${ideaId}/overview#impact` });
    expect(line?.body).toContain("120 hours (predicted 100 hours)");
  });
});

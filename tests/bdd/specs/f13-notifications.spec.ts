import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@iep/db";
import type { ApiEnv } from "@iep/contracts/env";
import type {
  ListNotificationsResponse, MarkNotificationsReadResponse, NotificationPreferencesResponse,
} from "@iep/contracts";
import { drainEmailOutbox, type EmailMessage, type EmailTransport } from "@iep/evaluation";
import { buildServer } from "@iep/api/src/server.js";
import type { AppContext } from "@iep/api/src/context.js";
import { MemorySessionStore } from "@iep/api/src/auth/session.js";
import { makeIdeaRepo } from "@iep/api/src/modules/idea/repo.js";
import { LocalDiskBackend } from "@iep/api/src/modules/idea/attachments.js";

/**
 * F-13 — Notifications (P13, FR-28), as a FLOW.
 *
 * The promises that need a real database to prove:
 *   1. a P6 event (a review) notifies the idea's OWNER, in-app, with a link to the idea;
 *   2. nobody is notified about their own action (an owner submitting their own draft);
 *   3. the centre is strictly per-person — another user can neither see nor mark it;
 *   4. an email opt-out is honoured at write time (the row is not queued for email);
 *   5. the outbox sends each queued email exactly once, even if drained twice.
 */

const DATABASE_URL = process.env["DATABASE_URL"] ?? "postgresql://iep:iep@localhost:5433/iep";
const db = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

let reachable = false;
let employeeId = "";
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
  employeeId = employee?.id ?? "";
});

afterAll(async () => {
  if (reachable && createdIdeas.length > 0) {
    // `notifications` has no FK to ideas (a P0-reserved, relation-less table), so it does
    // not cascade with the idea delete and is cleaned up by entity id here.
    await db.notification.deleteMany({ where: { entityId: { in: createdIdeas } } });
    await db.idea.deleteMany({ where: { id: { in: createdIdeas } } });
  }
  if (reachable && employeeId) await db.notificationPreference.deleteMany({ where: { userId: employeeId } });
  await db.$disconnect();
});

const guard = () => {
  if (!reachable) throw new Error("database unreachable — run `pnpm deps:up` before the BDD flows");
  if (!employeeId) throw new Error("seeded users missing — run `pnpm db:seed`");
};

async function signIn(app: ReturnType<typeof makeApp>, email: string) {
  const res = await app.inject({ method: "POST", url: "/auth/login", payload: { email, password: "innovation-2026" } });
  if (res.statusCode !== 200) throw new Error(`could not sign in as ${email} — run \`pnpm db:seed\``);
  return res.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

async function givenAnEvaluatedIdea(label: string) {
  const { ideaId } = await makeIdeaRepo(db).createWithFirstVersion({
    submitterId: employeeId, departmentId: null, categoryId: null, submit: true,
    fields: {
      title: `F-13 ${label}`,
      description: "A description long enough to be meaningful for the notification flow.",
      problemStatement: "Meeting rooms sit booked and empty.",
      expectedUsers: "Everyone who books a room.",
      expectedOutcome: "Rooms free up when nobody turns up.",
    },
  });
  createdIdeas.push(ideaId);
  await db.idea.update({ where: { id: ideaId }, data: { status: "EVALUATED" } });
  return ideaId;
}

const forIdea = (list: ListNotificationsResponse, ideaId: string) =>
  list.items.filter((n) => n.href.includes(ideaId));

describe("F-13 · notifications", () => {
  it("Given a reviewer reviews an employee's idea, Then only the owner is notified, and only the owner can mark it", async () => {
    guard();
    const app = makeApp();
    const owner = await signIn(app, "employee@example.invalid");
    const reviewer = await signIn(app, "reviewer@example.invalid");
    const ideaId = await givenAnEvaluatedIdea("review");

    const review = await app.inject({
      method: "POST", url: `/ideas/${ideaId}/reviews`, headers: { cookie: reviewer },
      payload: { decision: "VALIDATED", comment: "Clear and well scoped." },
    });
    expect(review.statusCode).toBe(201);

    // 1. The owner has it, unread, linking to the idea.
    const ownerList = (await app.inject({ method: "GET", url: "/notifications", headers: { cookie: owner } }))
      .json() as ListNotificationsResponse;
    const mine = forIdea(ownerList, ideaId);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ event: "REVIEW_RECORDED", readAt: null, href: `/ideas/${ideaId}/overview` });
    expect(mine[0]?.body).toContain("F-13 review");
    expect(mine[0]?.body).toContain("Validated");

    // 3. The reviewer (the actor) was not notified, and cannot mark the owner's row.
    const reviewerList = (await app.inject({ method: "GET", url: "/notifications", headers: { cookie: reviewer } }))
      .json() as ListNotificationsResponse;
    expect(forIdea(reviewerList, ideaId)).toHaveLength(0);
    const notificationId = mine[0]?.id ?? "";
    const foreignMark = (await app.inject({
      method: "POST", url: "/notifications/read", headers: { cookie: reviewer }, payload: { ids: [notificationId] },
    })).json() as MarkNotificationsReadResponse;
    expect(foreignMark.updated).toBe(0);

    // The owner can.
    const ownMark = (await app.inject({
      method: "POST", url: "/notifications/read", headers: { cookie: owner }, payload: { ids: [notificationId] },
    })).json() as MarkNotificationsReadResponse;
    expect(ownMark.updated).toBe(1);
    expect(ownMark.unreadCount).toBe(ownerList.unreadCount - 1);

    // Email was queued (default preference is ON).
    const row = await db.notification.findUniqueOrThrow({ where: { id: notificationId } });
    expect(row.emailStatus).toBe("PENDING");
  });

  it("Given the owner acts on their own idea, Then they are not notified about it", async () => {
    guard();
    const { ideaId } = await makeIdeaRepo(db).createWithFirstVersion({
      submitterId: employeeId, departmentId: null, categoryId: null, submit: false,
      fields: {
        title: "F-13 self", description: "A description long enough to be meaningful for the flow.",
        problemStatement: "p", expectedUsers: "u", expectedOutcome: "o",
      },
    });
    createdIdeas.push(ideaId);
    await makeIdeaRepo(db).transition({ ideaId, from: "DRAFT", to: "SUBMITTED", actorId: employeeId, reason: null });
    expect(await db.notification.count({ where: { entityId: ideaId } })).toBe(0);
  });

  it("Given the owner turns review emails off, Then the next review is notified in-app but not queued for email", async () => {
    guard();
    const app = makeApp();
    const owner = await signIn(app, "employee@example.invalid");
    const reviewer = await signIn(app, "reviewer@example.invalid");

    const prefs = (await app.inject({
      method: "PATCH", url: "/notifications/preferences", headers: { cookie: owner },
      payload: { items: [{ event: "REVIEW_RECORDED", emailEnabled: false }] },
    })).json() as NotificationPreferencesResponse;
    expect(prefs.items.find((p) => p.event === "REVIEW_RECORDED")?.emailEnabled).toBe(false);
    // Untouched events keep the default.
    expect(prefs.items.find((p) => p.event === "STATUS_CHANGED")?.emailEnabled).toBe(true);

    const ideaId = await givenAnEvaluatedIdea("opt-out");
    await app.inject({
      method: "POST", url: `/ideas/${ideaId}/reviews`, headers: { cookie: reviewer },
      payload: { decision: "VALIDATED" },
    });
    const row = await db.notification.findFirstOrThrow({ where: { entityId: ideaId } });
    expect(row.emailStatus).toBe("NOT_REQUESTED");
  });

  it("Given queued emails, When the outbox is drained twice, Then each is sent exactly once", async () => {
    guard();
    const sent: EmailMessage[] = [];
    const transport: EmailTransport = { name: "log", send: (m) => { sent.push(m); return Promise.resolve(); } };

    const queued = await db.notification.findMany({
      where: { entityId: { in: createdIdeas }, emailStatus: "PENDING" }, select: { id: true },
    });
    expect(queued.length).toBeGreaterThanOrEqual(1);

    // Two drains racing — the conditional PENDING → SENDING claim is the referee.
    await Promise.all([
      drainEmailOutbox(db, transport, { webOrigin: "http://localhost:5173", batch: 200 }),
      drainEmailOutbox(db, transport, { webOrigin: "http://localhost:5173", batch: 200 }),
    ]);
    const ours = sent.filter((m) => createdIdeas.some((id) => m.text.includes(id)));
    expect(ours).toHaveLength(queued.length);
    expect(ours[0]?.to).toBe("employee@example.invalid");
    expect(ours[0]?.text).toContain("http://localhost:5173/ideas/");

    const after = await db.notification.findMany({ where: { id: { in: queued.map((q) => q.id) } } });
    expect(after.every((r) => r.emailStatus === "SENT")).toBe(true);
  });
});

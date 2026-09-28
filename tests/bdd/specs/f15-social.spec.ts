import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@iep/db";
import type { ApiEnv } from "@iep/contracts/env";
import type {
  IdeaComment, IdeaDetail, IdeaFollowState, ListIdeaCommentsResponse, SearchPeopleResponse,
} from "@iep/contracts";
import { buildServer } from "@iep/api/src/server.js";
import type { AppContext } from "@iep/api/src/context.js";
import { MemorySessionStore } from "@iep/api/src/auth/session.js";
import { makeIdeaRepo } from "@iep/api/src/modules/idea/repo.js";
import { LocalDiskBackend } from "@iep/api/src/modules/idea/attachments.js";

/**
 * F-15 — the social layer (P18, D-24), as a FLOW. What needs a real database to prove:
 *   1. a comment reaches the owner, followers and the people it names — once each, never
 *      its author — and commenting makes you a follower;
 *   2. nobody hears about, or can read, a thread on an idea they cannot open: a mention
 *      of someone who cannot see the idea is dropped, and the @ picker never offers them;
 *   3. followers hear about stage changes;
 *   4. you edit and delete only your own words; a deleted comment leaves a marker, no text;
 *   5. hiding is an administrator's, needs a reason, is audited with the withheld text,
 *      and the database itself refuses a hide without one;
 *   6. drafts take no comments; nothing here moves a score.
 */

const DATABASE_URL = process.env["DATABASE_URL"] ?? "postgresql://iep:iep@localhost:5433/iep";
const db = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

let reachable = false;
const ids = { employee: "", reviewer: "", manager: "", admin: "" };
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
  for (const [key, email] of [
    ["employee", "employee@example.invalid"], ["reviewer", "reviewer@example.invalid"],
    ["manager", "manager@example.invalid"], ["admin", "admin@example.invalid"],
  ] as const) {
    ids[key] = (await db.user.findUnique({ where: { email } }))?.id ?? "";
  }
});

afterAll(async () => {
  if (reachable && createdIdeas.length > 0) {
    await db.notification.deleteMany({ where: { entityId: { in: createdIdeas } } });
    await db.idea.deleteMany({ where: { id: { in: createdIdeas } } }); // comments + follows cascade
  }
  await db.$disconnect();
});

const guard = () => {
  if (!reachable) throw new Error("database unreachable — run `pnpm deps:up` before the BDD flows");
  if (Object.values(ids).some((v) => !v)) throw new Error("seeded users missing — run `pnpm db:seed`");
};

async function signIn(app: ReturnType<typeof makeApp>, email: string) {
  const res = await app.inject({ method: "POST", url: "/auth/login", payload: { email, password: "innovation-2026" } });
  if (res.statusCode !== 200) throw new Error(`could not sign in as ${email} — run \`pnpm db:seed\``);
  return res.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

/** An employee's idea, at the status the scenario needs. */
async function givenAnIdea(label: string, status: "DRAFT" | "SUBMITTED" | "RANKED") {
  const { ideaId } = await makeIdeaRepo(db).createWithFirstVersion({
    submitterId: ids.employee, departmentId: null, categoryId: null, submit: status !== "DRAFT",
    fields: {
      title: `F-15 ${label}`,
      description: "A description long enough to be meaningful for the social flow.",
      problemStatement: "Meeting rooms sit booked and empty.",
      expectedUsers: "Everyone who books a room.",
      expectedOutcome: "Rooms free up when nobody turns up.",
    },
  });
  createdIdeas.push(ideaId);
  if (status !== "DRAFT") await db.idea.update({ where: { id: ideaId }, data: { status } });
  return ideaId;
}

const notified = async (ideaId: string) =>
  db.notification.findMany({ where: { entityId: ideaId }, select: { userId: true, event: true, payload: true } });

describe("F-15 · comments, mentions and following", () => {
  it("Given a reviewer comments and names a manager, Then the owner and the manager hear once each, the author not at all, and the author now follows", async () => {
    guard();
    const app = makeApp();
    const reviewer = await signIn(app, "reviewer@example.invalid");
    const owner = await signIn(app, "employee@example.invalid");
    const ideaId = await givenAnIdea("mention", "RANKED");

    const post = await app.inject({
      method: "POST", url: `/ideas/${ideaId}/comments`, headers: { cookie: reviewer },
      payload: { body: "@Mo Manager this could pair with the facilities budget review.", mentionIds: [ids.manager] },
    });
    expect(post.statusCode).toBe(201);
    const comment = post.json() as IdeaComment;
    expect(comment.mentions).toEqual([{ id: ids.manager, displayName: expect.any(String) }]);

    const rows = await notified(ideaId);
    expect(rows.filter((r) => r.userId === ids.employee).map((r) => r.event)).toEqual(["COMMENT_ADDED"]);
    expect(rows.filter((r) => r.userId === ids.manager).map((r) => r.event)).toEqual(["MENTIONED"]);
    expect(rows.some((r) => r.userId === ids.reviewer)).toBe(false);

    // The owner reads the thread; the author is now a follower (the owner never is).
    const list = (await app.inject({ method: "GET", url: `/ideas/${ideaId}/comments`, headers: { cookie: owner } }))
      .json() as ListIdeaCommentsResponse;
    expect(list.items.map((c) => c.body)).toEqual([comment.body]);
    const detail = (await app.inject({ method: "GET", url: `/ideas/${ideaId}`, headers: { cookie: reviewer } }))
      .json() as IdeaDetail;
    expect(detail.social).toEqual({ following: true, followerCount: 1 });
    expect(detail.commentCount).toBe(1);
  });

  it("Given an idea a manager cannot open, Then naming them in a comment is dropped, they cannot read the thread, and the @ picker never offers them", async () => {
    guard();
    const app = makeApp();
    const reviewer = await signIn(app, "reviewer@example.invalid");
    const manager = await signIn(app, "manager@example.invalid");
    const owner = await signIn(app, "employee@example.invalid");
    // MANAGEMENT reads ideas from EVALUATED onward; a SUBMITTED one is not theirs to see.
    const ideaId = await givenAnIdea("invisible", "SUBMITTED");

    const post = await app.inject({
      method: "POST", url: `/ideas/${ideaId}/comments`, headers: { cookie: reviewer },
      payload: { body: "Looping in @Mo Manager.", mentionIds: [ids.manager] },
    });
    expect(post.statusCode).toBe(201);
    expect((post.json() as IdeaComment).mentions).toEqual([]);
    expect((await notified(ideaId)).some((r) => r.userId === ids.manager)).toBe(false);

    const read = await app.inject({ method: "GET", url: `/ideas/${ideaId}/comments`, headers: { cookie: manager } });
    expect(read.statusCode).toBe(404);

    const picker = (await app.inject({
      method: "GET", url: `/directory/people?q=Mo&ideaId=${ideaId}`, headers: { cookie: owner },
    })).json() as SearchPeopleResponse;
    expect(picker.items.some((p) => p.id === ids.manager)).toBe(false);
    // …but with no idea in context the directory does find them, by name and department only.
    const directory = (await app.inject({ method: "GET", url: "/directory/people?q=Mo", headers: { cookie: owner } }))
      .json() as SearchPeopleResponse;
    const mo = directory.items.find((p) => p.id === ids.manager);
    expect(mo).toBeDefined();
    expect(Object.keys(mo ?? {}).sort()).toEqual(["departmentName", "displayName", "id"]);
  });

  it("Given an admin follows an idea, Then they hear about new comments and stage changes, and can stop following", async () => {
    guard();
    const app = makeApp();
    const admin = await signIn(app, "admin@example.invalid");
    const reviewer = await signIn(app, "reviewer@example.invalid");
    const ideaId = await givenAnIdea("follow", "RANKED");

    const follow = await app.inject({
      method: "POST", url: `/ideas/${ideaId}/follow`, headers: { cookie: admin }, payload: { following: true },
    });
    expect((follow.json() as IdeaFollowState).following).toBe(true);

    await app.inject({
      method: "POST", url: `/ideas/${ideaId}/comments`, headers: { cookie: reviewer },
      payload: { body: "Worth a pilot in one building first." },
    });
    const moved = await app.inject({
      method: "POST", url: `/ideas/${ideaId}/status`, headers: { cookie: reviewer }, payload: { to: "UNDER_REVIEW" },
    });
    expect(moved.statusCode).toBe(200);

    const forAdmin = (await notified(ideaId)).filter((r) => r.userId === ids.admin);
    expect(forAdmin.map((r) => r.event).sort()).toEqual(["COMMENT_ADDED", "FOLLOWED_IDEA_MOVED"]);
    expect(forAdmin.find((r) => r.event === "COMMENT_ADDED")?.payload).toMatchObject({ audience: "FOLLOWER" });

    const unfollow = await app.inject({
      method: "POST", url: `/ideas/${ideaId}/follow`, headers: { cookie: admin }, payload: { following: false },
    });
    expect(unfollow.json()).toMatchObject({ following: false });
  });

  it("Given a comment, Then only its author may edit or delete it, and a deleted one leaves a marker without its words", async () => {
    guard();
    const app = makeApp();
    const reviewer = await signIn(app, "reviewer@example.invalid");
    const owner = await signIn(app, "employee@example.invalid");
    const ideaId = await givenAnIdea("edit", "RANKED");
    const c = (await app.inject({
      method: "POST", url: `/ideas/${ideaId}/comments`, headers: { cookie: reviewer },
      payload: { body: "First thought." },
    })).json() as IdeaComment;
    expect(c.permissions).toMatchObject({ canEdit: true, canDelete: true, canHide: false });

    const notMine = await app.inject({
      method: "PATCH", url: `/comments/${c.id}`, headers: { cookie: owner }, payload: { body: "Rewritten by someone else" },
    });
    expect(notMine.statusCode).toBe(403);

    const edited = (await app.inject({
      method: "PATCH", url: `/comments/${c.id}`, headers: { cookie: reviewer }, payload: { body: "Second thought." },
    })).json() as IdeaComment;
    expect(edited.body).toBe("Second thought.");
    expect(edited.editedAt).not.toBeNull();

    const deleted = (await app.inject({ method: "DELETE", url: `/comments/${c.id}`, headers: { cookie: reviewer } }))
      .json() as IdeaComment;
    expect(deleted).toMatchObject({ state: "DELETED", body: null });
    const stored = await db.ideaComment.findUniqueOrThrow({ where: { id: c.id } });
    expect(stored.body).not.toContain("thought"); // the words are gone, not just hidden
    const detail = (await app.inject({ method: "GET", url: `/ideas/${ideaId}`, headers: { cookie: owner } }))
      .json() as IdeaDetail;
    expect(detail.commentCount).toBe(0);
  });

  it("Given an abusive comment, Then only an admin can hide it, with a reason everyone sees, audited with the withheld text", async () => {
    guard();
    const app = makeApp();
    const reviewer = await signIn(app, "reviewer@example.invalid");
    const admin = await signIn(app, "admin@example.invalid");
    const owner = await signIn(app, "employee@example.invalid");
    const ideaId = await givenAnIdea("hide", "RANKED");
    const c = (await app.inject({
      method: "POST", url: `/ideas/${ideaId}/comments`, headers: { cookie: reviewer },
      payload: { body: "Something that should not stay up." },
    })).json() as IdeaComment;

    const byOwner = await app.inject({
      method: "POST", url: `/comments/${c.id}/hide`, headers: { cookie: owner }, payload: { reason: "I dislike it" },
    });
    expect(byOwner.statusCode).toBe(403);
    const noReason = await app.inject({
      method: "POST", url: `/comments/${c.id}/hide`, headers: { cookie: admin }, payload: { reason: "" },
    });
    expect(noReason.statusCode).toBe(400);

    const hidden = (await app.inject({
      method: "POST", url: `/comments/${c.id}/hide`, headers: { cookie: admin },
      payload: { reason: "Personal remark about a colleague." },
    })).json() as IdeaComment;
    expect(hidden).toMatchObject({ state: "HIDDEN", body: null, hiddenReason: "Personal remark about a colleague." });

    const seenByOwner = (await app.inject({ method: "GET", url: `/ideas/${ideaId}/comments`, headers: { cookie: owner } }))
      .json() as ListIdeaCommentsResponse;
    expect(seenByOwner.items[0]).toMatchObject({ state: "HIDDEN", body: null });

    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "comment.hide", entityId: ideaId } });
    expect(audit.reason).toBe("Personal remark about a colleague.");
    expect(audit.before).toMatchObject({ commentId: c.id, body: "Something that should not stay up." });

    // Straight at the database: a hide with no reason is unstorable.
    const other = await db.ideaComment.create({ data: { ideaId, authorId: ids.reviewer, body: "x" } });
    await expect(
      db.ideaComment.update({ where: { id: other.id }, data: { hiddenAt: new Date(), hiddenById: ids.admin } }),
    ).rejects.toThrow();
  });

  it("Given a draft, Then it takes no comments — and a comment never moves the score", async () => {
    guard();
    const app = makeApp();
    const owner = await signIn(app, "employee@example.invalid");
    const draftId = await givenAnIdea("draft", "DRAFT");
    const onDraft = await app.inject({
      method: "POST", url: `/ideas/${draftId}/comments`, headers: { cookie: owner }, payload: { body: "Note to self" },
    });
    expect(onDraft.statusCode).toBe(403);

    const rankedId = await givenAnIdea("no-score", "RANKED");
    const before = await db.evaluation.findMany({ where: { ideaVersion: { ideaId: rankedId } } });
    await app.inject({
      method: "POST", url: `/ideas/${rankedId}/comments`, headers: { cookie: owner }, payload: { body: "Any thoughts?" },
    });
    const after = await db.evaluation.findMany({ where: { ideaVersion: { ideaId: rankedId } } });
    expect(after).toEqual(before);
  });
});

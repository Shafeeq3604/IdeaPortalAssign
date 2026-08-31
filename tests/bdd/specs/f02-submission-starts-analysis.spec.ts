import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@iep/db";
import type { ApiEnv } from "@iep/contracts/env";
import { buildServer } from "@iep/api/src/server.js";
import type { AppContext } from "@iep/api/src/context.js";
import { MemorySessionStore } from "@iep/api/src/auth/session.js";
import { makeIdeaRepo } from "@iep/api/src/modules/idea/repo.js";

/**
 * F-02b — pressing "Submit for analysis" actually starts the analysis (FR-02, FR-03).
 *
 * There are TWO ways an idea reaches SUBMITTED, and only one of them worked.
 *
 *   1. Fill the form and press submit  → `createIdea` with `submit: true`
 *   2. Save a draft, then press submit → `transitionIdea` to SUBMITTED
 *
 * The first enqueued the analysis job. The second changed the status and stopped. The
 * six-step stepper appeared, reported "0 of 6 finished", and polled every two seconds
 * forever — because there was no job for it to report on. Nothing errored; the idea WAS
 * submitted, it was simply never going to be analysed.
 *
 * No test covered path 2. The E2E journey submits straight from the form, and the BDD
 * pipeline specs call `runPipeline` directly, so both skipped the handler that was wrong.
 * This one drives the real endpoint and asserts on the ENQUEUER, which is the boundary
 * where the two paths were supposed to converge.
 */

const DATABASE_URL = process.env["DATABASE_URL"] ?? "postgresql://iep:iep@localhost:5433/iep";
const db = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

let reachable = false;
let submitterId = "";
const createdIdeas: string[] = [];

/** Records what was enqueued instead of pretending it happened. */
interface Enqueued {
  ideaId: string;
  ideaVersionId: string;
  contentHash: string;
}

function makeApp(jobs: Enqueued[]) {
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
    analysis: {
      enqueue: async (job) => {
        jobs.push(job);
        return true;
      },
    },
    ranking: { enqueue: async () => true },
  };
  return buildServer(ctx);
}

async function signIn(app: ReturnType<typeof makeApp>) {
  const response = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email: "employee@example.invalid", password: "innovation-2026" },
  });
  if (response.statusCode !== 200) throw new Error("could not sign in — run `pnpm db:seed`");
  return response.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

beforeAll(async () => {
  try {
    await db.$queryRaw`SELECT 1`;
    reachable = true;
  } catch {
    return;
  }
  submitterId = (await db.user.findUnique({ where: { email: "employee@example.invalid" } }))?.id ?? "";
});

afterAll(async () => {
  if (reachable && createdIdeas.length > 0) {
    await db.idea.deleteMany({ where: { id: { in: createdIdeas } } });
  }
  await db.$disconnect();
});

const guard = () => {
  if (!reachable) throw new Error("database unreachable — run `pnpm deps:up` before the BDD flows");
  if (!submitterId) throw new Error("no seeded employee — run `pnpm db:seed`");
};

async function givenADraft(label: string) {
  const { ideaId, versionId } = await makeIdeaRepo(db).createWithFirstVersion({
    submitterId, departmentId: null, categoryId: null, submit: false,
    fields: {
      title: `F-02b ${label} ${createdIdeas.length}`,
      description: "A description long enough to be meaningful for the submission tests.",
      problemStatement: "A weekly task is done by hand.",
      expectedUsers: "The team that does it.",
      expectedOutcome: "It takes less time.",
    },
  });
  createdIdeas.push(ideaId);
  return { ideaId, versionId };
}

describe("F-02b · submitting a draft", () => {
  it("Given a draft, When submitted, Then the analysis job is enqueued for its version", async () => {
    guard();
    const jobs: Enqueued[] = [];
    const app = makeApp(jobs);
    const cookie = await signIn(app);
    const { ideaId, versionId } = await givenADraft("enqueues");

    const response = await app.inject({
      method: "POST",
      url: `/ideas/${ideaId}/status`,
      headers: { cookie },
      payload: { to: "SUBMITTED" },
    });

    expect(response.statusCode, response.body).toBe(200);

    /**
     * The assertion that would have caught the bug.
     *
     * Checking the status came back as SUBMITTED passes either way — the status change
     * always worked. What was missing is the job, so the job is what is asserted, and it
     * has to be for THIS version: enqueueing the wrong one analyses stale text.
     */
    expect(jobs, "submitting a draft enqueued no analysis job").toHaveLength(1);
    expect(jobs[0]?.ideaId).toBe(ideaId);
    expect(jobs[0]?.ideaVersionId).toBe(versionId);

    // The hash travels with it — the worker uses it to skip steps whose inputs are unchanged.
    const version = await db.ideaVersion.findUniqueOrThrow({ where: { id: versionId } });
    expect(jobs[0]?.contentHash).toBe(version.contentHash);

    await app.close();
  });

  it("Given a draft, When submitted, Then submittedAt is stamped", async () => {
    guard();
    const app = makeApp([]);
    const cookie = await signIn(app);
    const { ideaId } = await givenADraft("stamps");

    expect(
      (await db.idea.findUniqueOrThrow({ where: { id: ideaId } })).submittedAt,
      "a draft should not have a submission date",
    ).toBeNull();

    await app.inject({
      method: "POST",
      url: `/ideas/${ideaId}/status`,
      headers: { cookie },
      payload: { to: "SUBMITTED" },
    });

    // Was null forever on this path, so the idea had no submission date anywhere in the
    // product and sorted as though it had never been submitted.
    const after = await db.idea.findUniqueOrThrow({ where: { id: ideaId } });
    expect(after.submittedAt).not.toBeNull();

    await app.close();
  });

  it("Given a status change that is NOT a submission, Then nothing is enqueued", async () => {
    guard();
    const jobs: Enqueued[] = [];
    const app = makeApp(jobs);
    const cookie = await signIn(app);
    const { ideaId } = await givenADraft("other-transition");

    await app.inject({
      method: "POST", url: `/ideas/${ideaId}/status`,
      headers: { cookie }, payload: { to: "SUBMITTED" },
    });
    expect(jobs).toHaveLength(1);

    /**
     * Submitting the same idea again must not queue a second analysis of the same
     * version. The fix is scoped to "moved INTO submitted", not "touched the status".
     */
    const repeat = await app.inject({
      method: "POST", url: `/ideas/${ideaId}/status`,
      headers: { cookie }, payload: { to: "SUBMITTED" },
    });
    expect(repeat.statusCode, "SUBMITTED → SUBMITTED is not a legal move").not.toBe(200);
    expect(jobs, "a refused transition still enqueued work").toHaveLength(1);

    await app.close();
  });
});

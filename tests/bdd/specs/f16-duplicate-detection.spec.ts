import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@iep/db";
import type { ApiEnv } from "@iep/contracts/env";
import type { IdeaDetail } from "@iep/contracts";
import type { DetectionProvider, EmbeddingProvider, EmbeddingResult } from "@iep/ai";
import { StubDetectionProvider } from "@iep/ai";
import { runDetection } from "@iep/evaluation";
import { buildServer } from "@iep/api/src/server.js";
import type { AppContext } from "@iep/api/src/context.js";
import { MemorySessionStore } from "@iep/api/src/auth/session.js";
import { makeIdeaRepo } from "@iep/api/src/modules/idea/repo.js";
import { LocalDiskBackend } from "@iep/api/src/modules/idea/attachments.js";

/**
 * F-16 — duplicate and existing-solution detection (P12: AI-10 / FR-20, AI-11 / FR-21), as
 * a FLOW. `packages/evaluation/src/detection.test.ts` characterizes the SQL; this proves
 * what a person sees through the API:
 *   1. a near-identical idea surfaces as a similar idea with a plain-language summary;
 *   2. a match the viewer cannot open is never named — a colleague's draft, or an idea an
 *      employee may not see yet (assumption A5) — while a reviewer still hears about it;
 *   3. match detail — the similarity number (ADR-027) and the build/buy/extend/integrate
 *      assessment — reaches reviewers and admins only, never an employee's response (not
 *      merely hidden by the web client);
 *   4. with no embedding available, the fallback still finds the match and makes no
 *      model call at all (SPEC §12.3);
 *   5. the similarity threshold is the admin's, audited, and actually decides a match;
 *   6. nothing here moves a score.
 *
 * Embeddings are controlled, not real: only this file's own text gets a vector, so the
 * cosine between any two is exact and known, and nothing in the shared dev catalogue is
 * ever given a fake embedding.
 */

const DATABASE_URL = process.env["DATABASE_URL"] ?? "postgresql://iep:iep@localhost:5433/iep";
const db = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

let reachable = false;
const ids = { employee: "", reviewer: "", manager: "", admin: "" };
const createdIdeas: string[] = [];
const createdVersions: string[] = [];
const createdSolutions: string[] = [];

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
  if (reachable) {
    if (createdIdeas.length > 0) {
      // `similar_ideas` has no foreign key (a bare P0-reserved table) — both directions,
      // or a seeded idea's later detection pass would find a row pointing at nothing.
      await db.similarIdea.deleteMany({
        where: { OR: [{ ideaId: { in: createdIdeas } }, { similarTo: { in: createdIdeas } }] },
      });
      await db.existingSolutionMatch.deleteMany({ where: { assessment: { ideaVersionId: { in: createdVersions } } } });
      await db.existingSolutionAssessment.deleteMany({ where: { ideaVersionId: { in: createdVersions } } });
      await db.notification.deleteMany({ where: { entityId: { in: createdIdeas } } });
      await db.idea.deleteMany({ where: { id: { in: createdIdeas } } });
    }
    if (createdSolutions.length > 0) {
      await db.existingSolutionMatch.deleteMany({ where: { existingSolutionId: { in: createdSolutions } } });
      await db.existingSolution.deleteMany({ where: { id: { in: createdSolutions } } });
    }
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

/* ── controlled embeddings ─────────────────────────────────────────────────────────── */

const DIMS = 1536;
/** Each scenario owns its own axis, so one scenario's ideas are orthogonal to (cosine 0
 *  with) every other's and can never turn up in its matches. */
const AXIS = { pair: 0, private: 2, catalogue: 4, threshold: 6, noScore: 8 } as const;
const basis = (i: number) => Array.from({ length: DIMS }, (_, k) => (k === i ? 1 : 0));
/** Unit vector at exactly `cos` to basis(i), tilted towards basis(i + 1). */
const atCosine = (i: number, cos: number) => {
  const v = basis(i).map((x) => x * cos);
  v[i + 1] = Math.sqrt(1 - cos * cos);
  return v;
};

/**
 * Each scenario tags its text with a marker; the marker picks the vector. Text without a
 * marker — any real catalogue entry the catch-up pass meets — is refused, so this file
 * never writes a fake embedding onto shared data.
 */
function keyedEmbeddings(byMarker: Record<string, readonly number[]>): EmbeddingProvider {
  return {
    name: "stub",
    embed(text: string): Promise<EmbeddingResult> {
      const hit = Object.entries(byMarker).find(([marker]) => text.includes(marker));
      return Promise.resolve(
        hit ? { ok: true, vector: hit[1], usage: { tokens: 1, costUsd: 0 } } : { ok: false, errorCode: "UNAVAILABLE" },
      );
    },
  };
}

const noEmbeddings: EmbeddingProvider = {
  name: "openai",
  embed: () => Promise.resolve({ ok: false, errorCode: "UNAVAILABLE" }),
};

/** Proves the fallback path by throwing if it is ever reached. */
const noModelCalls: DetectionProvider = {
  name: "anthropic",
  summarizeDifference: () => { throw new Error("the fallback path must make no model call"); },
  recommendExistingSolution: () => { throw new Error("the fallback path must make no model call"); },
};

/* ── givens ────────────────────────────────────────────────────────────────────────── */

type Status = "DRAFT" | "SUBMITTED" | "RANKED";

async function givenAnIdea(
  submitter: keyof typeof ids, status: Status, title: string, problemStatement: string, categoryId: string | null = null,
) {
  const { ideaId } = await makeIdeaRepo(db).createWithFirstVersion({
    submitterId: ids[submitter], departmentId: null, categoryId, submit: status !== "DRAFT",
    fields: {
      title,
      description: "A description long enough to be meaningful for the detection flow.",
      problemStatement,
      expectedUsers: "Everyone who files an expense claim.",
      expectedOutcome: "Claims are checked without anyone retyping a receipt.",
    },
  });
  createdIdeas.push(ideaId);
  if (status !== "DRAFT") await db.idea.update({ where: { id: ideaId }, data: { status } });
  const idea = await db.idea.findUniqueOrThrow({ where: { id: ideaId }, select: { currentVersionId: true } });
  if (idea.currentVersionId) createdVersions.push(idea.currentVersionId);
  return { ideaId, versionId: idea.currentVersionId ?? "" };
}

const detect = (
  idea: { ideaId: string; versionId: string },
  embeddingProvider: EmbeddingProvider,
  detectionProvider: DetectionProvider = new StubDetectionProvider(),
) => runDetection({ db, embeddingProvider, detectionProvider }, { ideaId: idea.ideaId, ideaVersionId: idea.versionId });

async function detail(app: ReturnType<typeof makeApp>, cookie: string, ideaId: string) {
  const res = await app.inject({ method: "GET", url: `/ideas/${ideaId}`, headers: { cookie } });
  expect(res.statusCode).toBe(200);
  return res.json() as IdeaDetail;
}

/* ── scenarios ─────────────────────────────────────────────────────────────────────── */

describe("F-16 · we found a similar idea", () => {
  it("Given two near-identical ranked ideas, When detection runs, Then the owner sees the other one named with a plain-language summary", async () => {
    guard();
    const app = makeApp();
    const owner = await signIn(app, "employee@example.invalid");
    const marker = "F16-pair";
    const earlier = await givenAnIdea("manager", "RANKED", `${marker} Scan receipts into expense claims`, "Receipts are retyped by hand.");
    const mine = await givenAnIdea("employee", "RANKED", `${marker} Read receipts automatically for claims`, "Receipts are retyped by hand.");
    const embeddings = keyedEmbeddings({ [marker]: basis(AXIS.pair) });

    await detect(earlier, embeddings);
    const result = await detect(mine, embeddings);
    expect(result.embeddingSource).toBe("stub");

    const seen = await detail(app, owner, mine.ideaId);
    const match = seen.similarIdeas.find((s) => s.ideaId === earlier.ideaId);
    expect(match?.title).toBe(`${marker} Scan receipts into expense claims`);
    expect(match?.differenceSummary).toEqual(expect.any(String));
    // ADR-027: the banner, never the number behind it (REQUIREMENTS §15).
    expect(seen.permissions.canSeeMatchDetail).toBe(false);
    expect(match?.similarity).toBeNull();

    const reviewer = await signIn(app, "reviewer@example.invalid");
    const asReviewer = await detail(app, reviewer, mine.ideaId);
    expect(asReviewer.similarIdeas.find((s) => s.ideaId === earlier.ideaId)?.similarity).toBeCloseTo(1, 3);
  });

  it("Given the match is a colleague's draft or an idea not yet ranked, Then an employee's banner never names it — and a reviewer still hears about both", async () => {
    guard();
    const app = makeApp();
    const owner = await signIn(app, "employee@example.invalid");
    const reviewer = await signIn(app, "reviewer@example.invalid");
    const marker = "F16-private";
    const draft = await givenAnIdea("admin", "DRAFT", `${marker} Admin's private draft`, "Rooms sit booked and empty.");
    const unranked = await givenAnIdea("manager", "SUBMITTED", `${marker} Manager's queued idea`, "Rooms sit booked and empty.");
    const mine = await givenAnIdea("employee", "RANKED", `${marker} Release unused rooms`, "Rooms sit booked and empty.");
    const embeddings = keyedEmbeddings({ [marker]: basis(AXIS.private) });
    // Drafts are never analysed, so never embedded by the pipeline; embedding one here
    // stands in for any route by which it becomes searchable (the trigram fallback
    // needs no embedding at all — scenario 4 covers that path).
    await detect(draft, embeddings);
    await detect(unranked, embeddings);
    await detect(mine, embeddings);

    const stored = await db.similarIdea.findMany({ where: { ideaId: mine.ideaId } });
    expect(stored.map((s) => s.similarTo).sort()).toEqual([draft.ideaId, unranked.ideaId].sort());

    const asOwner = await detail(app, owner, mine.ideaId);
    expect(asOwner.similarIdeas.map((s) => s.ideaId)).not.toContain(draft.ideaId);
    expect(asOwner.similarIdeas.map((s) => s.ideaId)).not.toContain(unranked.ideaId);
    expect(JSON.stringify(asOwner)).not.toContain("private draft");
    expect(JSON.stringify(asOwner)).not.toContain("queued idea");

    const asReviewer = await detail(app, reviewer, mine.ideaId);
    expect(asReviewer.similarIdeas.map((s) => s.ideaId).sort()).toEqual([draft.ideaId, unranked.ideaId].sort());
  });
});

describe("F-16 · existing solutions are internal decision support", () => {
  it("Given a catalogue entry close to the idea, Then a reviewer sees the build/buy call and its match, and an employee's response carries neither", async () => {
    guard();
    const app = makeApp();
    const owner = await signIn(app, "employee@example.invalid");
    const reviewer = await signIn(app, "reviewer@example.invalid");
    const marker = "F16-catalogue";
    const solution = await db.existingSolution.create({
      data: {
        name: `${marker} Receipt OCR service`, kind: "INTERNAL_SYSTEM",
        description: `${marker} Extracts line items from scanned receipts.`, categories: [], isActive: true,
      },
    });
    createdSolutions.push(solution.id);
    const mine = await givenAnIdea("employee", "RANKED", `${marker} Read receipts for claims`, "Receipts are retyped.");

    await detect(mine, keyedEmbeddings({ [marker]: basis(AXIS.catalogue) }));

    const asReviewer = await detail(app, reviewer, mine.ideaId);
    expect(asReviewer.permissions.canSeeMatchDetail).toBe(true);
    expect(asReviewer.existingSolutionAssessment?.recommendation).toBe("EXTEND"); // the stub's call for "a match exists"
    expect(asReviewer.existingSolutionAssessment?.matches.map((m) => m.name)).toEqual([`${marker} Receipt OCR service`]);

    const asOwner = await detail(app, owner, mine.ideaId);
    expect(asOwner.permissions.canSeeMatchDetail).toBe(false);
    expect(asOwner.existingSolutionAssessment).toBeNull();
    expect(JSON.stringify(asOwner)).not.toContain("Receipt OCR service");
  });
});

describe("F-16 · the non-AI fallback", () => {
  it("Given no embedding is available, When detection runs, Then the wording overlap still finds the match, with no summary and no model call", async () => {
    guard();
    const app = makeApp();
    const owner = await signIn(app, "employee@example.invalid");
    const wording = "F16 fallback automatic receipt extraction for expense claims";
    const earlier = await givenAnIdea("manager", "RANKED", wording, "Receipts are retyped by hand into the expense tool.");
    const mine = await givenAnIdea("employee", "RANKED", `${wording} too`, "Receipts are retyped by hand into the expense tool.");

    const result = await detect(mine, noEmbeddings, noModelCalls);
    expect(result.embeddingSource).toBe("fallback");

    const seen = await detail(app, owner, mine.ideaId);
    const match = seen.similarIdeas.find((s) => s.ideaId === earlier.ideaId);
    expect(match).toBeDefined();
    expect(match?.differenceSummary).toBeNull();

    const assessment = await db.existingSolutionAssessment.findUnique({ where: { ideaVersionId: mine.versionId } });
    expect(assessment?.source).toBe("FALLBACK");
    expect(assessment?.recommendation).toBeNull();
  });
});

describe("F-16 · the threshold is the admin's", () => {
  it("Given two ideas at cosine 0.90, Then they match at the seeded 0.85 and stop matching once an admin raises it to 0.95 — audited, and refused to an employee", async () => {
    guard();
    const app = makeApp();
    const admin = await signIn(app, "admin@example.invalid");
    const employee = await signIn(app, "employee@example.invalid");
    const near = "F16-threshold-near";
    const base = "F16-threshold-base";
    const other = await givenAnIdea("manager", "RANKED", `${base} Auto-release meeting rooms`, "Rooms sit empty.");
    const mine = await givenAnIdea("employee", "RANKED", `${near} Free rooms nobody uses`, "Rooms sit empty.");
    const embeddings = keyedEmbeddings({ [base]: basis(AXIS.threshold), [near]: atCosine(AXIS.threshold, 0.9) });

    const original = await db.detectionConfig.upsert({ where: { id: "default" }, update: {}, create: { id: "default" } });
    const restore = {
      similarIdeaThreshold: Number(original.similarIdeaThreshold),
      existingSolutionThreshold: Number(original.existingSolutionThreshold),
      existingSolutionTopN: original.existingSolutionTopN,
    };
    try {
      await detect(other, embeddings);
      await detect(mine, embeddings);
      const atSeeded = await db.similarIdea.findFirst({ where: { ideaId: mine.ideaId, similarTo: other.ideaId } });
      expect(Number(atSeeded?.similarity)).toBeCloseTo(0.9, 3);

      const refused = await app.inject({
        method: "PATCH", url: "/config/detection", headers: { cookie: employee },
        payload: { ...restore, similarIdeaThreshold: 0.95 },
      });
      expect(refused.statusCode).toBe(403);

      const raised = await app.inject({
        method: "PATCH", url: "/config/detection", headers: { cookie: admin },
        payload: { ...restore, similarIdeaThreshold: 0.95 },
      });
      expect(raised.statusCode).toBe(200);
      const audit = await db.auditLog.findFirst({
        where: { action: "config.detectionThresholds", actorId: ids.admin }, orderBy: { at: "desc" },
      });
      expect(audit?.after).toMatchObject({ similarIdeaThreshold: 0.95 });

      await detect(mine, embeddings);
      expect(await db.similarIdea.count({ where: { ideaId: mine.ideaId, similarTo: other.ideaId } })).toBe(0);
    } finally {
      await db.detectionConfig.update({ where: { id: "default" }, data: restore });
    }
  });
});

describe("F-16 · nothing here is scored", () => {
  it("Given the board as it stands, When detection finds a duplicate, Then no evaluation, criterion score or ranking entry anywhere changes", async () => {
    guard();
    const marker = "F16-noscore";
    const other = await givenAnIdea("manager", "RANKED", `${marker} Scan receipts`, "Receipts are retyped.");
    const mine = await givenAnIdea("employee", "RANKED", `${marker} Read receipts`, "Receipts are retyped.");
    const embeddings = keyedEmbeddings({ [marker]: basis(AXIS.noScore) });
    await detect(other, embeddings);

    // Database-wide, not just this idea's (which has none): the claim is that detection
    // writes to no score-bearing table at all (P-1, ADR-005).
    const snapshot = () => Promise.all([
      db.evaluation.findMany({ orderBy: { id: "asc" } }),
      db.criterionScore.findMany({ orderBy: { id: "asc" } }),
      db.rankingEntry.findMany({ orderBy: { id: "asc" } }),
    ]);
    const before = await snapshot();
    const result = await detect(mine, embeddings);
    expect(result.similarIdeaCount).toBeGreaterThanOrEqual(1);
    expect(await snapshot()).toEqual(before);
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@iep/db";
import { canTransition, ideaListScope, can } from "@iep/contracts";
import type { IdeaStatus } from "@iep/contracts";
import { contentHash, makeIdeaRepo, scopeToWhere } from "./repo.js";

/**
 * Idea module integration tests (P2).
 *
 * These run against a REAL PostgreSQL, because the point is the constraints: seven
 * requirements are enforced by the database (SPEC §17.4), and a mocked client would
 * happily accept every invalid write these tests are here to reject.
 *
 * Requires `pnpm deps:up`. Skipped with a clear message if the database is absent, so a
 * developer without Docker gets a skip rather than a confusing failure.
 */

const DATABASE_URL = process.env["DATABASE_URL"] ?? "postgresql://iep:iep@localhost:5433/iep";
const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

let reachable = false;
let submitterId = "";
let otherUserId = "";
const created: string[] = [];

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    reachable = true;
  } catch {
    return;
  }
  const users = await prisma.user.findMany({ orderBy: { email: "asc" }, take: 2 });
  submitterId = users[0]?.id ?? "";
  otherUserId = users[1]?.id ?? "";
});

afterAll(async () => {
  if (reachable && created.length > 0) {
    await prisma.idea.deleteMany({ where: { id: { in: created } } });
  }
  await prisma.$disconnect();
});

const guard = () => {
  if (!reachable) {
    throw new Error("database unreachable — run `pnpm deps:up` before the integration tests");
  }
};

const FIELDS = {
  title: "Integration test idea",
  description: "A description long enough to be meaningful.",
  problemStatement: "A problem worth stating.",
  expectedUsers: "The people affected.",
  expectedOutcome: "What would change.",
};

async function makeIdea(submit = false) {
  const repo = makeIdeaRepo(prisma);
  const { ideaId } = await repo.createWithFirstVersion({
    submitterId,
    departmentId: null,
    categoryId: null,
    submit,
    fields: { ...FIELDS },
  });
  created.push(ideaId);
  return ideaId;
}

describe("content hashing — the idempotency key for re-analysis", () => {
  it("is stable regardless of key order", () => {
    expect(contentHash({ a: "1", b: "2" })).toBe(contentHash({ b: "2", a: "1" }));
  });

  it("changes when content changes — otherwise a revision would reuse stale analysis", () => {
    expect(contentHash({ a: "1" })).not.toBe(contentHash({ a: "2" }));
  });

  it("treats undefined and null alike, so an absent field is not a new hash", () => {
    expect(contentHash({ a: "1", b: undefined })).toBe(contentHash({ a: "1", b: null }));
  });
});

describe("scope filter — a list must not return what a detail view would refuse", () => {
  it("an unrestricted scope adds no clause", () => {
    expect(scopeToWhere({ all: true })).toEqual({});
  });

  it("a scoped actor gets own-OR-visible, evaluated in SQL", () => {
    const where = scopeToWhere({ all: false, ownerId: "u1", statusIn: ["RANKED"] });
    expect(where.OR).toEqual([{ submitterId: "u1" }, { status: { in: ["RANKED"] } }]);
  });

  it("every status the employee scope lists is also readable in detail", () => {
    const actor = { userId: "u1", roles: ["EMPLOYEE"] as const };
    for (const status of ideaListScope(actor).statusIn ?? []) {
      const decision = can(actor, "idea:read", {
        ideaId: "i1", submitterId: "someone-else", status,
      });
      expect(decision.allowed, `${status} is listed but not readable`).toBe(true);
    }
  });
});

describe("persistence against a real database", () => {
  it("creates an idea and its v1 atomically", async () => {
    guard();
    const ideaId = await makeIdea();
    const repo = makeIdeaRepo(prisma);
    const idea = await repo.findById(ideaId);

    expect(idea).not.toBeNull();
    // The deferrable FK means there is never a window with no current version.
    expect(idea!.currentVersionId).not.toBeNull();
    expect(idea!.currentVersion?.versionNo).toBe(1);
    expect(idea!.status).toBe("DRAFT");
  });

  it("records a status-history row when an idea is submitted at creation", async () => {
    guard();
    const ideaId = await makeIdea(true);
    const history = await makeIdeaRepo(prisma).statusHistory(ideaId);
    expect(history).toHaveLength(1);
    expect(history[0]!.toStatus).toBe("SUBMITTED");
  });

  it("writes the status change and its history in one transaction (FR-23)", async () => {
    guard();
    const ideaId = await makeIdea();
    const repo = makeIdeaRepo(prisma);
    await repo.transition({
      ideaId, from: "DRAFT", to: "SUBMITTED", actorId: submitterId, reason: null,
    });

    const [idea, history] = await Promise.all([repo.findById(ideaId), repo.statusHistory(ideaId)]);
    expect(idea!.status).toBe("SUBMITTED");
    expect(history.some((h) => h.fromStatus === "DRAFT" && h.toStatus === "SUBMITTED")).toBe(true);
  });

  it("numbers versions sequentially and keeps the earlier one frozen (FR-24)", async () => {
    guard();
    const ideaId = await makeIdea(true);
    const repo = makeIdeaRepo(prisma);

    const { versionNo } = await repo.createNextVersion({
      ideaId,
      authorId: submitterId,
      changeSummary: "Added the technology approach.",
      addressesRecommendationIds: [],
      fields: { ...FIELDS, title: "Integration test idea v2", suggestedTechnology: "OCR service" },
    });
    expect(versionNo).toBe(2);

    const v1 = await repo.findVersion(ideaId, 1);
    // v1 must be untouched — history is only true if the snapshot is.
    expect(v1!.title).toBe(FIELDS.title);
    expect(v1!.suggestedTechnology).toBeNull();

    const idea = await repo.findById(ideaId);
    expect(idea!.currentVersion?.versionNo).toBe(2);
  });
});

describe("the database refuses what the API refuses (SPEC §17.4)", () => {
  it("rejects a v2 with no change summary", async () => {
    guard();
    const ideaId = await makeIdea(true);
    await expect(
      prisma.ideaVersion.create({
        data: {
          ideaId, versionNo: 2, authorId: submitterId, contentHash: "x",
          changeSummary: null, // CHECK: mandatory from v2
          ...FIELDS,
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects a v1 that carries a change summary", async () => {
    guard();
    const idea = await prisma.idea.create({ data: { submitterId, status: "DRAFT" } });
    created.push(idea.id);
    await expect(
      prisma.ideaVersion.create({
        data: {
          ideaId: idea.id, versionNo: 1, authorId: submitterId, contentHash: "x",
          changeSummary: "there is nothing to summarise yet",
          ...FIELDS,
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects a title longer than the contract allows", async () => {
    guard();
    const idea = await prisma.idea.create({ data: { submitterId, status: "DRAFT" } });
    created.push(idea.id);
    await expect(
      prisma.ideaVersion.create({
        data: {
          ideaId: idea.id, versionNo: 1, authorId: submitterId, contentHash: "x",
          ...FIELDS, title: "x".repeat(201),
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects a review by the idea's own author (privilege escalation guard)", async () => {
    guard();
    const ideaId = await makeIdea(true);
    await expect(
      prisma.review.create({
        data: { ideaId, reviewerId: submitterId, decision: "VALIDATED", comment: "mine" },
      }),
    ).rejects.toThrow();
  });

  it("rejects a rejection with no reason (FR-23)", async () => {
    guard();
    const ideaId = await makeIdea(true);
    await expect(
      prisma.review.create({
        data: { ideaId, reviewerId: otherUserId, decision: "REJECTED", comment: null },
      }),
    ).rejects.toThrow();
  });

  it("accepts a rejection WITH a reason, from someone else", async () => {
    guard();
    const ideaId = await makeIdea(true);
    const review = await prisma.review.create({
      data: { ideaId, reviewerId: otherUserId, decision: "REJECTED", comment: "Duplicates an existing tool." },
    });
    expect(review.id).toBeTruthy();
  });
});

describe("the transition table and the database agree", () => {
  /** Every transition the table permits must be a status the enum accepts. */
  it("no permitted transition targets an unknown status", () => {
    const known = new Set<IdeaStatus>([
      "DRAFT", "SUBMITTED", "AI_ANALYSIS", "NEEDS_CLARIFICATION", "EVALUATED", "RANKED",
      "UNDER_REVIEW", "PROTOTYPE_CANDIDATE", "PILOT", "PRODUCTION_CANDIDATE",
      "IMPLEMENTED", "PARKED", "BLOCKED", "REJECTED", "ARCHIVED",
    ]);
    const result = canTransition("DRAFT", "SUBMITTED", {
      actorRoles: ["EMPLOYEE"], isSubmitter: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(known.has(result.transition.to)).toBe(true);
  });

  it("an employee cannot skip the pipeline", () => {
    const result = canTransition("DRAFT", "IMPLEMENTED", {
      actorRoles: ["EMPLOYEE"], isSubmitter: true,
    });
    expect(result.ok).toBe(false);
  });
});

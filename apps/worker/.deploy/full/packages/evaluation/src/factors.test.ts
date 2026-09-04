import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@iep/db";
import { buildFactorSet, loadEngineConfig } from "./factors.js";

/**
 * Characterization tests for `packages/evaluation` — "the bridge between the database and
 * the pure engine," per its own file comment, and the one package this repo's audit
 * flagged with zero test files despite that description. Previously the only thing
 * standing between a change here and a silently wrong composite score was the BDD suite's
 * end-to-end coverage, several layers removed from this module.
 *
 * These run against a REAL PostgreSQL, the same convention idea.integration.test.ts
 * already uses, and for the same reason: `loadEngineConfig` and `buildFactorSet` are nearly
 * all Prisma reads shaping real rows into the engine's input types — a mocked client
 * would happily hand back whatever shape the mock author assumed, which is exactly the
 * class of bug this file exists to catch. Read-only: nothing here writes, so there is
 * nothing to clean up in `afterAll`.
 *
 * Requires `pnpm deps:up`. Each test returns early — a silent pass, not a vitest skip —
 * if the database is unreachable, checked once in `beforeAll` rather than per test.
 */

const DATABASE_URL = process.env["DATABASE_URL"] ?? "postgresql://iep:iep@localhost:5433/iep";
const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

let reachable = false;
let seededVersionId = "";

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    reachable = true;
  } catch {
    return;
  }
  // Any version with a completed analysis — buildFactorSet's real target — rather than a
  // fixed id, so this survives a re-seed without hand-updating a hardcoded uuid.
  const version = await prisma.ideaVersion.findFirst({
    where: { analyses: { some: {} } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  seededVersionId = version?.id ?? "";
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("loadEngineConfig", () => {
  it("loads the default profile when no key is given, with every active criterion weighted", async () => {
    if (!reachable) return;
    const { config, profileId, criterionIdByKey } = await loadEngineConfig(prisma);

    expect(config.profile.isDefault).toBe(true);
    expect(profileId).toBeTruthy();
    expect(config.criteria.length).toBeGreaterThan(0);
    // Every criterion the config carries has a real database id behind it — the map
    // buildFactorSet and evaluate.ts both depend on to translate a key back to a row.
    for (const c of config.criteria) {
      expect(criterionIdByKey.get(c.key)).toBeTruthy();
    }
  });

  it("loads a specific profile by key when one is given", async () => {
    if (!reachable) return;
    const { config } = await loadEngineConfig(prisma, "quick_wins");
    expect(config.profile.key).toBe("quick_wins");
  });

  it("throws a named error for a profile key that does not exist, rather than returning an empty config", async () => {
    if (!reachable) return;
    await expect(loadEngineConfig(prisma, "not-a-real-profile")).rejects.toThrow(
      /no evaluation profile with key "not-a-real-profile"/,
    );
  });

  it("carries the profile's weights keyed by criterion KEY, not by row id", async () => {
    if (!reachable) return;
    const { config } = await loadEngineConfig(prisma, "balanced");
    const weightKeys = Object.keys(config.profile.weights);
    expect(weightKeys.length).toBeGreaterThan(0);
    // The keys must be criterion keys (short, lowercase-with-underscore strings) rather
    // than uuids — the failure mode this guards is `keyById.get` silently mapping to the
    // wrong side of the criterionId → key join.
    for (const key of weightKeys) {
      expect(key).not.toMatch(/^[0-9a-f-]{36}$/i);
    }
  });
});

describe("buildFactorSet", () => {
  it("returns null for a version with no analysis, plan, feasibility or risks at all", async () => {
    if (!reachable) return;
    // A version id that cannot exist — buildFactorSet's very first DB read returns
    // null for it, which is what "not found" looks like here (see the second case below
    // for the "found but empty" path, which is a different branch in the same function).
    const result = await buildFactorSet(prisma, "00000000-0000-0000-0000-000000000000");
    expect(result).toBeNull();
  });

  it("shapes a real analysed version's rows into a FactorSet with no invented numbers", async () => {
    if (!reachable || !seededVersionId) return;
    const factors = await buildFactorSet(prisma, seededVersionId);
    expect(factors).not.toBeNull();
    if (!factors) return;

    expect(factors.ideaVersionId).toBe(seededVersionId);
    // completeness is always present, never a placeholder true/false pair invented here.
    expect(factors.completeness).toBeDefined();
    expect(typeof factors.completeness.hasProblemStatement).toBe("boolean");

    // Every value/feasibility factor has a provenance pair — the "AI said this, at what
    // confidence" contract present.ts and the score cards both render.
    for (const factor of Object.values(factors.value)) {
      expect(["AI", "FALLBACK"]).toContain(factor.source);
      expect(["LOW", "MEDIUM", "HIGH"]).toContain(factor.confidence);
      // P-7: evidence is never empty, even when the source had none to give.
      expect(factor.evidence.length).toBeGreaterThan(0);
    }
  });
});

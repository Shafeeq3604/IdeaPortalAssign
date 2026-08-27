/**
 * `pnpm demo:data` — bring a seeded database to a demonstrable state.
 *
 * Runs the real pipeline over every submitted idea that has not been analysed, evaluates
 * it, writes improvement recommendations where the score warrants them, and computes a
 * ranking run. The result is a product you can open and look at, rather than an empty
 * shell with a working submit button.
 *
 * Three deliberate choices:
 *
 *  - **In-process, not through the queue.** The worker does the same work when you submit
 *    through the UI, and that path is what a demo should show live. This one exists to
 *    make the STARTING state, so it runs synchronously and finishes when it says it has,
 *    rather than leaving you guessing whether Redis got there yet.
 *  - **StubProvider by default.** No tokens, no network, deterministic. Pass
 *    `--provider=anthropic` to use the real model, which needs a key in
 *    `apps/worker/.env` and costs real money — roughly $0.20 an idea at current routing.
 *  - **`--fresh` deletes every idea first.** Off by default, because deleting data should
 *    take asking for it.
 */
import { PrismaClient } from "@iep/db";
import { AnthropicProvider, StubProvider, type AiProvider } from "@iep/ai";
import { evaluateVersion, generateRecommendations, recomputeRankings } from "@iep/evaluation";
import { runPipeline } from "@iep/worker/src/pipeline.js";

const argv = process.argv.slice(2);
const fresh = argv.includes("--fresh");
const useReal = argv.includes("--provider=anthropic");

const db = new PrismaClient();

function makeProvider(): AiProvider {
  if (!useReal) return new StubProvider();
  const key = process.env["ANTHROPIC_API_KEY"];
  if (!key) {
    throw new Error(
      "--provider=anthropic needs ANTHROPIC_API_KEY. It lives in apps/worker/.env; run this " +
        "with `node --env-file=apps/worker/.env` or drop the flag to use the stub.",
    );
  }
  return new AnthropicProvider({ apiKey: key });
}

async function main(): Promise<void> {
  const provider = makeProvider();
  console.log(`demo:data · provider=${useReal ? "anthropic (billable)" : "stub (free)"}`);

  if (fresh) {
    /**
     * Ranking runs first: their entries reference evaluations with `onDelete: Restrict`,
     * so deleting ideas underneath a run fails on the foreign key rather than cascading.
     * Audit rows are left alone — the table is append-only by trigger and deliberately
     * outlives what it describes.
     */
    const runs = await db.rankingRun.deleteMany({});
    const ideas = await db.idea.deleteMany({});
    console.log(`  --fresh: removed ${ideas.count} idea(s) and ${runs.count} ranking run(s)`);
  }

  const pending = await db.idea.findMany({
    where: {
      status: { notIn: ["DRAFT"] },
      currentVersion: { analyses: { none: { status: "SUCCEEDED" } } },
    },
    include: { currentVersion: { select: { id: true, title: true, contentHash: true } } },
    orderBy: { submittedAt: "asc" },
  });

  if (pending.length === 0) {
    console.log("  nothing to analyse — every submitted idea already has results");
  }

  let analysed = 0;
  let advised = 0;

  for (const idea of pending) {
    if (!idea.currentVersion) continue;
    const label = idea.currentVersion.title.slice(0, 52);

    const result = await runPipeline(
      { db, provider, budgetPerVersionUsd: 0.75, redactionEnabled: true },
      {
        ideaId: idea.id,
        ideaVersionId: idea.currentVersion.id,
        contentHash: idea.currentVersion.contentHash,
      },
    );

    const evaluated = await evaluateVersion(db, idea.currentVersion.id);

    // Only below the attention threshold, which is the point of the threshold.
    const improvement = await generateRecommendations(
      { db, provider, budgetUsd: 0.75, redactionEnabled: true },
      { ideaId: idea.id, ideaVersionId: idea.currentVersion.id },
    );

    analysed += 1;
    advised += improvement.generated;

    console.log(
      `  ${label.padEnd(54)} ${result.overall.padEnd(10)} ` +
        `composite ${(evaluated?.compositeScore ?? 0).toFixed(1).padStart(5)} · ` +
        `maturity ${evaluated?.maturityLevel ?? "-"} · ` +
        `${improvement.generated} recommendation(s)`,
    );
  }

  const run = await recomputeRankings(db, {
    triggerReason: "demo data prepared",
  });

  console.log("");
  console.log(`analysed ${analysed} idea(s), wrote ${advised} recommendation(s)`);
  console.log(
    run
      ? `ranking run ${run.runId} · ${run.cohortSize} ideas on the board · profile ${run.profileKey}`
      : "no ranking run — nothing is evaluated yet",
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void db.$disconnect());

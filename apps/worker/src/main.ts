import { Worker } from "bullmq";
import { getPrisma } from "@iep/db";
import { WorkerEnv, loadEnv } from "@iep/contracts/env";
import { AnthropicProvider, StubProvider, type AiProvider } from "@iep/ai";
import {
  ANALYSIS_QUEUE, RANKING_QUEUE, connectionFrom, makeRankingQueue,
  type AnalysisJob, type RankingJob,
} from "./queue.js";
import { runPipeline } from "./pipeline.js";
import { evaluateVersion } from "./evaluate.js";
import { recomputeRankings } from "./ranking.js";

/**
 * apps/worker — the AI pipeline consumer (P3).
 *
 * This is the ONLY process that holds the Anthropic key (SPEC §4.4). The API refuses to
 * boot if it can see one; this one refuses to start without it when the real provider is
 * selected — the two guards point in opposite directions on purpose.
 */

const env = loadEnv(WorkerEnv, process.env);
const db = getPrisma();

function makeProvider(): AiProvider {
  if (env.AI_PROVIDER === "stub") return new StubProvider();
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error(
      "AI_PROVIDER=anthropic but no ANTHROPIC_API_KEY. It belongs in apps/worker/.env " +
        "(never the repo root — the API must not be able to see it).",
    );
  }
  return new AnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY });
}

const provider = makeProvider();

/**
 * The worker enqueues its own ranking recomputes rather than running one inline.
 *
 * A recompute is cohort-wide, so six ideas analysed at once would otherwise trigger
 * six full runs. Through the queue at concurrency 1 they serialise, and the last one
 * is the one the board reads.
 */
const rankingQueue = makeRankingQueue(env.REDIS_URL);

const worker = new Worker<AnalysisJob>(
  ANALYSIS_QUEUE,
  async (job) => {
    const started = Date.now();
    const result = await runPipeline(
      {
        db,
        provider,
        budgetPerVersionUsd: env.AI_BUDGET_PER_VERSION_USD,
        redactionEnabled: env.PII_REDACTION_ENABLED,
      },
      job.data,
    );
    /**
     * Evaluation is part of finishing an analysis, not a separate user action.
     * An analysed idea that carries no score is invisible to every screen in P5–P7,
     * which is exactly the state P4 left the product in.
     */
    const evaluated = await evaluateVersion(db, job.data.ideaVersionId);
    if (evaluated) {
      await rankingQueue.add("recompute", {
        triggerReason: `analysis completed for idea ${job.data.ideaId}`,
      });
    }

    console.log(
      `[analysis] ${result.ideaVersionId} ${result.overall} · ` +
        `${evaluated ? `composite ${evaluated.compositeScore}, maturity ${evaluated.maturityLevel}` : "not evaluated"} · ` +
        `${result.stepsRun} steps, ${result.stepsFallenBack} fallback, ` +
        `$${result.totalCostUsd.toFixed(4)}, ${Date.now() - started}ms`,
    );
    return result;
  },
  {
    connection: connectionFrom(env.REDIS_URL),
    // Modest concurrency until the account's real rate limit is known (A4). Too high
    // just converts throughput into 429s.
    concurrency: 2,
  },
);

worker.on("failed", (job, error) => {
  console.error(`[analysis] job ${job?.id} failed:`, error.message);
});

const ranker = new Worker<RankingJob>(
  RANKING_QUEUE,
  async (job) => {
    const started = Date.now();
    const result = await recomputeRankings(db, {
      profileKey: job.data.profileKey,
      triggeredById: job.data.triggeredById ?? null,
      triggerReason: job.data.triggerReason,
    });
    console.log(
      result
        ? `[ranking] run ${result.runId} · ${result.cohortSize} ideas · ${Date.now() - started}ms`
        : "[ranking] nothing to rank yet — no evaluations for this profile",
    );
    return result;
  },
  // ADR-008: one at a time. Concurrent runs would snapshot the same evaluations twice.
  { connection: connectionFrom(env.REDIS_URL), concurrency: 1 },
);

ranker.on("failed", (job, error) => {
  console.error(`[ranking] job ${job?.id} failed:`, error.message);
});

console.log(
  `iep-worker listening on ${ANALYSIS_QUEUE} + ${RANKING_QUEUE} · provider=${provider.name} · ` +
    `budget=$${env.AI_BUDGET_PER_VERSION_USD}/version · redaction=${env.PII_REDACTION_ENABLED}`,
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void (async () => {
      await Promise.all([worker.close(), ranker.close(), rankingQueue.close()]);
      process.exit(0);
    })();
  });
}

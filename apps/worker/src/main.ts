import { Worker } from "bullmq";
import { getPrisma } from "@iep/db";
import { WorkerEnv, loadEnv } from "@iep/contracts/env";
import { AnthropicProvider, StubProvider, type AiProvider } from "@iep/ai";
import { ANALYSIS_QUEUE, connectionFrom, type AnalysisJob } from "./queue.js";
import { runPipeline } from "./pipeline.js";

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
    console.log(
      `[analysis] ${result.ideaVersionId} ${result.overall} · ` +
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

console.log(
  `iep-worker listening on ${ANALYSIS_QUEUE} · provider=${provider.name} · ` +
    `budget=$${env.AI_BUDGET_PER_VERSION_USD}/version · redaction=${env.PII_REDACTION_ENABLED}`,
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void (async () => {
      await worker.close();
      process.exit(0);
    })();
  });
}

import { Worker } from "bullmq";
import { getPrisma } from "@iep/db";
import { WorkerEnv, loadEnv } from "@iep/contracts/env";
import {
  AnthropicProvider, StubProvider, type AiProvider,
  AnthropicDiscoveryProvider, StubDiscoveryProvider, type DiscoveryChatProvider,
} from "@iep/ai";
import {
  ANALYSIS_QUEUE, RANKING_QUEUE, DISCOVERY_QUEUE, connectionFrom, makeRankingQueue,
  type AnalysisJob, type RankingJob, type DiscoveryJob,
} from "./queue.js";
import { runPipeline } from "./pipeline.js";
import { runDiscoveryQuery } from "./discovery.js";
import { backfillMissingEvaluations, evaluateVersion, recomputeRankings } from "@iep/evaluation";
import { grantRole } from "@iep/db";
import { makeObservabilityClient } from "./observability.js";

/**
 * apps/worker — the AI pipeline consumer (P3).
 *
 * This is the ONLY process that holds the Anthropic key (SPEC §4.4). The API refuses to
 * boot if it can see one.
 *
 * This one used to refuse to start at all without a key when AI_PROVIDER=anthropic — the
 * two guards pointing in opposite directions on purpose. In practice that made a single
 * missing secret take the whole analysis pipeline down permanently (the container
 * crash-loops, nothing ever consumes the queue, every submission sits at PENDING forever)
 * instead of leaving the idea rankable on the free stub, which is the same resilience
 * principle the per-step fallback in pipeline.ts already applies one level up. So this now
 * degrades loudly to the stub provider instead of refusing to boot — "loudly" meaning an
 * error-level log on every startup, since a silent stub substitution would be worse than
 * the crash it replaces.
 */

const env = loadEnv(WorkerEnv, process.env);
const db = getPrisma();

function makeProvider(): AiProvider {
  if (env.AI_PROVIDER === "stub") return new StubProvider();
  if (!env.ANTHROPIC_API_KEY) {
    console.error(
      "[worker] AI_PROVIDER=anthropic but no ANTHROPIC_API_KEY is set. Falling back to " +
        "the stub provider so analysis keeps running — set ANTHROPIC_API_KEY on the " +
        "WORKER service (never the API) to use the real model.",
    );
    return new StubProvider();
  }
  return new AnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY });
}

const provider = makeProvider();

/**
 * SPC-001 — same degrade-to-stub philosophy as `makeProvider()` above, and the same
 * reason: a missing key must never take a whole feature down permanently. This is a
 * separate, smaller provider pair (packages/ai/src/discovery.ts) — not a widening of
 * the frozen `AiProvider`/`AnalysisStep` contract.
 */
function makeDiscoveryProvider(): DiscoveryChatProvider {
  if (env.AI_PROVIDER === "stub") return new StubDiscoveryProvider();
  if (!env.ANTHROPIC_API_KEY) {
    console.error(
      "[worker] AI_PROVIDER=anthropic but no ANTHROPIC_API_KEY is set. Discovery Agent " +
        "falling back to its stub provider.",
    );
    return new StubDiscoveryProvider();
  }
  return new AnthropicDiscoveryProvider({ apiKey: env.ANTHROPIC_API_KEY });
}

const discoveryProvider = makeDiscoveryProvider();

/** iManner LLM observability (opt-in, see packages/contracts/src/env.ts's OBS_* fields). */
const observability = makeObservabilityClient(env);

/**
 * The worker enqueues its own ranking recomputes rather than running one inline.
 *
 * A recompute is cohort-wide, so six ideas analysed at once would otherwise trigger
 * six full runs. Through the queue at concurrency 1 they serialise, and the last one
 * is the one the board reads.
 */
const rankingQueue = makeRankingQueue(env.REDIS_URL);

/**
 * One-time-per-boot self-heal: an idea whose analysis finished before an
 * `EvaluationProfile` existed in this environment (see `seedEvaluationConfig`,
 * apps/worker/Dockerfile) got its status committed but its `evaluateVersion` call threw,
 * leaving it with no `Evaluation` row — invisible to Rankings forever, since nothing
 * re-queues an analysis job that already "succeeded". `evaluateVersion` only reads
 * already-persisted analysis data (no provider call), so backfilling it is cheap and
 * idempotent: an idea already evaluated is never a candidate on a later boot.
 */
backfillMissingEvaluations(db)
  .then((fixed) => {
    if (fixed === 0) return null;
    console.log(`[backfill] evaluated ${fixed} idea(s) that were missing an Evaluation row`);
    return rankingQueue.add("recompute", {
      triggerReason: `evaluation backfill on worker startup (${fixed} idea(s))`,
    });
  })
  .catch((error: unknown) => {
    console.error(
      "[backfill] could not backfill missing evaluations:",
      error instanceof Error ? error.message : error,
    );
  });

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
        observability,
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

const discoveryWorker = new Worker<DiscoveryJob>(
  DISCOVERY_QUEUE,
  async (job) => {
    const started = Date.now();
    await runDiscoveryQuery(
      { db, provider: discoveryProvider, redactionEnabled: env.PII_REDACTION_ENABLED, observability },
      job.data,
    );
    console.log(`[discovery] ${job.data.discoveryQueryId} done in ${Date.now() - started}ms`);
  },
  { connection: connectionFrom(env.REDIS_URL), concurrency: 2 },
);

discoveryWorker.on("failed", (job, error) => {
  console.error(`[discovery] job ${job?.id} failed:`, error.message);
});

console.log(
  `iep-worker listening on ${ANALYSIS_QUEUE} + ${RANKING_QUEUE} + ${DISCOVERY_QUEUE} · ` +
    `provider=${provider.name} · discoveryProvider=${discoveryProvider.name} · ` +
    `budget=$${env.AI_BUDGET_PER_VERSION_USD}/version · redaction=${env.PII_REDACTION_ENABLED} · ` +
    `iManner observability=${env.OBS_ENABLED ? "enabled" : "disabled"}`,
);

/**
 * Optional one-time admin bootstrap (BOOTSTRAP_ADMIN_EMAIL). Exists for an environment
 * with no console/exec access to run `grant-role-cli.ts` by hand — setting this one env
 * var is otherwise the only remaining path to create a first admin. Idempotent (grantRole
 * no-ops once already granted), and failure here never blocks queue consumption: an
 * unknown email or a transient DB error is logged, not thrown, since this account is not
 * on the critical path the rest of the worker exists for.
 */
if (env.BOOTSTRAP_ADMIN_EMAIL) {
  grantRole(db, env.BOOTSTRAP_ADMIN_EMAIL, "ADMIN")
    .then((outcome) => {
      console.log(
        outcome.granted
          ? `[bootstrap] granted ADMIN to ${env.BOOTSTRAP_ADMIN_EMAIL}. Roles now: ${outcome.roles.join(", ")}`
          : `[bootstrap] ${env.BOOTSTRAP_ADMIN_EMAIL} already has ADMIN — nothing to do`,
      );
    })
    .catch((error: unknown) => {
      console.error(
        `[bootstrap] could not grant ADMIN to ${env.BOOTSTRAP_ADMIN_EMAIL}:`,
        error instanceof Error ? error.message : error,
      );
    });
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void (async () => {
      await Promise.all([
        worker.close(), ranker.close(), discoveryWorker.close(), rankingQueue.close(),
      ]);
      process.exit(0);
    })();
  });
}

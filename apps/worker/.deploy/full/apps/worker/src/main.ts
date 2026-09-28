import { Worker } from "bullmq";
import { disconnectPrisma, getPrisma } from "@iep/db";
import { WorkerEnv, loadEnv } from "@iep/contracts/env";
import {
  AnthropicProvider, StubProvider, type AiProvider,
  AnthropicDiscoveryProvider, StubDiscoveryProvider, type DiscoveryChatProvider,
  AnthropicIdeaCreationProvider, StubIdeaCreationProvider, type IdeaCreationProvider,
  OpenAiEmbeddingProvider, StubEmbeddingProvider, type EmbeddingProvider,
  AnthropicDetectionProvider, StubDetectionProvider, type DetectionProvider,
} from "@iep/ai";
import {
  ANALYSIS_QUEUE, RANKING_QUEUE, DISCOVERY_QUEUE, IDEA_CREATION_QUEUE, connectionFrom,
  makeRankingQueue,
  type AnalysisJob, type RankingJob, type DiscoveryJob, type IdeaCreationJob,
} from "./queue.js";
import { runPipeline } from "./pipeline.js";
import { runDiscoveryQuery } from "./discovery.js";
import { runIdeaCreationTurn } from "./idea-creation.js";
import {
  backfillMissingEvaluations, evaluateVersion, recomputeRankings, runDetection,
} from "@iep/evaluation";
import { grantRole } from "@iep/db";
import { makeObservabilityClient } from "./observability.js";
import { captureException, initErrorTracking } from "./error-tracking.js";
import { makeEmailTransport, startEmailOutbox } from "./email.js";

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
initErrorTracking(env); // ADR-025 — before anything below can throw
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

/** Same degrade-to-stub philosophy as the two providers above. */
function makeIdeaCreationProvider(): IdeaCreationProvider {
  if (env.AI_PROVIDER === "stub") return new StubIdeaCreationProvider();
  if (!env.ANTHROPIC_API_KEY) {
    console.error(
      "[worker] AI_PROVIDER=anthropic but no ANTHROPIC_API_KEY is set. Idea Creation " +
        "Agent falling back to its stub provider.",
    );
    return new StubIdeaCreationProvider();
  }
  return new AnthropicIdeaCreationProvider({ apiKey: env.ANTHROPIC_API_KEY });
}

const ideaCreationProvider = makeIdeaCreationProvider();

/**
 * P12 (AI-10/AI-11) — same degrade-to-stub philosophy as every provider above. Anthropic
 * has no embeddings endpoint (packages/ai/src/embeddings.ts), so this is a genuinely
 * different vendor key, independently optional: a missing OPENAI_API_KEY means detection
 * runs on its non-AI fallback (trigram search / catalogue-only lookup, SPEC §12.3), not
 * that the worker won't start.
 */
function makeEmbeddingProvider(): EmbeddingProvider {
  if (env.EMBEDDING_PROVIDER === "stub") return new StubEmbeddingProvider();
  if (!env.OPENAI_API_KEY) {
    console.error(
      "[worker] EMBEDDING_PROVIDER=openai but no OPENAI_API_KEY is set. P12 detection " +
        "falling back to trigram/catalogue-only matching — set OPENAI_API_KEY to enable it.",
    );
    return new StubEmbeddingProvider();
  }
  return new OpenAiEmbeddingProvider({ apiKey: env.OPENAI_API_KEY });
}

const embeddingProvider = makeEmbeddingProvider();

/** Reuses the worker's own ANTHROPIC_API_KEY — same account, same degrade-to-stub rule. */
function makeDetectionProvider(): DetectionProvider {
  if (env.AI_PROVIDER === "stub") return new StubDetectionProvider();
  if (!env.ANTHROPIC_API_KEY) return new StubDetectionProvider();
  return new AnthropicDetectionProvider({ apiKey: env.ANTHROPIC_API_KEY });
}

const detectionProvider = makeDetectionProvider();

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

/** P13 — notification emails, drained from the outbox the API and pipeline write to. */
const emailTransport = makeEmailTransport(env);
const stopEmailOutbox = startEmailOutbox(db, emailTransport, env.PUBLIC_WEB_ORIGIN);

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
    captureException(error, { kind: "startup-backfill" });
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
        stepConcurrency: env.AI_STEP_CONCURRENCY,
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

    /**
     * P12 (FR-20/FR-21) — same "part of finishing an analysis, not a separate user
     * action" reasoning as `evaluateVersion` above. Best-effort: a detection failure
     * must never fail the analysis job itself (an idea with no similar-idea/existing-
     * solution data is still fully rankable — those are enrichment, not a gate).
     */
    let detected: { similarIdeaCount: number; existingSolutionMatchCount: number; embeddingSource: "openai" | "stub" | "fallback" } =
      { similarIdeaCount: 0, existingSolutionMatchCount: 0, embeddingSource: "fallback" };
    try {
      detected = await runDetection(
        { db, embeddingProvider, detectionProvider },
        { ideaId: job.data.ideaId, ideaVersionId: job.data.ideaVersionId },
      );
    } catch (error) {
      console.error(`[detection] idea ${job.data.ideaId} failed:`, error instanceof Error ? error.message : error);
      captureException(error, { kind: "detection", ideaId: job.data.ideaId });
    }

    console.log(
      `[analysis] ${result.ideaVersionId} ${result.overall} · ` +
        `${evaluated ? `composite ${evaluated.compositeScore}, maturity ${evaluated.maturityLevel}` : "not evaluated"} · ` +
        `${result.stepsRun} steps, ${result.stepsFallenBack} fallback, ` +
        `$${result.totalCostUsd.toFixed(4)}, ${Date.now() - started}ms · ` +
        `detection(${detected.embeddingSource}): ${detected.similarIdeaCount} similar, ` +
        `${detected.existingSolutionMatchCount} catalogue match(es)`,
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
  captureException(error, { queue: "analysis", jobId: job?.id ?? "unknown" });
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
  captureException(error, { queue: "ranking", jobId: job?.id ?? "unknown" });
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
  // Same "modest until the real rate limit is known" reasoning as the analysis worker
  // above (A4) — both hold jobs against the same Anthropic account, so the same ceiling
  // applies here, not a value picked independently.
  { connection: connectionFrom(env.REDIS_URL), concurrency: 2 },
);

discoveryWorker.on("failed", (job, error) => {
  console.error(`[discovery] job ${job?.id} failed:`, error.message);
  captureException(error, { queue: "discovery", jobId: job?.id ?? "unknown" });
});

const ideaCreationWorker = new Worker<IdeaCreationJob>(
  IDEA_CREATION_QUEUE,
  async (job) => {
    const started = Date.now();
    await runIdeaCreationTurn(
      {
        db, provider: ideaCreationProvider, redactionEnabled: env.PII_REDACTION_ENABLED,
        observability,
      },
      job.data,
    );
    console.log(`[idea-creation] ${job.data.conversationId} turn done in ${Date.now() - started}ms`);
  },
  // Same "modest until the real rate limit is known" reasoning as the other two
  // provider-calling workers (A4) — all three hold jobs against the same Anthropic account.
  { connection: connectionFrom(env.REDIS_URL), concurrency: 2 },
);

ideaCreationWorker.on("failed", (job, error) => {
  console.error(`[idea-creation] job ${job?.id} failed:`, error.message);
  captureException(error, { queue: "idea-creation", jobId: job?.id ?? "unknown" });
  // The queue is `attempts: 1` (a failed turn is cheap to retry by resending the
  // message), but nothing else ever moves the conversation off `AWAITING_AI` if the job
  // itself throws — an unhandled DB error, a deleted row, anything `runIdeaCreationTurn`
  // doesn't catch internally. Without this, `sendIdeaCreationMessage` refuses every
  // further message (`routes.ts`'s AWAITING_AI guard) and the conversation is stuck with
  // no way for the person to recover it.
  const conversationId = job?.data.conversationId;
  if (conversationId) {
    db.ideaCreationConversation
      .updateMany({
        where: { id: conversationId, status: "AWAITING_AI" },
        data: { status: "ACTIVE", errorCode: "TURN_FAILED" },
      })
      .catch((resetError: unknown) => {
        console.error(`[idea-creation] could not reset ${conversationId} after a failed turn:`, resetError);
      });
  }
});

console.log(
  `iep-worker listening on ${ANALYSIS_QUEUE} + ${RANKING_QUEUE} + ${DISCOVERY_QUEUE} + ` +
    `${IDEA_CREATION_QUEUE} · provider=${provider.name} · ` +
    `discoveryProvider=${discoveryProvider.name} · ideaCreationProvider=${ideaCreationProvider.name} · ` +
    `embeddingProvider=${embeddingProvider.name} · detectionProvider=${detectionProvider.name} · ` +
    `email=${emailTransport.name} · ` +
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
      captureException(error, { kind: "startup-admin-bootstrap" });
    });
}

// Guards against a second SIGINT/SIGTERM re-entering the shutdown sequence.
let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    stopEmailOutbox();
    void (async () => {
      try {
        const [analysisClient, rankerClient, discoveryClient, ideaCreationClient, rankingQueueClient] =
          await Promise.all([
            worker.client, ranker.client, discoveryWorker.client, ideaCreationWorker.client,
            rankingQueue.client,
          ]);
        await Promise.allSettled([
          worker.close(), ranker.close(), discoveryWorker.close(), ideaCreationWorker.close(),
          rankingQueue.close(),
        ]);
        // BullMQ treats a `connection` handed to it as external and does not close it on
        // `.close()` — five separate ioredis connections (one per worker, one for the
        // ranking self-enqueue queue) otherwise leak on every graceful shutdown.
        await Promise.allSettled(
          [analysisClient, rankerClient, discoveryClient, ideaCreationClient, rankingQueueClient]
            .map((client) => client.quit()),
        );
        await disconnectPrisma();
      } catch (error) {
        // Same reasoning as the API's shutdown handler: an unhandled rejection here used
        // to mean `process.exit(0)` below was never reached and the process hung until
        // SIGKILL — exactly the scenario (Redis already half-gone) shutdown hits most.
        console.error("error during shutdown — exiting anyway:", error);
      } finally {
        process.exit(0);
      }
    })();
  });
}

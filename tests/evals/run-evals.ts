import { AnthropicProvider, analyseStep, stepInputText } from "@iep/ai";
import type { FeasibilityOutput, RiskOutput, UseCaseOutput, ValueOutput } from "@iep/ai";
import { Band, PIPELINE_STEPS, type AnalysisStep } from "@iep/contracts";
import { GOLDEN_CASES, type GroundTruth, type StepExpectation } from "./cases.js";

/**
 * `pnpm eval` (SPEC §12.4) — nightly/manual, same reason the k6 load test is (SPEC §11.6):
 * this spends real money against the real provider, so it is not something every PR
 * should pay for, and its signal does not change from commit to commit the way a unit
 * test's does.
 *
 * Deliberately fails LOUD on a missing key rather than degrading — that is the opposite
 * of `apps/worker`'s own "missing key falls back to the stub provider" policy, and on
 * purpose: the whole point of this script is to exercise the real model, so silently
 * "passing" zero real checks would be a false green, worse than the empty folder this
 * replaces.
 *
 * No database, no queue, no worker process — `analyseStep` is the one function that
 * actually talks to the provider, so this calls it directly with the same inputs
 * `apps/worker/src/pipeline.ts` builds, and checks its own output. Nothing here is
 * persisted; a golden case is not a real submission.
 *
 * Two layers of checking, on purpose:
 *  1. Per-case keyword/structural checks (`GoldenCase.expect`, unchanged from the original
 *     starter harness) — pass/fail, gates the exit code, same as before.
 *  2. Aggregate model-dependent metrics against SPEC §12.4's own targets (use-case F1,
 *     value-band match, feasibility exact match, risk recall), computed across whatever
 *     cases in cases.ts carry a `groundTruth` block. These are REPORTED, not gating —
 *     SPEC §16.1 D-22 (owner decision) — accuracy is watched, not release-blocking.
 */

const BUDGET_PER_STEP_USD = 5; // comfortably above any single real step's cost

function loadApiKey(): string {
  const key = process.env["ANTHROPIC_API_KEY"];
  if (!key) {
    console.error(
      "ANTHROPIC_API_KEY is not set. This eval run talks to the real Anthropic API on " +
        "purpose (see this file's own header) — there is no stub-provider fallback here, " +
        "unlike the worker. Set it in apps/worker/.env, or export it for this shell, then " +
        "run again.",
    );
    process.exit(1);
  }
  return key;
}

interface StepResult {
  readonly step: AnalysisStep;
  readonly ok: boolean;
  readonly detail: string;
  readonly costUsd: number;
  readonly data: unknown;
}

function checkExpectation(data: unknown, expectation: StepExpectation): string | null {
  const haystack = JSON.stringify(data).toLowerCase();

  for (const phrase of expectation.mustMention ?? []) {
    if (!haystack.includes(phrase.toLowerCase())) {
      return `expected output to mention "${phrase}", it did not`;
    }
  }
  for (const phrase of expectation.mustNotMention ?? []) {
    if (haystack.includes(phrase.toLowerCase())) {
      return `expected output to NOT mention "${phrase}", it did`;
    }
  }
  if (expectation.check) {
    const failure = expectation.check(data);
    if (failure) return failure;
  }
  return null;
}

async function runCase(
  provider: AnthropicProvider,
  goldenCase: (typeof GOLDEN_CASES)[number],
): Promise<readonly StepResult[]> {
  const results: StepResult[] = [];

  for (const step of PIPELINE_STEPS) {
    const outcome = await analyseStep(provider, {
      step,
      ideaText: stepInputText(step, goldenCase.fields),
      fields: goldenCase.fields,
      redactionEnabled: true, // matches the worker's own default (PII_REDACTION_ENABLED)
      budgetRemainingUsd: BUDGET_PER_STEP_USD,
    });

    const costUsd = outcome.usage?.costUsd ?? 0;

    if (outcome.source !== "AI") {
      results.push({
        step,
        ok: false,
        detail: `fell back instead of calling the real model: ${outcome.failureReason ?? "unknown reason"}`,
        costUsd,
        data: undefined,
      });
      continue;
    }

    const expectation = goldenCase.expect[step];
    const failure = expectation ? checkExpectation(outcome.data, expectation) : null;
    results.push({
      step,
      ok: !failure,
      detail: failure ?? `ok (${outcome.model ?? "unknown model"})`,
      costUsd,
      data: outcome.data,
    });
  }

  return results;
}

/* ─────────────────────────── §12.4 aggregate metric scoring ─────────────────────────── */

/** Lowercased, punctuation-stripped, stopword-agnostic word set — the same crude, cheap
 *  keyword-overlap technique `mustMention` already uses, just bidirectional and scored
 *  instead of pass/fail. No embeddings, no judge model (see file header). */
function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
}

function overlapRatio(needle: Set<string>, haystack: Set<string>): number {
  if (needle.size === 0) return 0;
  let hits = 0;
  for (const w of needle) if (haystack.has(w)) hits += 1;
  return hits / needle.size;
}

const MATCH_THRESHOLD = 0.5;

interface UseCaseScore {
  readonly matchedExpected: number;
  readonly totalExpected: number;
  readonly matchedPredicted: number;
  readonly totalPredicted: number;
}

/** Crude many-to-many keyword matching, not the Hungarian-algorithm optimal assignment a
 *  real F1 harness would use — proportionate to a "minimal starter framework" (see header),
 *  same spirit as the rest of this file's checks. */
function scoreUseCases(expected: readonly string[], predicted: UseCaseOutput["useCases"]): UseCaseScore {
  const predictedWords = predicted.map((u) => words(`${u.title} ${u.description}`));

  let matchedExpected = 0;
  for (const phrase of expected) {
    const phraseWords = words(phrase);
    if (predictedWords.some((pw) => overlapRatio(phraseWords, pw) >= MATCH_THRESHOLD)) {
      matchedExpected += 1;
    }
  }

  const expectedWordSets = expected.map((phrase) => words(phrase));
  let matchedPredicted = 0;
  for (const pw of predictedWords) {
    if (expectedWordSets.some((phraseWords) => overlapRatio(phraseWords, pw) >= MATCH_THRESHOLD)) {
      matchedPredicted += 1;
    }
  }

  return {
    matchedExpected,
    totalExpected: expected.length,
    matchedPredicted,
    totalPredicted: predicted.length,
  };
}

const BAND_ORDER = Band.options; // NEGLIGIBLE..VERY_HIGH, ordinal index = distance unit

interface AggregateMetrics {
  useCaseTruePositivesForRecall: number;
  useCaseTotalExpected: number;
  useCaseTruePositivesForPrecision: number;
  useCaseTotalPredicted: number;
  valueBandExactMatches: number;
  valueBandWithinOne: number;
  valueBandTotalJudged: number;
  feasibilityExactMatches: number;
  feasibilityTotalJudged: number;
  riskRecallHits: number;
  riskRecallTotalExpected: number;
}

function emptyMetrics(): AggregateMetrics {
  return {
    useCaseTruePositivesForRecall: 0,
    useCaseTotalExpected: 0,
    useCaseTruePositivesForPrecision: 0,
    useCaseTotalPredicted: 0,
    valueBandExactMatches: 0,
    valueBandWithinOne: 0,
    valueBandTotalJudged: 0,
    feasibilityExactMatches: 0,
    feasibilityTotalJudged: 0,
    riskRecallHits: 0,
    riskRecallTotalExpected: 0,
  };
}

function accumulate(
  metrics: AggregateMetrics,
  groundTruth: GroundTruth,
  resultsByStep: ReadonlyMap<AnalysisStep, StepResult>,
): void {
  if (groundTruth.useCases) {
    const useCaseResult = resultsByStep.get("USE_CASES");
    if (useCaseResult?.ok && useCaseResult.data) {
      const { matchedExpected, totalExpected, matchedPredicted, totalPredicted } = scoreUseCases(
        groundTruth.useCases,
        (useCaseResult.data as UseCaseOutput).useCases,
      );
      metrics.useCaseTruePositivesForRecall += matchedExpected;
      metrics.useCaseTotalExpected += totalExpected;
      metrics.useCaseTruePositivesForPrecision += matchedPredicted;
      metrics.useCaseTotalPredicted += totalPredicted;
    }
  }

  if (groundTruth.valueBands) {
    const valueResult = resultsByStep.get("VALUE");
    if (valueResult?.ok && valueResult.data) {
      const findings = (valueResult.data as ValueOutput).findings;
      for (const [dimension, expectedBand] of Object.entries(groundTruth.valueBands)) {
        const finding = findings.find((f) => f.dimension === dimension);
        if (!finding || !expectedBand) continue;
        metrics.valueBandTotalJudged += 1;
        const distance = Math.abs(
          BAND_ORDER.indexOf(finding.band) - BAND_ORDER.indexOf(expectedBand),
        );
        if (distance === 0) metrics.valueBandExactMatches += 1;
        if (distance <= 1) metrics.valueBandWithinOne += 1;
      }
    }
  }

  if (groundTruth.feasibilityStatus) {
    const feasibilityResult = resultsByStep.get("FEASIBILITY");
    if (feasibilityResult?.ok && feasibilityResult.data) {
      metrics.feasibilityTotalJudged += 1;
      const actual = (feasibilityResult.data as FeasibilityOutput).status;
      if (actual === groundTruth.feasibilityStatus) metrics.feasibilityExactMatches += 1;
    }
  }

  if (groundTruth.riskCategories) {
    const riskResult = resultsByStep.get("RISK");
    if (riskResult?.ok && riskResult.data) {
      const actualCategories = new Set((riskResult.data as RiskOutput).risks.map((r) => r.category));
      metrics.riskRecallTotalExpected += groundTruth.riskCategories.length;
      for (const category of groundTruth.riskCategories) {
        if (actualCategories.has(category)) metrics.riskRecallHits += 1;
      }
    }
  }
}

function ratio(hits: number, total: number): string {
  return total === 0 ? "n/a (no judged cases)" : `${(hits / total).toFixed(2)} (${hits}/${total})`;
}

function printAggregateReport(metrics: AggregateMetrics, caseCountWithGroundTruth: number): void {
  const precision =
    metrics.useCaseTotalPredicted === 0
      ? 0
      : metrics.useCaseTruePositivesForPrecision / metrics.useCaseTotalPredicted;
  const recall =
    metrics.useCaseTotalExpected === 0
      ? 0
      : metrics.useCaseTruePositivesForRecall / metrics.useCaseTotalExpected;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  console.log("\n─── SPEC §12.4 model-dependent metrics (informational — see note below) ───\n");
  console.log(`Cases with any ground truth: ${caseCountWithGroundTruth} of ${GOLDEN_CASES.length}`);
  console.log(
    `Use-case extraction F1: ${metrics.useCaseTotalExpected === 0 ? "n/a" : f1.toFixed(2)} ` +
      `(target ≥0.80; precision ${(precision * 100).toFixed(0)}%, recall ${(recall * 100).toFixed(0)}%)`,
  );
  console.log(
    `Value-dimension band exact match: ${ratio(metrics.valueBandExactMatches, metrics.valueBandTotalJudged)} ` +
      `(target ≥0.70)`,
  );
  console.log(
    `Value-dimension band within-one:  ${ratio(metrics.valueBandWithinOne, metrics.valueBandTotalJudged)} ` +
      `(target ≥0.95)`,
  );
  console.log(
    `Feasibility status exact match:   ${ratio(metrics.feasibilityExactMatches, metrics.feasibilityTotalJudged)} ` +
      `(target ≥0.75)`,
  );
  console.log(
    `Risk recall:                      ${ratio(metrics.riskRecallHits, metrics.riskRecallTotalExpected)} ` +
      `(target ≥0.80)`,
  );
  console.log(
    "\nReported, NOT gating the exit code — by decision (SPEC §16.1 D-22): for an advisory AI\n" +
      "whose every output a reviewer sees and can override, these accuracy numbers are watched,\n" +
      `not release-blocking, and the ${GOLDEN_CASES.length} cases' labels may stay single-author.\n` +
      "Production accuracy signal: the P6 score-override rate. To make these gate again, fail\n" +
      "the process here when a metric is below its target.",
  );
}

async function main(): Promise<void> {
  const apiKey = loadApiKey();
  const provider = new AnthropicProvider({ apiKey });

  let totalCostUsd = 0;
  let failed = 0;
  const metrics = emptyMetrics();
  let caseCountWithGroundTruth = 0;

  for (const goldenCase of GOLDEN_CASES) {
    console.log(`\n[${goldenCase.category}] ${goldenCase.name}`);
    const results = await runCase(provider, goldenCase);
    const resultsByStep = new Map(results.map((r) => [r.step, r] as const));

    for (const result of results) {
      totalCostUsd += result.costUsd;
      if (!result.ok) failed += 1;
      console.log(`  ${result.ok ? "✓" : "✗"} ${result.step.padEnd(24)} ${result.detail}`);
    }

    if (goldenCase.groundTruth) {
      caseCountWithGroundTruth += 1;
      accumulate(metrics, goldenCase.groundTruth, resultsByStep);
    }
  }

  console.log(`\n$${totalCostUsd.toFixed(4)} spent across ${GOLDEN_CASES.length} case(s).`);
  printAggregateReport(metrics, caseCountWithGroundTruth);

  if (failed > 0) {
    console.error(`\n${failed} per-case check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll per-case checks passed.");
}

await main();

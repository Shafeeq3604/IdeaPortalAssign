import { AnthropicProvider, analyseStep, stepInputText } from "@iep/ai";
import { PIPELINE_STEPS, type AnalysisStep } from "@iep/contracts";
import { GOLDEN_CASES, type StepExpectation } from "./cases.js";

/**
 * `pnpm eval` (SPEC §12) — nightly/manual, same reason the k6 load test is (SPEC §11.6):
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
    });
  }

  return results;
}

async function main(): Promise<void> {
  const apiKey = loadApiKey();
  const provider = new AnthropicProvider({ apiKey });

  let totalCostUsd = 0;
  let failed = 0;

  for (const goldenCase of GOLDEN_CASES) {
    console.log(`\n${goldenCase.name}`);
    const results = await runCase(provider, goldenCase);
    for (const result of results) {
      totalCostUsd += result.costUsd;
      if (!result.ok) failed += 1;
      console.log(`  ${result.ok ? "✓" : "✗"} ${result.step.padEnd(15)} ${result.detail}`);
    }
  }

  console.log(`\n$${totalCostUsd.toFixed(4)} spent across ${GOLDEN_CASES.length} case(s).`);

  if (failed > 0) {
    console.error(`\n${failed} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll checks passed.");
}

await main();

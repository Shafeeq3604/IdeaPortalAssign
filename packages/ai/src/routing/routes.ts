import type { AnalysisStep, ModelTier, ThinkingMode } from "@iep/contracts";

/**
 * Model routing SEED (ADR-020, ADR-021 · SPEC §12.1.1–2).
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  This file and packages/ai/src/routing are the ONLY places a model id may
 *  appear. tests/arch/no-model-literals.test.ts greps the repo for /claude-/
 *  and fails the build on a hit anywhere else. "Configurable" that is not
 *  tested is a comment.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * These values SEED the `ai_model_routes` table. At runtime the router reads the
 * table, not this file — so changing a model is a config edit and an audited event,
 * never a deploy.
 *
 * Tier boundary rule (SPEC §12.1.1):
 *   If getting it wrong would change how an idea is TREATED, it is Tier A.
 *   Extraction errors are visible and correctable; judgement errors are not.
 */

export const TIER_MODELS: Record<ModelTier, string> = {
  A: "claude-opus-5",   // reasoning:  judgement under ambiguity
  B: "claude-sonnet-5", // extraction: structured pull-out from given text
  C: "claude-haiku-4-5", // routine:   classify, format, summarise
};

/** $ per million tokens. Used for budget enforcement and cost telemetry. */
export const TIER_RATES: Record<ModelTier, { in: number; out: number }> = {
  A: { in: 5, out: 25 },
  B: { in: 2, out: 10 },
  C: { in: 1, out: 5 },
};

export interface ModelRoute {
  readonly storyKey: AnalysisStep;
  readonly tier: ModelTier;
  readonly modelId: string;
  /**
   * Request shape differs by model family (SPEC §12.1.2 consequence 1):
   *   Opus 5 / Sonnet 5 → thinking {type:"adaptive"} + output_config.effort;
   *                       budget_tokens and sampling params are REJECTED.
   *   Haiku 4.5         → thinking {type:"enabled", budget_tokens:N};
   *                       `effort` ERRORS.
   * Callers pass intent (storyKey). The router emits the correct parameters.
   * A caller that passes a model id is a bug.
   */
  readonly effort: "low" | "medium" | "high" | "xhigh" | "max" | null;
  readonly thinkingMode: ThinkingMode;
  readonly thinkingBudgetTokens: number | null;
  readonly maxTokens: number;
  readonly enabled: boolean;
}

export const DEFAULT_ROUTES: readonly ModelRoute[] = [
  // ── Tier B — extraction ──
  { storyKey: "STRUCTURE",       tier: "B", modelId: TIER_MODELS.B, effort: "medium", thinkingMode: "ADAPTIVE", thinkingBudgetTokens: null, maxTokens: 8_000,  enabled: true },
  { storyKey: "USE_CASES",       tier: "B", modelId: TIER_MODELS.B, effort: "medium", thinkingMode: "ADAPTIVE", thinkingBudgetTokens: null, maxTokens: 8_000,  enabled: true },
  { storyKey: "EFFORT_TIMELINE", tier: "B", modelId: TIER_MODELS.B, effort: "medium", thinkingMode: "ADAPTIVE", thinkingBudgetTokens: null, maxTokens: 12_000, enabled: true },
  { storyKey: "EXPLANATION",     tier: "B", modelId: TIER_MODELS.B, effort: "low",    thinkingMode: "ADAPTIVE", thinkingBudgetTokens: null, maxTokens: 6_000,  enabled: true },

  // ── Tier A — judgement. A wrong answer here changes how an idea is treated. ──
  { storyKey: "VALUE",       tier: "A", modelId: TIER_MODELS.A, effort: "high", thinkingMode: "ADAPTIVE", thinkingBudgetTokens: null, maxTokens: 10_000, enabled: true },
  { storyKey: "FEASIBILITY", tier: "A", modelId: TIER_MODELS.A, effort: "high", thinkingMode: "ADAPTIVE", thinkingBudgetTokens: null, maxTokens: 12_000, enabled: true },
  { storyKey: "RISK",        tier: "A", modelId: TIER_MODELS.A, effort: "high", thinkingMode: "ADAPTIVE", thinkingBudgetTokens: null, maxTokens: 12_000, enabled: true },
  { storyKey: "IMPROVEMENT", tier: "A", modelId: TIER_MODELS.A, effort: "high", thinkingMode: "ADAPTIVE", thinkingBudgetTokens: null, maxTokens: 12_000, enabled: true },
];

/** One tier up, for the escalate-on-validation-failure path (SPEC §12.1.2). */
export const TIER_ABOVE: Record<ModelTier, ModelTier | null> = { C: "B", B: "A", A: null };

/**
 * Per-model request normalisation. The single place API-shape differences live.
 * Returning a plain object (not an SDK type) keeps this package free of provider imports.
 */
export interface NormalisedRequestParams {
  readonly model: string;
  readonly max_tokens: number;
  readonly thinking?: { type: "adaptive" } | { type: "enabled"; budget_tokens: number };
  readonly output_config?: { effort: string };
}

export function normaliseRequestParams(route: ModelRoute): NormalisedRequestParams {
  // Haiku 4.5 and older: budgeted thinking, and `effort` is rejected outright.
  if (route.thinkingMode === "BUDGETED") {
    return {
      model: route.modelId,
      max_tokens: route.maxTokens,
      thinking: { type: "enabled", budget_tokens: route.thinkingBudgetTokens ?? 2_000 },
    };
  }
  if (route.thinkingMode === "NONE") {
    return { model: route.modelId, max_tokens: route.maxTokens };
  }
  // Opus 5 / Sonnet 5: adaptive thinking + effort; budget_tokens would 400.
  return {
    model: route.modelId,
    max_tokens: route.maxTokens,
    thinking: { type: "adaptive" },
    ...(route.effort ? { output_config: { effort: route.effort } } : {}),
  };
}

export function estimateCostUsd(
  tier: ModelTier,
  inputTokens: number,
  outputTokens: number,
): number {
  const rate = TIER_RATES[tier];
  return (inputTokens / 1_000_000) * rate.in + (outputTokens / 1_000_000) * rate.out;
}

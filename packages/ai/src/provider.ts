import type { AnalysisStep, ModelTier } from "@iep/contracts";
import type { ModelRoute } from "./routing/routes.js";

/**
 * Provider abstraction (ADR-011). Signatures FROZEN AT P0; implementations are P3.
 *
 * Two implementations ship: AnthropicProvider and StubProvider. Every unit,
 * integration, BDD and E2E test uses the stub — no test spends a token (SKILL.md §2.2).
 */

export interface AiRequest {
  readonly storyKey: AnalysisStep;
  /** System prompt + JSON Schema. FROZEN per prompt version — carries the cache breakpoint. */
  readonly systemPrompt: string;
  readonly promptVersion: string;
  /**
   * Employee-authored text. Delimited and declared UNTRUSTED DATA by the caller
   * (SPEC §4.6). Operator instructions never travel in this field.
   */
  readonly untrustedIdeaText: string;
  /** Engine-derived context (e.g. the contribution vector for AI-08). Trusted. */
  readonly trustedContext?: Readonly<Record<string, unknown>> | undefined;
  /** JSON Schema for output_config.format. Strict; no numeric score fields (ADR-005). */
  readonly outputSchema: Readonly<Record<string, unknown>>;
  readonly route: ModelRoute;
}

export interface AiUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens: number;
  readonly costUsd: number;
}

export type AiResult<T> =
  | { readonly ok: true; readonly data: T; readonly usage: AiUsage; readonly model: string; readonly tier: ModelTier }
  | { readonly ok: false; readonly reason: AiFailure; readonly usage?: AiUsage | undefined };

export type AiFailure =
  /** stop_reason === "refusal" — checked before reading content on every call. */
  | { readonly kind: "REFUSAL"; readonly category: string | null }
  | { readonly kind: "SCHEMA_INVALID"; readonly issues: readonly string[] }
  | { readonly kind: "SEMANTIC_INVALID"; readonly issues: readonly string[] }
  | { readonly kind: "BUDGET_EXCEEDED"; readonly scope: "VERSION" | "USER" | "ORG" }
  | { readonly kind: "RATE_LIMITED"; readonly retryAfterMs: number | null }
  | { readonly kind: "UNAVAILABLE"; readonly status: number | null }
  | { readonly kind: "TIMEOUT" };

export interface AiProvider {
  readonly name: "anthropic" | "stub";
  complete<T>(request: AiRequest): Promise<AiResult<T>>;
}

/**
 * Every story must have a fallback that produces a rankable idea WITHOUT the model.
 * Built first, per SKILL.md §2.2 — if it does not exist, the feature is not shippable.
 */
export interface FallbackProducer<T> {
  readonly storyKey: AnalysisStep;
  produce(input: { readonly untrustedIdeaText: string; readonly fields: Readonly<Record<string, unknown>> }): T;
}

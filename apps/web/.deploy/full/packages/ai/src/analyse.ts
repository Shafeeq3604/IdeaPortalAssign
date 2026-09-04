import { toProviderSchema } from "./provider-schema.js";
import { clampToSchema } from "./clamp.js";
import type { AnalysisStep, ModelTier } from "@iep/contracts";
import { AI_OUTPUT_SCHEMAS } from "./schemas/analysis.js";
import { DEFAULT_ROUTES, TIER_ABOVE, TIER_MODELS, type ModelRoute } from "./routing/routes.js";
import { systemPromptFor, PROMPT_VERSION } from "./prompts.js";
import { parseAndValidate, type ValidationIssue } from "./validate.js";
import { redact } from "./redaction.js";
import { FALLBACKS } from "./fallbacks.js";
import type { AiProvider, AiUsage } from "./provider.js";

/**
 * One analysis step, end to end (SPEC §12).
 *
 * The order here IS the policy:
 *   redact → call → schema+semantic validate → retry one tier up → fallback
 *
 * Nothing reaches the database that has not passed both validators, and nothing fails
 * closed to an empty analysis: the fallback always produces a rankable result.
 */

export interface AnalyseInput {
  readonly step: AnalysisStep;
  readonly ideaText: string;
  readonly fields: Readonly<Record<string, string | null>>;
  readonly trustedContext?: Readonly<Record<string, unknown>> | undefined;
  readonly redactionEnabled: boolean;
  /** Remaining budget for this idea version, in USD. Zero or less refuses the call. */
  readonly budgetRemainingUsd: number;
  readonly routes?: readonly ModelRoute[] | undefined;
}

export interface AnalyseOutcome {
  readonly step: AnalysisStep;
  readonly data: unknown;
  readonly source: "AI" | "FALLBACK";
  readonly model: string | null;
  readonly tier: ModelTier | null;
  readonly escalatedFromTier: ModelTier | null;
  readonly promptVersion: string;
  readonly redactionApplied: boolean;
  readonly usage: AiUsage | null;
  /** Why the fallback was used, when it was. Persisted so an outage is visible later. */
  readonly failureReason: string | null;
  readonly validationIssues: readonly ValidationIssue[];
}

const routeFor = (step: AnalysisStep, routes: readonly ModelRoute[]): ModelRoute | undefined =>
  routes.find((r) => r.storyKey === step && r.enabled);

/** Steps whose evidence must trace back to the submission. */
const GROUND_EVIDENCE: ReadonlySet<AnalysisStep> = new Set([
  "USE_CASES", "VALUE", "FEASIBILITY", "RISK",
]);

export async function analyseStep(
  provider: AiProvider,
  input: AnalyseInput,
): Promise<AnalyseOutcome> {
  const routes = input.routes ?? DEFAULT_ROUTES;
  const schema = AI_OUTPUT_SCHEMAS[input.step];
  const fallbackFn = FALLBACKS[input.step as keyof typeof FALLBACKS];

  const fallback = (reason: string, issues: readonly ValidationIssue[] = []): AnalyseOutcome => ({
    step: input.step,
    data: fallbackFn ? fallbackFn({ fields: input.fields }) : {},
    source: "FALLBACK",
    model: null,
    tier: null,
    escalatedFromTier: null,
    promptVersion: PROMPT_VERSION,
    redactionApplied: false,
    usage: null,
    failureReason: reason,
    validationIssues: issues,
  });

  const route = routeFor(input.step, routes);
  if (!route) return fallback("no enabled route configured for this step");

  // Budget is checked BEFORE the call and fails closed. An exceeded cap must degrade to
  // the fallback, never silently drop the analysis (SPEC §12.1).
  if (input.budgetRemainingUsd <= 0) return fallback("per-version AI budget exhausted");

  const { text: redactedText, applied: redactionApplied } = redact(
    input.ideaText,
    input.redactionEnabled,
  );

  const outputSchema = toProviderSchema(schema);
  const systemPrompt = systemPromptFor(input.step);

  /** One attempt at a given tier. */
  const attempt = async (
    activeRoute: ModelRoute,
  ): Promise<
    | { kind: "ok"; data: unknown; usage: AiUsage; model: string; tier: ModelTier }
    | { kind: "invalid"; issues: readonly ValidationIssue[] }
    | { kind: "failed"; reason: string }
  > => {
    const result = await provider.complete<unknown>({
      storyKey: input.step,
      systemPrompt,
      promptVersion: PROMPT_VERSION,
      untrustedIdeaText: redactedText,
      trustedContext: input.trustedContext,
      outputSchema,
      route: activeRoute,
    });

    if (!result.ok) {
      const r = result.reason;
      return {
        kind: "failed",
        reason:
          r.kind === "REFUSAL" ? `provider refused (${r.category ?? "uncategorised"})`
          : r.kind === "RATE_LIMITED" ? "provider rate limited"
          : r.kind === "TIMEOUT" ? "provider timed out"
          : r.kind === "UNAVAILABLE" ? `provider unavailable (${r.status ?? "no status"})`
          : r.kind === "BUDGET_EXCEEDED" ? `budget exceeded (${r.scope})`
          : `output rejected: ${r.issues.join("; ")}`,
      };
    }

    // Clamp cosmetic length bounds first: the provider schema cannot carry them, so
    // the model never saw them, and rejecting a good analysis over 20 extra characters
    // helps nobody. Meaningful constraints are still enforced by the parse below.
    const clamped = clampToSchema(schema, result.data);

    const validated = parseAndValidate(schema, clamped, {
      sourceText: input.ideaText,
      groundEvidence: GROUND_EVIDENCE.has(input.step),
    });
    if (!validated.ok) return { kind: "invalid", issues: validated.issues };

    return {
      kind: "ok",
      data: validated.data,
      usage: result.usage,
      model: result.model,
      tier: result.tier,
    };
  };

  const first = await attempt(route);

  if (first.kind === "ok") {
    return {
      step: input.step, data: first.data, source: "AI",
      model: first.model, tier: first.tier, escalatedFromTier: null,
      promptVersion: PROMPT_VERSION, redactionApplied,
      usage: first.usage, failureReason: null, validationIssues: [],
    };
  }

  /**
   * Escalate ONE tier on a validation failure — cheap path first, quality floor intact
   * (SPEC §12.1.2). A transport failure is not escalated: a bigger model does not fix a
   * dead connection, and retrying it just doubles the wait before the fallback.
   */
  const higher = TIER_ABOVE[route.tier];
  if (first.kind === "invalid" && higher) {
    const escalated: ModelRoute = {
      ...route,
      tier: higher,
      modelId: TIER_MODELS[higher],
      // A higher tier means a different family; the router normalises the request shape.
      effort: higher === "C" ? null : "high",
      thinkingMode: higher === "C" ? "BUDGETED" : "ADAPTIVE",
    };

    const second = await attempt(escalated);
    if (second.kind === "ok") {
      return {
        step: input.step, data: second.data, source: "AI",
        model: second.model, tier: second.tier, escalatedFromTier: route.tier,
        promptVersion: PROMPT_VERSION, redactionApplied,
        usage: second.usage, failureReason: null,
        validationIssues: first.issues,
      };
    }
    // Name the actual issues. "Validation failed" alone gives a debugger nothing, and
    // this string is what lands in ai_analyses.error_code for later inspection.
    return fallback(
      `validation failed at tier ${route.tier} and again at ${higher}: ` +
        `${first.issues.map((i) => i.detail).join("; ").slice(0, 400)}`,
      first.issues,
    );
  }

  return fallback(
    first.kind === "invalid"
      ? `output failed validation: ${first.issues.map((i) => i.detail).join("; ").slice(0, 400)}`
      : first.reason,
    first.kind === "invalid" ? first.issues : [],
  );
}

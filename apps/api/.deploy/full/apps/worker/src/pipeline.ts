import type { Prisma, PrismaClient } from "@iep/db";

/** Every delegate `persistStep` calls exists on both, so it can run inside a transaction. */
type Db = PrismaClient | Prisma.TransactionClient;
import { PIPELINE_STEPS, type AnalysisStep } from "@iep/contracts";
import {
  analyseStep, stepInputHash, stepInputText, systemPromptFor,
  type AiProvider, type ModelRoute,
  type StructureOutput, type UseCaseOutput, type ValueOutput, type MarketOutput,
  type FeasibilityOutput, type RiskOutput, type EffortTimelineOutput, type RecommendationOutput,
} from "@iep/ai";
import type { ObservabilityClient } from "./observability.js";

/** Display name per step, for the iManner agent list — mirrors PIPELINE_STEPS' own order. */
const STEP_AGENT_NAMES: Record<AnalysisStep, string> = {
  STRUCTURE: "Idea Structuring",
  USE_CASES: "Use Case Generation",
  VALUE: "Value Assessment",
  MARKET_CONTEXT: "Market & Competitive Assessment",
  FEASIBILITY: "Feasibility Assessment",
  RISK: "Risk Assessment",
  EFFORT_TIMELINE: "Effort & Timeline Estimation",
  // ADR-026 — synthesizes the five findings above into a formal, advisory recommendation.
  IMPLEMENTATION_RECOMMENDATION: "Implementation Recommendation",
  // Not a member of PIPELINE_STEPS (the Improvement feature was removed — CONTRACT-LOG
  // 2026-08-28) but `AnalysisStep` itself still carries it, so `Record<AnalysisStep, _>`
  // requires an entry. Unreachable in this file's loop, which only ever iterates
  // PIPELINE_STEPS.
  EXPLANATION: "Explanation",
};

/**
 * `analyseStep`'s two fallback reasons that never reach the provider at all (no enabled
 * route, or the per-version budget already exhausted) — see packages/ai/src/analyse.ts.
 * Every other fallback reason means a real request was sent and failed, which IS a
 * reportable LLM call for iManner.
 */
const NO_CALL_REASONS = new Set([
  "no enabled route configured for this step",
  "per-version AI budget exhausted",
]);

/**
 * The seven-step analysis pipeline (SPEC §3.3; amended §14.1 to add MARKET_CONTEXT —
 * CONTRACT-LOG.md 2026-09-21).
 *
 * Ordered, idempotent, and resilient by design:
 *
 *  - **Idempotent by content hash.** Re-running an unchanged version costs zero tokens;
 *    a step that already succeeded for this hash is skipped.
 *  - **Partial failure is normal.** A failed step falls back and the run continues. The
 *    idea stays rankable, which is the acceptance criterion (SPEC §9.3).
 *  - **Budget is tracked across the run**, not per call, so seven cheap steps cannot add
 *    up past the per-version cap.
 */

export interface PipelineDeps {
  readonly db: PrismaClient;
  readonly provider: AiProvider;
  readonly budgetPerVersionUsd: number;
  readonly redactionEnabled: boolean;
  readonly observability: ObservabilityClient;
}

export interface PipelineResult {
  readonly ideaVersionId: string;
  readonly overall: "SUCCEEDED" | "PARTIAL" | "FAILED";
  readonly stepsRun: number;
  /** Steps whose inputs were unchanged and were copied from the previous version. */
  readonly stepsCarriedForward: number;
  readonly stepsFallenBack: number;
  readonly totalCostUsd: number;
}

/** Load the routing table from the database — model choice is config (ADR-021). */
async function loadRoutes(db: PrismaClient): Promise<readonly ModelRoute[]> {
  const rows = await db.aiModelRoute.findMany({ where: { enabled: true } });
  return rows.map((r) => ({
    storyKey: r.storyKey as AnalysisStep,
    tier: r.tier,
    modelId: r.modelId,
    effort: (r.effort ?? null) as ModelRoute["effort"],
    thinkingMode: r.thinkingMode,
    thinkingBudgetTokens: r.thinkingBudgetTokens,
    maxTokens: r.maxTokens,
    enabled: r.enabled,
  }));
}

/**
 * One version's fields, in the shape the step-input helpers expect.
 *
 * Replaces the single whole-submission text block this file used to build. Each step now
 * receives exactly the fields it declares in `STEP_INPUT_FIELDS`, which is what lets an
 * unchanged step be skipped on a revision without guessing (FR-16).
 */
function fieldsOf(version: {
  title: string; description: string; problemStatement: string; expectedUsers: string;
  expectedOutcome: string; existingProcess: string | null; existingSolutions: string | null;
  suggestedTechnology: string | null; expectedBenefits: string | null;
  estimatedCostNote: string | null; references: string | null; useCases: readonly string[];
}): Record<string, string | null> {
  return {
    title: version.title,
    description: version.description,
    problemStatement: version.problemStatement,
    expectedUsers: version.expectedUsers,
    expectedOutcome: version.expectedOutcome,
    existingProcess: version.existingProcess,
    existingSolutions: version.existingSolutions,
    suggestedTechnology: version.suggestedTechnology,
    expectedBenefits: version.expectedBenefits,
    estimatedCostNote: version.estimatedCostNote,
    references: version.references,
    // Joined into one field like every other input here — `stepInputText`/`stepInputHash`
    // work over `Record<string, string | null>`, not arbitrary shapes. The submitter's
    // OWN stated use cases (distinct from the AI's own USE_CASES step output).
    useCases: version.useCases.length > 0 ? version.useCases.map((u) => `- ${u}`).join("\n") : null,
  };
}

/**
 * ADR-026 — the prior findings IMPLEMENTATION_RECOMMENDATION synthesizes, read back from
 * what this same run already persisted (VALUE/MARKET_CONTEXT/FEASIBILITY/RISK/
 * EFFORT_TIMELINE all run earlier — `PIPELINE_STEPS` places this step last). Shaped
 * plainly, not as the full contract response: this is what goes INTO the model, not what
 * a client reads back.
 */
async function loadRecommendationContext(
  db: PrismaClient,
  ideaVersionId: string,
): Promise<Record<string, unknown>> {
  const [valueFindings, marketFindings, feasibility, risks, dependencies, plan] =
    await Promise.all([
      db.valueFinding.findMany({ where: { aiAnalysis: { ideaVersionId } } }),
      db.marketFinding.findMany({ where: { aiAnalysis: { ideaVersionId } } }),
      db.feasibilityAssessment.findUnique({ where: { ideaVersionId }, include: { findings: true } }),
      db.risk.findMany({ where: { ideaVersionId } }),
      db.dependency.findMany({ where: { ideaVersionId } }),
      db.implementationPlan.findUnique({ where: { ideaVersionId }, include: { requirements: true, timeline: true } }),
    ]);

  return {
    valueFindings: valueFindings.map((f) => ({ dimension: f.dimension, band: f.band, rationale: f.rationale })),
    marketFindings: marketFindings.map((f) => ({ dimension: f.dimension, band: f.band, rationale: f.rationale })),
    feasibility: feasibility && {
      status: feasibility.status,
      summary: feasibility.summary,
      findings: feasibility.findings.map((f) => ({ dimension: f.dimension, band: f.band, finding: f.finding })),
    },
    risks: risks.map((r) => ({ category: r.category, description: r.description, level: r.level })),
    dependencies: dependencies.map((d) => ({ kind: d.kind, description: d.description, blocking: d.blocking })),
    plan: plan && {
      effortClass: plan.effortClass,
      costClass: plan.costClass,
      operationalComplexity: plan.operationalComplexity,
      timeline: plan.timeline.map((t) => ({ phase: t.phase, minWeeks: t.minWeeks, maxWeeks: t.maxWeeks })),
    },
  };
}

export async function runPipeline(
  deps: PipelineDeps,
  input: { ideaId: string; ideaVersionId: string; contentHash: string },
): Promise<PipelineResult> {
  const { db, provider } = deps;

  const version = await db.ideaVersion.findUnique({ where: { id: input.ideaVersionId } });
  if (!version) throw new Error(`idea version ${input.ideaVersionId} no longer exists`);

  // Submitter identity + the idea's own title, purely for iManner attribution — not used
  // anywhere else in this function. A missing idea/submitter here would be a data
  // integrity bug worth surfacing, but must never block analysis, so it's tolerated as
  // null attribution rather than thrown (Hard Rule 3 of the iManner integration).
  const idea = await db.idea.findUnique({
    where: { id: input.ideaId },
    include: { submitter: { select: { id: true, email: true, displayName: true } } },
  });

  const fields = fieldsOf(version);
  const routes = await loadRoutes(db);

  /**
   * The version this one replaced, if any (FR-16).
   *
   * A revision usually changes one or two fields. Re-running all six steps because the
   * cost note gained a sentence is slow, and on the real provider it is the difference
   * between a revision costing cents and costing dollars. Any step whose declared inputs
   * are byte-identical is carried forward instead.
   */
  const previous = await db.ideaVersion.findFirst({
    where: { ideaId: input.ideaId, versionNo: { lt: version.versionNo } },
    orderBy: { versionNo: "desc" },
    include: { analyses: true },
  });
  const previousFields = previous ? fieldsOf(previous) : null;
  let carried = 0;

  await db.idea.update({ where: { id: input.ideaId }, data: { status: "AI_ANALYSIS" } });

  /**
   * One query for every step's idempotency check, not one per step. `ideaVersionId` is
   * the same value across the whole loop below, so the 6 `findUnique` calls this used to
   * be were 6 round trips to ask the same question about the same version — exactly the
   * kind of per-iteration DB call `previous.analyses` a few lines up already avoids for
   * the carry-forward lookup.
   */
  const existingByStep = new Map(
    (await db.aiAnalysis.findMany({ where: { ideaVersionId: input.ideaVersionId } })).map(
      (a) => [a.step, a] as const,
    ),
  );

  let spent = 0;
  let fallbacks = 0;
  let ran = 0;

  for (const step of PIPELINE_STEPS) {
    // Skip work already done for this exact content (idempotency, SPEC §3.3).
    const existing = existingByStep.get(step);
    if (existing?.status === "SUCCEEDED") continue;

    /**
     * Carry forward when this step's inputs did not move.
     *
     * Only from a SUCCEEDED, non-fallback run: re-running a step that fell back is the
     * whole point of trying again, and copying a fallback forward would freeze an outage
     * into the record permanently.
     */
    const reusable =
      previousFields &&
      stepInputHash(step, fields) === stepInputHash(step, previousFields)
        ? previous?.analyses.find(
            (a) => a.step === step && a.status === "SUCCEEDED" && a.errorCode === null,
          )
        : undefined;

    if (reusable) {
      await carryForward(db, reusable, input.ideaVersionId, step);
      carried += 1;
      continue;
    }

    const analysis = await db.aiAnalysis.upsert({
      where: { ideaVersionId_step: { ideaVersionId: input.ideaVersionId, step } },
      update: { status: "RUNNING", startedAt: new Date(), errorCode: null },
      create: {
        ideaVersionId: input.ideaVersionId,
        step,
        status: "RUNNING",
        provider: provider.name,
        model: "pending",
        tier: "B",
        promptVersion: "pending",
        startedAt: new Date(),
      },
    });

    // ADR-026: IMPLEMENTATION_RECOMMENDATION synthesizes this run's OWN prior findings,
    // not new judgement about the submission — so it is given them as `trustedContext`
    // (engine-derived, not user-supplied — see providers/anthropic.ts), separate from
    // `fields`/`ideaText` above. By this point in the loop every earlier step for this
    // version has already committed (each iteration's transaction commits before the next
    // begins), whether freshly run or carried forward, so a plain read is enough.
    const trustedContext =
      step === "IMPLEMENTATION_RECOMMENDATION"
        ? await loadRecommendationContext(db, input.ideaVersionId)
        : undefined;

    const stepStarted = Date.now();
    const outcome = await analyseStep(provider, {
      step,
      // Exactly the fields the hash above covered. If a step could see more than it
      // declares, skipping it would be unsound.
      ideaText: stepInputText(step, fields),
      fields,
      trustedContext,
      redactionEnabled: deps.redactionEnabled,
      budgetRemainingUsd: deps.budgetPerVersionUsd - spent,
      routes,
    });

    ran += 1;
    spent += outcome.usage?.costUsd ?? 0;
    if (outcome.source === "FALLBACK") fallbacks += 1;

    // iManner observability — one event per real model call, with full attribution
    // (agent = this step, user = the idea's submitter, business record = the idea
    // itself). A fallback still called nothing on Anthropic's side when no route was
    // configured or the budget was exhausted before any request — that path stays
    // unreported since there is no generation to attribute. Every other fallback DID
    // reach the provider (a refusal, rate limit, timeout, or invalid output) and is
    // reported as an error with the actual failure reason.
    const noCallMade = outcome.failureReason !== null && NO_CALL_REASONS.has(outcome.failureReason);
    if (!noCallMade) {
      deps.observability.record({
        agentId: `analysis.${step.toLowerCase()}`,
        agentName: STEP_AGENT_NAMES[step],
        userId: idea?.submitterId ?? null,
        userName: idea?.submitter.displayName ?? null,
        interactionType: "idea-analysis",
        businessTransactionType: "idea",
        businessTransactionId: input.ideaId,
        businessTransactionName: version.title,
        provider: provider.name,
        modelId: outcome.model ?? "unknown",
        inputTokens: outcome.usage?.inputTokens ?? null,
        outputTokens: outcome.usage?.outputTokens ?? null,
        latencyMs: Date.now() - stepStarted,
        inputPayload: { systemPrompt: systemPromptFor(step), untrustedIdeaText: stepInputText(step, fields) },
        outputPayload: outcome.source === "AI" ? outcome.data : null,
        status: outcome.source === "AI" ? "success" : "error",
        error: outcome.source === "FALLBACK" ? outcome.failureReason : null,
        errorType: outcome.source === "FALLBACK" ? "AnalysisFallback" : null,
      });
    }

    /**
     * Marking the row SUCCEEDED and writing its children used to be two separate
     * statements. A crash (or a `persistStep` failure — a constraint violation, a
     * dropped connection) between them left the row permanently SUCCEEDED with no, or
     * only partial, child rows — and the idempotency check at the top of this loop
     * ("already SUCCEEDED — skip") means that step would never be retried, silently.
     * One transaction makes the two commit together or not at all, the same guarantee
     * `carryForward` below already gives its own multi-table write.
     */
    await db.$transaction(async (tx) => {
      await tx.aiAnalysis.update({
        where: { id: analysis.id },
        data: {
          // A fallback is a real, usable result — recorded as SUCCEEDED with its source
          // visible on the children, not as FAILED. The run did produce analysis.
          status: "SUCCEEDED",
          provider: provider.name,
          model: outcome.model ?? "fallback",
          tier: outcome.tier ?? "B",
          promptVersion: outcome.promptVersion,
          inputTokens: outcome.usage?.inputTokens ?? null,
          outputTokens: outcome.usage?.outputTokens ?? null,
          cachedInputTokens: outcome.usage?.cachedInputTokens ?? null,
          costUsdMicros: outcome.usage ? Math.round(outcome.usage.costUsd * 1_000_000) : null,
          redactionApplied: outcome.redactionApplied,
          escalatedFromTier: outcome.escalatedFromTier,
          errorCode: outcome.failureReason,
          rawPayload: outcome.data as never,
          finishedAt: new Date(),
        },
      });

      await persistStep(tx, input.ideaVersionId, analysis.id, step, outcome.data);
    });
  }

  /**
   * A run that leaned on the fallback is PARTIAL, and the idea needs a human look —
   * but it is still evaluated and still rankable.
   *
   * FAILED means total outage, compared against `ran` (what actually executed this
   * time), not `PIPELINE_STEPS.length`. A carried-forward or already-SUCCEEDED step
   * increments neither `ran` nor `fallbacks`, so on a revision the old comparison against
   * the fixed step count could never be true — a total outage on every step that DID run
   * (say, 3 of 7, the rest carried forward from before) reported PARTIAL/EVALUATED
   * instead of FAILED/NEEDS_CLARIFICATION.
   */
  const overall = fallbacks === 0 ? "SUCCEEDED" : fallbacks === ran && ran > 0 ? "FAILED" : "PARTIAL";

  await db.idea.update({
    where: { id: input.ideaId },
    data: { status: overall === "FAILED" ? "NEEDS_CLARIFICATION" : "EVALUATED" },
  });

  return {
    ideaVersionId: input.ideaVersionId,
    overall,
    stepsRun: ran,
    stepsCarriedForward: carried,
    stepsFallenBack: fallbacks,
    totalCostUsd: spent,
  };
}

/**
 * Write a step's typed children. Replaces prior rows so a re-run is not additive.
 *
 * Each branch casts to the Zod-INFERRED output type rather than a loose record: the data
 * has already been schema-validated, so the precise type is known, and an index-signature
 * shortcut here made every field silently undefined.
 */
async function persistStep(
  db: Db,
  ideaVersionId: string,
  analysisId: string,
  step: AnalysisStep,
  data: unknown,
): Promise<void> {
  switch (step) {
    case "STRUCTURE": {
      const p = data as StructureOutput;
      await db.aiStructuredProposal.upsert({
        where: { aiAnalysisId: analysisId },
        update: p,
        create: { aiAnalysisId: analysisId, ...p },
      });
      return;
    }

    case "USE_CASES": {
      const p = data as UseCaseOutput;
      await db.useCase.deleteMany({ where: { aiAnalysisId: analysisId } });
      await db.useCase.createMany({
        data: p.useCases.map((u) => ({
          aiAnalysisId: analysisId,
          kind: u.kind,
          horizon: u.horizon,
          title: u.title,
          description: u.description,
          departmentScope: u.departmentScope,
          estimatedUserCountBand: u.estimatedUserCountBand,
          isSpeculative: u.isSpeculative,
        })),
      });
      return;
    }

    case "VALUE": {
      const p = data as ValueOutput;
      await db.valueFinding.deleteMany({ where: { aiAnalysisId: analysisId } });
      await db.valueFinding.createMany({
        data: p.findings.map((f) => ({
          aiAnalysisId: analysisId,
          dimension: f.dimension,
          band: f.band,
          rationale: f.rationale,
          evidence: f.evidence,
        })),
      });
      return;
    }

    case "MARKET_CONTEXT": {
      const p = data as MarketOutput;
      await db.marketFinding.deleteMany({ where: { aiAnalysisId: analysisId } });
      await db.marketFinding.createMany({
        data: p.findings.map((f) => ({
          aiAnalysisId: analysisId,
          dimension: f.dimension,
          band: f.band,
          rationale: f.rationale,
          evidence: f.evidence,
        })),
      });
      return;
    }

    case "FEASIBILITY": {
      const p = data as FeasibilityOutput;
      await db.feasibilityAssessment.deleteMany({ where: { ideaVersionId } });
      await db.feasibilityAssessment.create({
        data: {
          ideaVersionId,
          status: p.status,
          summary: p.summary,
          constraintCitations: p.constraintCitations,
          findings: {
            create: p.findings.map((f) => ({
              dimension: f.dimension,
              band: f.band,
              finding: f.finding,
              condition: f.condition,
            })),
          },
        },
      });
      return;
    }

    case "RISK": {
      const p = data as RiskOutput;
      await db.risk.deleteMany({ where: { ideaVersionId } });
      await db.dependency.deleteMany({ where: { ideaVersionId } });
      await db.risk.createMany({
        data: p.risks.map((r) => ({
          ideaVersionId,
          category: r.category,
          description: r.description,
          level: r.level,
          potentialImpact: r.potentialImpact,
          mitigation: r.mitigation,
        })),
      });
      if (p.dependencies.length > 0) {
        await db.dependency.createMany({
          data: p.dependencies.map((x) => ({
            ideaVersionId,
            kind: x.kind,
            description: x.description,
            blocking: x.blocking,
          })),
        });
      }
      return;
    }

    case "EFFORT_TIMELINE": {
      const p = data as EffortTimelineOutput;
      await db.implementationPlan.deleteMany({ where: { ideaVersionId } });
      await db.implementationPlan.create({
        data: {
          ideaVersionId,
          effortClass: p.effortClass,
          costClass: p.costClass,
          operationalComplexity: p.operationalComplexity,
          notes: p.notes,
          requirements: {
            create: p.requirements.map((r) => ({
              kind: r.kind,
              item: r.item,
              detail: r.detail,
              isMandatory: r.isMandatory,
            })),
          },
          timeline: {
            create: p.timeline.map((t) => ({
              phase: t.phase,
              minWeeks: t.minWeeks,
              maxWeeks: t.maxWeeks,
              // FR-08: always preliminary. The DB CHECK makes false unstorable anyway.
              isPreliminary: true,
            })),
          },
        },
      });
      return;
    }

    case "IMPLEMENTATION_RECOMMENDATION": {
      const p = data as RecommendationOutput;
      await db.aiImplementationRecommendation.deleteMany({ where: { ideaVersionId } });
      await db.aiImplementationRecommendation.create({
        data: {
          ideaVersionId,
          recommendation: p.recommendation,
          rationale: p.rationale,
          supportingEvidence: p.supportingEvidence,
          risks: p.risks,
          assumptions: p.assumptions,
          validationNeeds: p.validationNeeds,
        },
      });
      return;
    }

    default:
      return;
  }
}

/**
 * Copy a step's result from the previous version onto this one.
 *
 * A copy, not a reference. The versions are independent records — an idea's v2 analysis
 * has to stay readable after v1 is superseded, and pointing at v1's row would make the
 * Analysis tab of one version depend on the lifetime of another.
 *
 * The child rows are re-created rather than moved, so both versions keep a complete set
 * and `persistStep`'s replace-on-rerun semantics still hold.
 */
async function carryForward(
  db: PrismaClient,
  source: {
    provider: string; model: string; tier: "A" | "B" | "C";
    promptVersion: string; redactionApplied: boolean; rawPayload: unknown;
  },
  ideaVersionId: string,
  step: AnalysisStep,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const analysis = await tx.aiAnalysis.upsert({
      where: { ideaVersionId_step: { ideaVersionId, step } },
      update: {
        status: "SUCCEEDED",
        provider: source.provider,
        model: source.model,
        tier: source.tier,
        promptVersion: source.promptVersion,
        redactionApplied: source.redactionApplied,
        rawPayload: source.rawPayload as never,
        // Zero cost, because none was incurred. Leaving the previous version's token
        // counts here would double-count spend across the idea's whole history.
        inputTokens: null, outputTokens: null, cachedInputTokens: null, costUsdMicros: null,
        errorCode: null,
        startedAt: new Date(),
        finishedAt: new Date(),
      },
      create: {
        ideaVersionId, step, status: "SUCCEEDED",
        provider: source.provider, model: source.model, tier: source.tier,
        promptVersion: source.promptVersion, redactionApplied: source.redactionApplied,
        rawPayload: source.rawPayload as never,
        startedAt: new Date(), finishedAt: new Date(),
      },
    });

    /**
     * `rawPayload` is exactly the JSON `persistStep` already knows how to turn into
     * child rows for every step type — it's the same value a fresh run passes it as
     * `outcome.data`. This used to hand-copy only STRUCTURE/USE_CASES/VALUE's rows
     * (keyed off `analysis.id`) and silently carried forward NOTHING for
     * FEASIBILITY/RISK/EFFORT_TIMELINE (keyed off `ideaVersionId` directly) — the
     * analysis row still landed SUCCEEDED, so the idempotency check above skipped it
     * forever, leaving a revised idea with a permanently blank Feasibility/Risk/Effort
     * tab. Routing through the one function that already knows every step's shape
     * fixes all seven at once instead of hand-copying three of them here too.
     */
    await persistStep(tx, ideaVersionId, analysis.id, step, source.rawPayload);
  });
}

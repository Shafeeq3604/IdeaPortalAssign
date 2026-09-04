import type { PrismaClient } from "@iep/db";
import { PIPELINE_STEPS, type AnalysisStep } from "@iep/contracts";
import {
  analyseStep, stepInputHash, stepInputText,
  type AiProvider, type ModelRoute,
  type StructureOutput, type UseCaseOutput, type ValueOutput,
  type FeasibilityOutput, type RiskOutput, type EffortTimelineOutput,
} from "@iep/ai";

/**
 * The six-step analysis pipeline (SPEC §3.3).
 *
 * Ordered, idempotent, and resilient by design:
 *
 *  - **Idempotent by content hash.** Re-running an unchanged version costs zero tokens;
 *    a step that already succeeded for this hash is skipped.
 *  - **Partial failure is normal.** A failed step falls back and the run continues. The
 *    idea stays rankable, which is the acceptance criterion (SPEC §9.3).
 *  - **Budget is tracked across the run**, not per call, so six cheap steps cannot add up
 *    past the per-version cap.
 */

export interface PipelineDeps {
  readonly db: PrismaClient;
  readonly provider: AiProvider;
  readonly budgetPerVersionUsd: number;
  readonly redactionEnabled: boolean;
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
  estimatedCostNote: string | null; references: string | null;
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
  };
}

export async function runPipeline(
  deps: PipelineDeps,
  input: { ideaId: string; ideaVersionId: string; contentHash: string },
): Promise<PipelineResult> {
  const { db, provider } = deps;

  const version = await db.ideaVersion.findUnique({ where: { id: input.ideaVersionId } });
  if (!version) throw new Error(`idea version ${input.ideaVersionId} no longer exists`);

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
    include: { analyses: { include: { proposal: true, useCases: true, valueFindings: true } } },
  });
  const previousFields = previous ? fieldsOf(previous) : null;
  let carried = 0;

  await db.idea.update({ where: { id: input.ideaId }, data: { status: "AI_ANALYSIS" } });

  let spent = 0;
  let fallbacks = 0;
  let ran = 0;

  for (const step of PIPELINE_STEPS) {
    // Skip work already done for this exact content (idempotency, SPEC §3.3).
    const existing = await db.aiAnalysis.findUnique({
      where: { ideaVersionId_step: { ideaVersionId: input.ideaVersionId, step } },
    });
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

    const outcome = await analyseStep(provider, {
      step,
      // Exactly the fields the hash above covered. If a step could see more than it
      // declares, skipping it would be unsound.
      ideaText: stepInputText(step, fields),
      fields,
      redactionEnabled: deps.redactionEnabled,
      budgetRemainingUsd: deps.budgetPerVersionUsd - spent,
      routes,
    });

    ran += 1;
    spent += outcome.usage?.costUsd ?? 0;
    if (outcome.source === "FALLBACK") fallbacks += 1;

    await db.aiAnalysis.update({
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

    await persistStep(db, input.ideaVersionId, analysis.id, step, outcome.data);
  }

  /**
   * A run that leaned on the fallback is PARTIAL, and the idea needs a human look —
   * but it is still evaluated and still rankable.
   */
  const overall = fallbacks === 0 ? "SUCCEEDED" : fallbacks === PIPELINE_STEPS.length ? "FAILED" : "PARTIAL";

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
  db: PrismaClient,
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
    id: string; provider: string; model: string; tier: "A" | "B" | "C";
    promptVersion: string; redactionApplied: boolean; rawPayload: unknown;
    proposal: Record<string, unknown> | null;
    useCases: Record<string, unknown>[];
    valueFindings: Record<string, unknown>[];
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

    if (source.proposal) {
      const { id: _id, aiAnalysisId: _parent, ...rest } = source.proposal as Record<string, unknown>;
      await tx.aiStructuredProposal.upsert({
        where: { aiAnalysisId: analysis.id },
        update: rest as never,
        create: { aiAnalysisId: analysis.id, ...(rest as object) } as never,
      });
    }

    if (source.useCases.length > 0) {
      await tx.useCase.deleteMany({ where: { aiAnalysisId: analysis.id } });
      await tx.useCase.createMany({
        data: source.useCases.map((u) => {
          const { id: _id, aiAnalysisId: _parent, ...rest } = u;
          return { aiAnalysisId: analysis.id, ...(rest as object) };
        }) as never,
      });
    }

    if (source.valueFindings.length > 0) {
      await tx.valueFinding.deleteMany({ where: { aiAnalysisId: analysis.id } });
      await tx.valueFinding.createMany({
        data: source.valueFindings.map((v) => {
          const { id: _id, aiAnalysisId: _parent, ...rest } = v;
          return { aiAnalysisId: analysis.id, ...(rest as object) };
        }) as never,
      });
    }
  });
}

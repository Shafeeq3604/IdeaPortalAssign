import type { PrismaClient } from "@iep/db";
import { PIPELINE_STEPS, type AnalysisStep } from "@iep/contracts";
import {
  analyseStep,
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

/** The submission as one text block — what the model actually analyses. */
function ideaTextFrom(fields: Readonly<Record<string, string | null>>): string {
  const parts = [
    fields["title"],
    fields["problemStatement"],
    fields["description"],
    fields["expectedUsers"],
    fields["expectedOutcome"],
    fields["existingProcess"],
    fields["existingSolutions"],
    fields["suggestedTechnology"],
    fields["expectedBenefits"],
  ].filter((v): v is string => Boolean(v && v.trim()));
  return parts.join("\n\n");
}

export async function runPipeline(
  deps: PipelineDeps,
  input: { ideaId: string; ideaVersionId: string; contentHash: string },
): Promise<PipelineResult> {
  const { db, provider } = deps;

  const version = await db.ideaVersion.findUnique({ where: { id: input.ideaVersionId } });
  if (!version) throw new Error(`idea version ${input.ideaVersionId} no longer exists`);

  const fields: Record<string, string | null> = {
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
  const ideaText = ideaTextFrom(fields);
  const routes = await loadRoutes(db);

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
      ideaText,
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

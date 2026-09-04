import { PIPELINE_STEPS, type AnalysisStep } from "@iep/contracts";
import { can } from "@iep/contracts";
import type { IdeaStatus } from "@iep/contracts";
import type { Handler } from "../server.js";
import { requireActor, sendError } from "../server.js";

/** Analysis read surfaces (P3 — FR-03..FR-11). Writing is the worker's job. */

const NOT_FOUND = "No idea with that id";

/** Provenance travels with every AI-derived block (SPEC §7.4). */
function provenanceOf(a: { model: string; promptVersion: string; errorCode: string | null } | null) {
  return {
    // A fallback result is SIGNAL-free but honest: source FALLBACK, never dressed as AI.
    source: a === null ? "FALLBACK" : a.errorCode ? "FALLBACK" : "AI",
    validatedBy: null,
    model: a?.model ?? null,
    promptVersion: a?.promptVersion ?? null,
  } as const;
}

export function registerAnalysisRoutes(handlers: Map<string, Handler>): void {
  handlers.set("getAnalysisStatus", async (request, reply, ctx) => {
    const { ideaId } = request.params as { ideaId: string };
    const idea = await ctx.db.idea.findUnique({
      where: { id: ideaId },
      select: { id: true, submitterId: true, status: true, currentVersionId: true },
    });
    if (!idea?.currentVersionId) return sendError(reply, "NOT_FOUND", NOT_FOUND);
    if (!can(requireActor(request), "idea:read", {
      ideaId: idea.id, submitterId: idea.submitterId, status: idea.status as IdeaStatus,
    }).allowed) return sendError(reply, "NOT_FOUND", NOT_FOUND);

    const rows = await ctx.db.aiAnalysis.findMany({
      where: { ideaVersionId: idea.currentVersionId },
    });
    const byStep = new Map(rows.map((r) => [r.step, r]));

    // The six steps ALWAYS appear, in order, whether or not they have started. The UI
    // stepper is determinate (SPEC §8.4) — it cannot be, if steps appear as they go.
    const steps = PIPELINE_STEPS.map((step: AnalysisStep) => {
      const r = byStep.get(step);
      return {
        step,
        status: r?.status ?? "PENDING",
        startedAt: r?.startedAt?.toISOString() ?? null,
        finishedAt: r?.finishedAt?.toISOString() ?? null,
        errorCode: r?.errorCode ?? null,
        usedFallback: Boolean(r?.errorCode),
      };
    });

    const done = steps.filter((s) => s.status === "SUCCEEDED").length;
    const anyFallback = steps.some((s) => s.usedFallback);
    const overall =
      done === 0 ? (rows.length > 0 ? "RUNNING" : "PENDING")
      : done < PIPELINE_STEPS.length ? "RUNNING"
      : anyFallback ? "PARTIAL"
      : "SUCCEEDED";

    return {
      analysisRunId: idea.currentVersionId,
      ideaVersionId: idea.currentVersionId,
      overall,
      steps,
      startedAt: steps.find((s) => s.startedAt)?.startedAt ?? null,
      finishedAt: overall === "RUNNING" || overall === "PENDING"
        ? null
        : steps.map((s) => s.finishedAt).filter(Boolean).sort().at(-1) ?? null,
    };
  });

  handlers.set("getIdeaAnalysis", async (request, reply, ctx) => {
    const { ideaId } = request.params as { ideaId: string };
    const idea = await ctx.db.idea.findUnique({
      where: { id: ideaId },
      include: { currentVersion: true },
    });
    if (!idea?.currentVersion) return sendError(reply, "NOT_FOUND", NOT_FOUND);
    if (!can(requireActor(request), "idea:read", {
      ideaId: idea.id, submitterId: idea.submitterId, status: idea.status as IdeaStatus,
    }).allowed) return sendError(reply, "NOT_FOUND", NOT_FOUND);

    const versionId = idea.currentVersion.id;
    const [analyses, feasibility, risks, dependencies, plan] = await Promise.all([
      ctx.db.aiAnalysis.findMany({
        where: { ideaVersionId: versionId },
        include: { proposal: true, useCases: true, valueFindings: true },
      }),
      ctx.db.feasibilityAssessment.findUnique({
        where: { ideaVersionId: versionId }, include: { findings: true },
      }),
      ctx.db.risk.findMany({ where: { ideaVersionId: versionId } }),
      ctx.db.dependency.findMany({ where: { ideaVersionId: versionId } }),
      ctx.db.implementationPlan.findUnique({
        where: { ideaVersionId: versionId }, include: { requirements: true, timeline: true },
      }),
    ]);

    const byStep = new Map(analyses.map((a) => [a.step, a]));
    const structure = byStep.get("STRUCTURE");
    const useCaseRun = byStep.get("USE_CASES");
    const valueRun = byStep.get("VALUE");

    const getAnalysisStatus = handlers.get("getAnalysisStatus");
    if (!getAnalysisStatus) throw new Error("getAnalysisStatus was not registered before getIdeaAnalysis");
    const statusResponse = await getAnalysisStatus(request, reply, ctx);

    return {
      ideaId: idea.id,
      ideaVersionId: versionId,
      versionNo: idea.currentVersion.versionNo,
      run: statusResponse,
      proposal: structure?.proposal
        ? { ...structure.proposal, provenance: provenanceOf(structure) }
        : null,
      useCases: (useCaseRun?.useCases ?? []).map((u) => ({
        id: u.id, kind: u.kind, horizon: u.horizon, title: u.title,
        description: u.description, departmentScope: u.departmentScope,
        estimatedUserCountBand: u.estimatedUserCountBand, isSpeculative: u.isSpeculative,
      })),
      valueFindings: (valueRun?.valueFindings ?? []).map((v) => ({
        dimension: v.dimension, band: v.band, rationale: v.rationale, evidence: v.evidence,
      })),
      feasibility: feasibility
        ? {
            status: feasibility.status,
            summary: feasibility.summary,
            constraintCitations: feasibility.constraintCitations,
            findings: feasibility.findings.map((f) => ({
              dimension: f.dimension, band: f.band, finding: f.finding, condition: f.condition,
            })),
            provenance: provenanceOf(byStep.get("FEASIBILITY") ?? null),
          }
        : null,
      risks: risks.map((r) => ({
        id: r.id, category: r.category, description: r.description, level: r.level,
        potentialImpact: r.potentialImpact, mitigation: r.mitigation,
      })),
      dependencies: dependencies.map((d) => ({
        id: d.id, kind: d.kind, description: d.description, blocking: d.blocking,
      })),
      plan: plan
        ? {
            effortClass: plan.effortClass, costClass: plan.costClass,
            operationalComplexity: plan.operationalComplexity, notes: plan.notes,
            requirements: plan.requirements.map((r) => ({
              id: r.id, kind: r.kind, item: r.item, detail: r.detail, isMandatory: r.isMandatory,
            })),
            timeline: plan.timeline.map((t) => ({
              phase: t.phase, minWeeks: t.minWeeks, maxWeeks: t.maxWeeks, isPreliminary: true as const,
            })),
            provenance: provenanceOf(byStep.get("EFFORT_TIMELINE") ?? null),
          }
        : null,
    };
  });
}

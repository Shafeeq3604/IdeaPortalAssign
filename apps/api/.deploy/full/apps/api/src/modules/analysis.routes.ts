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

/**
 * Shared by `getAnalysisStatus` and `getIdeaAnalysis` — the latter already has the
 * `aiAnalysis` rows it needs (fetched with different `include`s for its own richer
 * response), so it calls this directly instead of re-running the query through the
 * other handler.
 */
function buildAnalysisStatus(
  ideaVersionId: string,
  // `step` is `string`, not the narrower `@iep/contracts` `AnalysisStep`: the rows this
  // is called with come straight from Prisma, whose generated enum has an extra
  // `IMPROVEMENT` value (P5's separate step) that the pipeline's `AnalysisStep` doesn't
  // carry — `byStep.get(step)` below only ever looks up the 7 PIPELINE_STEPS.
  rows: readonly {
    step: string;
    status: string;
    startedAt: Date | null;
    finishedAt: Date | null;
    errorCode: string | null;
  }[],
) {
  const byStep = new Map(rows.map((r) => [r.step, r]));

  // The seven steps ALWAYS appear, in order, whether or not they have started. The UI
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
    analysisRunId: ideaVersionId,
    ideaVersionId,
    overall,
    steps,
    startedAt: steps.find((s) => s.startedAt)?.startedAt ?? null,
    finishedAt: overall === "RUNNING" || overall === "PENDING"
      ? null
      : steps.map((s) => s.finishedAt).filter(Boolean).sort().at(-1) ?? null,
  };
}

/** A run that never reaches SUCCEEDED/PARTIAL within this long closes anyway — every step
 *  retries 3x with backoff then falls back (SPEC §3.3), so a real run always terminates
 *  well inside this; it exists only so a wedged connection cannot hold a DB-polling
 *  interval open forever. */
const STREAM_MAX_DURATION_MS = 10 * 60 * 1000;
const STREAM_POLL_MS = 1000; // meets the same "within 2s of the job event" NFR polling already did

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
    return buildAnalysisStatus(idea.currentVersionId, rows);
  });

  /**
   * SSE progress (SPEC §3.3, NFR-06). `AcceptedResponse.streamUrl` has pointed here since
   * P0; until now nothing was registered for it, so the URL the API itself hands back to
   * every submitter 404'd if anything actually called it.
   *
   * Transport: the API polls its OWN database on an interval and pushes a frame only when
   * the computed status actually changed, rather than subscribing to the worker's BullMQ
   * job events directly. That trades a small amount of latency (bounded by
   * STREAM_POLL_MS, still comfortably inside the "within 2s" NFR the existing client-side
   * poll already met) for not coupling the API process to the worker's queue/job naming —
   * `buildAnalysisStatus` is the one shared source of truth for "what is this run's state"
   * either way.
   *
   * Auth and ownership are enforced up front, same as `getAnalysisStatus` above — a
   * browser's native EventSource cannot set custom headers, but this app's sessions are
   * cookie-based, so the same `preHandler` that resolves `request.actor` for every other
   * route runs here too, and this endpoint answers NOT_FOUND before ever calling
   * `reply.hijack()` for an idea the requester cannot read.
   */
  handlers.set("getAnalysisStream", async (request, reply, ctx) => {
    const { ideaId } = request.params as { ideaId: string };
    const idea = await ctx.db.idea.findUnique({
      where: { id: ideaId },
      select: { id: true, submitterId: true, status: true, currentVersionId: true },
    });
    if (!idea?.currentVersionId) return sendError(reply, "NOT_FOUND", NOT_FOUND);
    if (!can(requireActor(request), "idea:read", {
      ideaId: idea.id, submitterId: idea.submitterId, status: idea.status as IdeaStatus,
    }).allowed) return sendError(reply, "NOT_FOUND", NOT_FOUND);

    const versionId = idea.currentVersionId;

    // Take over the raw response ourselves — this is a long-lived stream, not a single
    // JSON reply, so the generic `reply.status(...).send(result)` path in server.ts's
    // `registerEndpoint` must not run. `reply.hijack()` makes `reply.sent` true, which is
    // exactly what that generic path checks for before it would otherwise try to send.
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Some reverse proxies (nginx) buffer proxied responses by default, which would
      // turn "push" back into "arrives all at once at the end" — harmless if absent,
      // load-bearing if the deployed topology ever puts one in front of this app.
      "X-Accel-Buffering": "no",
    });

    let closed = false;
    let lastPayload: string | null = null;

    const send = (event: string, payload: unknown): void => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    };

    const cleanup = (): void => {
      if (closed) return;
      closed = true;
      clearInterval(poll);
      clearTimeout(maxDuration);
      reply.raw.end();
    };

    const tick = async (): Promise<void> => {
      if (closed) return;
      const rows = await ctx.db.aiAnalysis.findMany({ where: { ideaVersionId: versionId } });
      const status = buildAnalysisStatus(versionId, rows);
      const payload = JSON.stringify(status);
      if (payload !== lastPayload) {
        lastPayload = payload;
        send("status", status);
      }
      if (status.overall === "SUCCEEDED" || status.overall === "PARTIAL") {
        send("done", { overall: status.overall });
        cleanup();
      }
    };

    const poll = setInterval(() => void tick(), STREAM_POLL_MS);
    const maxDuration = setTimeout(() => {
      send("timeout", { message: "stream closed after the maximum stream duration" });
      cleanup();
    }, STREAM_MAX_DURATION_MS);
    request.raw.on("close", cleanup);

    // Send the current state immediately — a client should not wait a full poll interval
    // just to learn the state the moment it connected.
    await tick();
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
    const [analyses, feasibility, risks, dependencies, plan, recommendation] = await Promise.all([
      ctx.db.aiAnalysis.findMany({
        where: { ideaVersionId: versionId },
        include: { proposal: true, useCases: true, valueFindings: true, marketFindings: true },
      }),
      ctx.db.feasibilityAssessment.findUnique({
        where: { ideaVersionId: versionId }, include: { findings: true },
      }),
      ctx.db.risk.findMany({ where: { ideaVersionId: versionId } }),
      ctx.db.dependency.findMany({ where: { ideaVersionId: versionId } }),
      ctx.db.implementationPlan.findUnique({
        where: { ideaVersionId: versionId }, include: { requirements: true, timeline: true },
      }),
      // ADR-026 — read-only, exactly like every other AI-derived block above. Writing is
      // still the worker's job (this file's own header comment).
      ctx.db.aiImplementationRecommendation.findUnique({ where: { ideaVersionId: versionId } }),
    ]);

    const byStep = new Map(analyses.map((a) => [a.step, a]));
    const structure = byStep.get("STRUCTURE");
    const useCaseRun = byStep.get("USE_CASES");
    const valueRun = byStep.get("VALUE");
    const marketRun = byStep.get("MARKET_CONTEXT");

    // `analyses` above already has every row `buildAnalysisStatus` needs — calling
    // through `getAnalysisStatus` here used to re-run its `idea` lookup and its
    // `aiAnalysis.findMany`, both duplicates of work this handler already did.
    const statusResponse = buildAnalysisStatus(versionId, analyses);

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
      marketFindings: (marketRun?.marketFindings ?? []).map((m) => ({
        dimension: m.dimension, band: m.band, rationale: m.rationale, evidence: m.evidence,
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
      recommendation: recommendation
        ? {
            id: recommendation.id,
            recommendation: recommendation.recommendation,
            rationale: recommendation.rationale,
            supportingEvidence: recommendation.supportingEvidence,
            risks: recommendation.risks,
            assumptions: recommendation.assumptions,
            validationNeeds: recommendation.validationNeeds,
            generatedAt: recommendation.createdAt.toISOString(),
            provenance: provenanceOf(byStep.get("IMPLEMENTATION_RECOMMENDATION") ?? null),
          }
        : null,
    };
  });
}

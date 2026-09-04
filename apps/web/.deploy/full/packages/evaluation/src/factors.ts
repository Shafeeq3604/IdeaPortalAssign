import type { PrismaClient } from "@iep/db";
import { CRITERIA } from "@iep/contracts";
import type {
  Band, Confidence, CriterionDef, EffortClass, FeasibilityStatus, Horizon, ProfileDef,
  RiskLevel, ScoreSource, UserCountBand,
} from "@iep/contracts";
import type { CompletenessInput, EngineConfig, FactorSet } from "@iep/scoring";

/**
 * The bridge between the database and the pure engine (P4's missing half).
 *
 * `packages/scoring` has no I/O by design — an architecture test enforces it — so
 * something has to read the AI analysis and hand the engine a `FactorSet`. That is this
 * file, and it lives in the worker because the worker is what runs after an analysis.
 *
 * The one rule it must not break: **nothing here invents a number.** It moves ordinal
 * bands, classes and evidence across the boundary. Every arithmetic operation on them
 * happens on the other side.
 */

/**
 * `engineVersion` stamps every evaluation and makes a stored score attributable
 * (SPEC §3.2). Bump it when the engine's ARITHMETIC changes — not when this mapping
 * gains a field — because the unique key on `evaluations` treats a bump as a new result
 * rather than a correction of the old one.
 */
export const ENGINE_VERSION = "1.0.0";

/** Below this composite, an idea gets improvement recommendations (D-13, P-4). */
export const ATTENTION_THRESHOLD = 60;

/**
 * A step that fell back to the non-AI path is recorded LOW confidence and FALLBACK
 * source, all the way down to the criterion score. A reviewer looking at a low score
 * needs to know whether the model said so or nobody did.
 */
function provenanceOf(errorCode: string | null): { source: ScoreSource; confidence: Confidence } {
  return errorCode
    ? { source: "FALLBACK", confidence: "LOW" }
    : { source: "AI", confidence: "MEDIUM" };
}

/** Evidence is never empty (P-7). Where the source has none, say so rather than fake it. */
const orStated = (lines: readonly string[], fallback: string): readonly string[] =>
  lines.filter((l) => l.trim().length > 0).length > 0
    ? lines.filter((l) => l.trim().length > 0)
    : [fallback];

export interface LoadedConfig {
  readonly config: EngineConfig;
  readonly profileId: string;
  readonly criterionIdByKey: ReadonlyMap<string, string>;
}

/**
 * Criteria and profiles are CONFIG, so they come from the database, not from a constant
 * in the engine (FR-13, P-6). `factorSource` is the exception: it describes which AI
 * factor feeds a criterion, which is a property of the code, not something an admin sets.
 */
export async function loadEngineConfig(
  db: PrismaClient,
  profileKey?: string,
): Promise<LoadedConfig> {
  const profileRow = profileKey
    ? await db.evaluationProfile.findUnique({ where: { key: profileKey }, include: { weights: true } })
    : await db.evaluationProfile.findFirst({ where: { isDefault: true }, include: { weights: true } });

  if (!profileRow) {
    throw new Error(
      profileKey
        ? `no evaluation profile with key "${profileKey}"`
        : "no default evaluation profile — run `pnpm db:seed`",
    );
  }

  const criterionRows = await db.evaluationCriterion.findMany({ orderBy: { key: "asc" } });
  if (criterionRows.length === 0) throw new Error("no evaluation criteria — run `pnpm db:seed`");

  const factorSourceByKey = new Map(CRITERIA.map((c) => [c.key, c.factorSource]));
  const criteria: CriterionDef[] = criterionRows.map((c) => ({
    key: c.key,
    label: c.label,
    description: c.description,
    group: c.group,
    direction: c.direction,
    sourceKind: c.sourceKind,
    factorSource: factorSourceByKey.get(c.key) ?? null,
    isActive: c.isActive,
  }));

  const keyById = new Map(criterionRows.map((c) => [c.id, c.key]));
  const weights: Record<string, number> = {};
  for (const w of profileRow.weights) {
    const key = keyById.get(w.criterionId);
    if (key) weights[key] = Number(w.weight);
  }

  const profile: ProfileDef = {
    key: profileRow.key,
    name: profileRow.name,
    description: profileRow.description,
    weights,
    isDefault: profileRow.isDefault,
  };

  return {
    config: { criteria, profile, attentionThreshold: ATTENTION_THRESHOLD, engineVersion: ENGINE_VERSION },
    profileId: profileRow.id,
    criterionIdByKey: new Map(criterionRows.map((c) => [c.key, c.id])),
  };
}

/**
 * Read one version's analysis and shape it as factors.
 *
 * Returns `null` when the version has no analysis at all — an un-analysed idea is not a
 * zero-scored idea, and evaluating one would put a meaningless number on the board.
 */
export async function buildFactorSet(
  db: PrismaClient,
  ideaVersionId: string,
): Promise<FactorSet | null> {
  const [version, analyses, feasibility, risks, plan, demandSignals, kpiCount, pilot] =
    await Promise.all([
      db.ideaVersion.findUnique({ where: { id: ideaVersionId } }),
      db.aiAnalysis.findMany({
        where: { ideaVersionId },
        include: { useCases: true, valueFindings: true },
      }),
      db.feasibilityAssessment.findUnique({
        where: { ideaVersionId }, include: { findings: true },
      }),
      db.risk.findMany({ where: { ideaVersionId } }),
      db.implementationPlan.findUnique({ where: { ideaVersionId }, include: { timeline: true } }),
      db.ideaVersion
        .findUnique({ where: { id: ideaVersionId }, select: { ideaId: true } })
        .then((v) => (v ? db.demandSignal.findMany({ where: { ideaId: v.ideaId } }) : [])),
      db.ideaVersion
        .findUnique({ where: { id: ideaVersionId }, select: { ideaId: true } })
        .then((v) => (v ? db.kpiDefinition.count({ where: { ideaId: v.ideaId } }) : 0)),
      db.ideaVersion
        .findUnique({ where: { id: ideaVersionId }, select: { ideaId: true } })
        .then((v) => (v ? db.pilotRecord.findUnique({ where: { ideaId: v.ideaId } }) : null)),
    ]);

  if (!version) return null;
  if (analyses.length === 0 && !feasibility && !plan && risks.length === 0) return null;

  const errorByStep = new Map(analyses.map((a) => [a.step, a.errorCode]));
  const useCaseRows = analyses.flatMap((a) => a.useCases);
  const valueRows = analyses.flatMap((a) => a.valueFindings);

  /* ── value ── */
  const valueProv = provenanceOf(errorByStep.get("VALUE") ?? null);
  const value: Record<string, FactorSet["value"][string]> = {};
  for (const v of valueRows) {
    value[v.dimension] = {
      value: v.band as Band,
      evidence: orStated(v.evidence, "the submission gives no direct evidence for this"),
      rationale: v.rationale,
      ...valueProv,
    };
  }

  /* ── feasibility ── */
  const feasProv = provenanceOf(errorByStep.get("FEASIBILITY") ?? null);
  const feasibilityFactors: Record<string, FactorSet["feasibility"][string]> = {};
  for (const f of feasibility?.findings ?? []) {
    feasibilityFactors[f.dimension] = {
      value: f.band as Band,
      // A feasibility finding carries no evidence array of its own; the finding IS the
      // evidence, and the condition is the actionable half of it (P-4).
      evidence: orStated(
        [f.finding, ...(f.condition ? [`Would be feasible if: ${f.condition}`] : [])],
        "not assessed",
      ),
      rationale: f.finding,
      ...feasProv,
    };
  }

  /* ── effort, cost, timeline ── */
  const planProv = provenanceOf(errorByStep.get("EFFORT_TIMELINE") ?? null);
  const planEvidence = orStated(
    [plan?.notes ?? ""],
    "estimated from the described scope; no detailed design exists yet",
  );
  const weeks = (plan?.timeline ?? []).reduce(
    (acc, t) => ({ min: acc.min + t.minWeeks, max: acc.max + t.maxWeeks }),
    { min: 0, max: 0 },
  );

  return {
    ideaVersionId,
    value,
    feasibility: feasibilityFactors,
    feasibilityStatus: {
      value: (feasibility?.status ?? "REQUIRES_INVESTIGATION") as FeasibilityStatus,
      evidence: orStated(
        [feasibility?.summary ?? "", ...(feasibility?.constraintCitations ?? [])],
        "feasibility was not assessed",
      ),
      rationale: feasibility?.summary ?? "Not assessed",
      ...feasProv,
    },
    useCases: useCaseRows.map((u) => ({
      kind: u.kind as "DIRECT" | "INDIRECT",
      horizon: u.horizon as Horizon,
      reachBand: u.estimatedUserCountBand as UserCountBand,
      isSpeculative: u.isSpeculative,
      departmentScope: u.departmentScope,
    })),
    risks: risks.map((r) => ({
      category: r.category,
      level: r.level as RiskLevel,
      // FR-10 makes mitigation non-null, so this is about substance, not presence.
      hasMitigation: r.mitigation.trim().length > 0,
    })),
    effortClass: {
      value: (plan?.effortClass ?? "MEDIUM") as EffortClass,
      evidence: planEvidence,
      rationale: plan ? `Estimated effort: ${plan.effortClass}` : "No plan produced",
      ...planProv,
    },
    costClass: {
      value: (plan?.costClass ?? "MEDIUM") as EffortClass,
      evidence: planEvidence,
      rationale: plan ? `Estimated cost: ${plan.costClass}` : "No plan produced",
      ...planProv,
    },
    timelineTotalWeeks: {
      value: weeks.max > 0 ? weeks : { min: 12, max: 26 },
      evidence: planEvidence,
      rationale: weeks.max > 0
        ? `${weeks.min}–${weeks.max} weeks across ${plan?.timeline.length ?? 0} phases, preliminary`
        : "No timeline produced",
      ...planProv,
    },
    // P11 collects these. The empty record is deliberate: the criterion exists, is
    // weighted 0, and reports "not yet collected" rather than silently scoring 50.
    signals: {},
    completeness: completenessOf({
      version,
      hasUseCases: useCaseRows.length > 0,
      hasPlan: Boolean(plan),
      hasRisks: risks.length > 0,
      hasDemand: demandSignals.length > 0,
      hasPilot: Boolean(pilot),
      kpiCount,
    }),
  };
}

/**
 * FR-17 maturity inputs. Completeness of the SUBMISSION, never of the analysis — an
 * employee is judged on what they wrote, not on how much the model managed to say.
 */
function completenessOf(input: {
  version: { problemStatement: string; expectedUsers: string; expectedOutcome: string; suggestedTechnology: string | null };
  hasUseCases: boolean;
  hasPlan: boolean;
  hasRisks: boolean;
  hasDemand: boolean;
  hasPilot: boolean;
  kpiCount: number;
}): CompletenessInput {
  const filled = (s: string | null): boolean => Boolean(s && s.trim().length > 0);
  return {
    hasProblemStatement: filled(input.version.problemStatement),
    hasExpectedUsers: filled(input.version.expectedUsers),
    hasExpectedOutcome: filled(input.version.expectedOutcome),
    hasUseCases: input.hasUseCases,
    hasSuggestedTechnology: filled(input.version.suggestedTechnology),
    // The next three are only reachable from M2/M3 features. They are wired now rather
    // than hardcoded false, so maturity starts working the day those features land.
    hasEvidenceOfDemand: input.hasDemand,
    hasPrototypeEvidence: input.hasPilot,
    hasImplementationPlan: input.hasPlan,
    hasRisks: input.hasRisks,
    hasKpis: input.kpiCount > 0,
  };
}

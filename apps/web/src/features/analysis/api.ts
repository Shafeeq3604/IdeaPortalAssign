import { useQuery } from "@tanstack/react-query";
import type {
  AnalysisRunStatus, AnalysisStep, Band, DependencyKind, EffortClass,
  FeasibilityDimension, FeasibilityStatus, Horizon, IdeaAnalysisResponse, Provenance,
  RequirementKind, RiskCategory, RiskLevel, TimelinePhase, UseCaseKind, UserCountBand,
  ValueDimension,
} from "@iep/contracts";
import { api } from "../../app/api-client";
import { queryKeys } from "../../app/query-keys";

/**
 * Analysis data access (P3).
 *
 * PROGRESS IS POLLED, NOT STREAMED. SPEC §14 P3 names SSE, but the frozen P0 endpoint
 * list has no stream route, and adding one is a contract amendment (SPEC §14.1) rather
 * than something to invent mid-slice. Polling `/analysis/status` on a 2s interval meets
 * the acceptance criterion in §9.3 — "each step's real state, updated within 2s of the
 * job event" — using only frozen contracts. The stepper is driven by real per-step rows
 * either way; only the transport differs. Recorded in docs/adr/CONTRACT-LOG.md.
 */

/** Terminal states stop the poll. A finished run must not keep hitting the API forever. */
const LIVE: ReadonlySet<AnalysisRunStatus["overall"]> = new Set(["PENDING", "RUNNING"]);

const POLL_MS = 2_000;

export function useAnalysisStatus(ideaId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.ideas.analysisStatus(ideaId),
    queryFn: () => api<AnalysisRunStatus>(`/ideas/${ideaId}/analysis/status`),
    enabled: Boolean(ideaId) && enabled,
    refetchInterval: (query) =>
      query.state.data && LIVE.has(query.state.data.overall) ? POLL_MS : false,
  });
}

export function useAnalysis(ideaId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.ideas.analysis(ideaId),
    queryFn: () => api<IdeaAnalysisResponse>(`/ideas/${ideaId}/analysis`),
    enabled: Boolean(ideaId) && enabled,
    // The full analysis only changes when the run does, so it follows the run's state
    // rather than polling on its own clock.
    refetchInterval: (query) =>
      query.state.data && LIVE.has(query.state.data.run.overall) ? POLL_MS : false,
  });
}

/**
 * Contract provenance → the `<Provenance>` wrapper's three states.
 *
 * FALLBACK maps to AI_UNVALIDATED deliberately. It is not human-validated, and showing it
 * on the plain surface would let a non-AI fallback read as approved content. The chip in
 * `EvidenceList` says which of the two it actually was.
 */
export function provenanceState(p: Provenance): "AI_UNVALIDATED" | "HUMAN_VALIDATED" | "HUMAN_OVERRIDDEN" {
  if (p.validatedBy) return p.source === "HUMAN" ? "HUMAN_OVERRIDDEN" : "HUMAN_VALIDATED";
  return "AI_UNVALIDATED";
}

export function validatedByOf(p: Provenance): { name: string; at: string } | undefined {
  return p.validatedBy
    ? { name: p.validatedBy.displayName, at: new Date(p.validatedBy.at).toLocaleDateString() }
    : undefined;
}

/* ── Labels. The enums are contract; the wording is presentation (as with STATUS_LABEL). ── */

export const STEP_LABEL: Record<AnalysisStep, string> = {
  STRUCTURE: "Understanding the idea",
  USE_CASES: "Finding where it applies",
  VALUE: "Assessing business value",
  FEASIBILITY: "Checking feasibility",
  RISK: "Identifying risks",
  EFFORT_TIMELINE: "Estimating effort and timeline",
  IMPROVEMENT: "Recommending improvements",
  EXPLANATION: "Writing the explanation",
};

export const BAND_LABEL: Record<Band, string> = {
  NEGLIGIBLE: "Negligible",
  LOW: "Low",
  MODERATE: "Moderate",
  HIGH: "High",
  VERY_HIGH: "Very high",
};

/** Ordinal position, used only to size a bar. Not a score — the engine owns those. */
export const BAND_STEPS: Record<Band, number> = {
  NEGLIGIBLE: 1, LOW: 2, MODERATE: 3, HIGH: 4, VERY_HIGH: 5,
};

export const FEASIBILITY_LABEL: Record<FeasibilityStatus, string> = {
  HIGHLY_FEASIBLE: "Highly feasible",
  FEASIBLE_WITH_CONDITIONS: "Feasible, with conditions",
  REQUIRES_INVESTIGATION: "Needs investigation",
  NOT_CURRENTLY_FEASIBLE: "Not feasible right now",
};

export const VALUE_DIMENSION_LABEL: Record<ValueDimension, string> = {
  BUSINESS_IMPACT: "Business impact",
  PRODUCTIVITY: "Productivity",
  COST_REDUCTION: "Cost reduction",
  REVENUE: "Revenue",
  EMPLOYEE_EXPERIENCE: "Employee experience",
  CUSTOMER_IMPACT: "Customer impact",
  OPERATIONAL: "Operational improvement",
  PROBLEM_SEVERITY: "Severity of the problem",
  PROBLEM_FREQUENCY: "How often it happens",
};

export const FEASIBILITY_DIMENSION_LABEL: Record<FeasibilityDimension, string> = {
  TECHNICAL: "Technical", DATA: "Data", INFRASTRUCTURE: "Infrastructure",
  INTEGRATION: "Integration", SECURITY: "Security", PRIVACY: "Privacy",
  COMPLIANCE: "Compliance", EXPERTISE: "Expertise", RESOURCES: "Resources",
  COST: "Cost", EXTERNAL_DEPENDENCY: "External dependency",
};

export const RISK_CATEGORY_LABEL: Record<RiskCategory, string> = {
  TECHNICAL: "Technical", SECURITY: "Security", PRIVACY: "Privacy",
  COMPLIANCE: "Compliance", FINANCIAL: "Financial", OPERATIONAL: "Operational",
  ADOPTION: "Adoption", DATA: "Data", VENDOR: "Vendor",
};

export const RISK_LEVEL_LABEL: Record<RiskLevel, string> = {
  LOW: "Low", MEDIUM: "Medium", HIGH: "High", CRITICAL: "Critical",
};

export const EFFORT_LABEL: Record<EffortClass, string> = {
  LOW: "Low", MEDIUM: "Medium", HIGH: "High", VERY_HIGH: "Very high",
};

export const USE_CASE_KIND_LABEL: Record<UseCaseKind, string> = {
  DIRECT: "Direct", INDIRECT: "Indirect",
};

export const HORIZON_LABEL: Record<Horizon, string> = {
  SHORT: "Short term", MEDIUM: "Medium term", LONG: "Long term",
};

export const USER_COUNT_LABEL: Record<UserCountBand, string> = {
  LT10: "Under 10 people",
  B10_100: "10–100 people",
  B100_1K: "100–1,000 people",
  B1K_10K: "1,000–10,000 people",
  GT10K: "Over 10,000 people",
};

export const REQUIREMENT_KIND_LABEL: Record<RequirementKind, string> = {
  PEOPLE: "People", TECHNOLOGY: "Technology", DATA: "Data", ORG: "Organisational",
};

export const DEPENDENCY_KIND_LABEL: Record<DependencyKind, string> = {
  INTERNAL: "Internal", EXTERNAL: "External", VENDOR: "Vendor", DATA: "Data",
};

export const TIMELINE_PHASE_LABEL: Record<TimelinePhase, string> = {
  DISCOVERY: "Discovery", PROTOTYPE: "Prototype", MVP: "MVP",
  TESTING: "Testing", DEPLOYMENT: "Deployment",
};

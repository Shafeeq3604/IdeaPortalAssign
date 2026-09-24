import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AnalysisRunStatus, AnalysisStep, Band, DependencyKind, EffortClass,
  FeasibilityDimension, FeasibilityStatus, Horizon, IdeaAnalysisResponse,
  ImplementationRecommendationAction, MarketDimension,
  Provenance, RequirementKind, RiskCategory, RiskLevel, TimelinePhase, UseCaseKind,
  UserCountBand, ValueDimension,
} from "@iep/contracts";
import { api } from "../../app/api-client";
import { queryKeys } from "../../app/query-keys";

/**
 * Analysis data access (P3).
 *
 * Progress is pushed over SSE (`getAnalysisStream`, wiring up the `streamUrl` P0 already
 * reserved — docs/adr/CONTRACT-LOG.md 2026-09-23) when the browser supports it, and falls
 * back to polling `/analysis/status` otherwise — jsdom (this repo's test environment) has
 * no `EventSource`, an old browser might not, and a corporate proxy might buffer or drop a
 * long-lived connection outright. Either transport meets the same §9.3 acceptance
 * criterion ("each step's real state, updated within 2s of the job event"); only the
 * plumbing differs, and `AnalysisProgress`/`AnalysisTab` do not know or care which one is
 * live — they only ever read this hook's ordinary TanStack Query result.
 */

/** Terminal states stop the poll. A finished run must not keep hitting the API forever. */
const LIVE: ReadonlySet<AnalysisRunStatus["overall"]> = new Set(["PENDING", "RUNNING"]);

const POLL_MS = 2_000;

export function useAnalysisStatus(ideaId: string, enabled = true) {
  const queryClient = useQueryClient();
  // Starts false — the query keeps polling until an SSE connection actually proves
  // itself by delivering a real frame, rather than assuming the stream works the moment
  // it is opened.
  const [streamHealthy, setStreamHealthy] = useState(false);

  const query = useQuery({
    queryKey: queryKeys.ideas.analysisStatus(ideaId),
    queryFn: () => api<AnalysisRunStatus>(`/ideas/${ideaId}/analysis/status`),
    enabled: Boolean(ideaId) && enabled,
    refetchInterval: (q) =>
      q.state.data && LIVE.has(q.state.data.overall) && !streamHealthy ? POLL_MS : false,
  });

  useEffect(() => {
    if (!ideaId || !enabled) return;
    // No polyfill, no assumption the transport exists — an environment without a real
    // EventSource (jsdom, chiefly) just keeps using the polling above.
    if (typeof EventSource === "undefined") return;

    // Not reset to false here on purpose (that would be a synchronous setState in the
    // effect body, which is what triggered this comment) — a stale `true` from a
    // previous ideaId self-corrects within one `onerror`/`status` event below, and in
    // practice a route change remounts this hook entirely rather than reusing it across
    // ideas.
    const source = new EventSource(`/api/ideas/${ideaId}/analysis/stream`);
    const queryKey = queryKeys.ideas.analysisStatus(ideaId);

    source.addEventListener("status", (event) => {
      setStreamHealthy(true);
      const data = JSON.parse((event as MessageEvent<string>).data) as AnalysisRunStatus;
      queryClient.setQueryData(queryKey, data);
    });
    source.addEventListener("done", () => source.close());
    // A network hiccup, a proxy that does not forward SSE (see the API handler's own
    // X-Accel-Buffering comment), or the connection simply dying — any of it falls back
    // to the polling above. The browser's default auto-reconnect is deliberately not
    // relied on: a stream that failed once for this view stays failed for this view,
    // rather than retrying indefinitely alongside an already-working poll.
    source.onerror = () => {
      setStreamHealthy(false);
      source.close();
    };

    return () => source.close();
  }, [ideaId, enabled, queryClient]);

  return query;
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
  MARKET_CONTEXT: "Assessing market & competitive context",
  FEASIBILITY: "Checking feasibility",
  RISK: "Identifying risks",
  EFFORT_TIMELINE: "Estimating effort and timeline",
  IMPLEMENTATION_RECOMMENDATION: "Forming an implementation recommendation",
  EXPLANATION: "Writing the explanation",
};

/**
 * ADR-026 — the recommended ACTION for a human to weigh, never a verdict on the idea's
 * worth (P-1). "Recommend" language throughout, deliberately: this is advice, not the
 * final organisational decision (that is `LeadershipDecisionStatus`, in features/leadership).
 */
export const RECOMMENDATION_ACTION_LABEL: Record<ImplementationRecommendationAction, string> = {
  RECOMMEND: "Recommend proceeding",
  RECOMMEND_WITH_CONDITIONS: "Recommend proceeding, with conditions",
  DO_NOT_RECOMMEND: "Do not recommend proceeding",
  INSUFFICIENT_DATA: "Not enough to recommend either way",
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

export const MARKET_DIMENSION_LABEL: Record<MarketDimension, string> = {
  MARKET_NEED: "Market need",
  MARKET_OPPORTUNITY: "Opportunity size",
  COMPETITIVE_LANDSCAPE: "Competitive landscape",
  COMPETITIVE_ADVANTAGE: "Competitive advantage",
  COMMERCIAL_VIABILITY: "Commercial viability",
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

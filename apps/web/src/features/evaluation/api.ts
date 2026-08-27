import { useQuery } from "@tanstack/react-query";
import type {
  CriterionGroup, IdeaEvaluationResponse, ListRecommendationsResponse, MaturityLevel,
  RankingEffect, RecommendationState,
} from "@iep/contracts";
import { api } from "../../app/api-client";
import { queryKeys } from "../../app/query-keys";

/**
 * Evaluation and improvement data access (P5).
 *
 * `getIdeaEvaluation` answers 404 for an idea that has not been scored yet, which is not
 * an error worth retrying — the idea simply has not reached the engine. `retry: false`
 * keeps a fresh submission from hammering the API while its analysis runs.
 */

export function useEvaluation(ideaId: string) {
  return useQuery({
    queryKey: queryKeys.ideas.evaluation(ideaId),
    queryFn: () => api<IdeaEvaluationResponse>(`/ideas/${ideaId}/evaluation`),
    enabled: Boolean(ideaId),
    retry: false,
  });
}

export function useRecommendations(ideaId: string) {
  return useQuery({
    queryKey: queryKeys.ideas.recommendations(ideaId),
    queryFn: () => api<ListRecommendationsResponse>(`/ideas/${ideaId}/recommendations`),
    enabled: Boolean(ideaId),
    retry: false,
  });
}

/* ── Labels: the enums are contract, the wording is presentation ── */

export const GROUP_LABEL: Record<CriterionGroup, string> = {
  VALUE: "Value",
  FEASIBILITY: "Feasibility",
  EFFORT: "Effort and cost",
  STRATEGIC: "Strategic fit",
  RISK: "Risk",
  DEMAND: "Demand",
};

/**
 * FR-17 wording. Deliberately describes COMPLETENESS, never quality — "Level 2" must not
 * read as "second-rate". An immature idea is an idea with more to say, not a worse one.
 */
export const MATURITY_LABEL: Record<MaturityLevel, string> = {
  1: "Level 1 — an initial thought",
  2: "Level 2 — the problem and the people are clear",
  3: "Level 3 — with use cases and an approach",
  4: "Level 4 — with evidence behind it",
  5: "Level 5 — planned, with risks and measures",
};

export const RANKING_EFFECT_LABEL: Record<RankingEffect, string> = {
  LIKELY_UP: "Likely to help",
  POSSIBLY_UP: "May help",
  NEUTRAL: "Unlikely to change the score",
  UNKNOWN: "Effect unclear",
};

export const RECOMMENDATION_STATE_LABEL: Record<RecommendationState, string> = {
  OPEN: "Open",
  ADDRESSED: "Addressed",
  DISMISSED: "Dismissed",
};

export const PRIORITY_LABEL: Record<number, string> = {
  1: "Start here",
  2: "Worth doing",
  3: "If you have time",
};

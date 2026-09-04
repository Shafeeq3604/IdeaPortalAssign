import { useQuery } from "@tanstack/react-query";
import type {
  CriterionGroup, IdeaEvaluationResponse, MaturityLevel,
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
 * FR-17's own names, from REQUIREMENTS §20.
 *
 * These were paraphrased while requirements.md was thought to be missing from the repo.
 * The source names them Concept / Defined Problem / Defined Solution / Validated /
 * Implementation Ready, and those are the words the business already uses — a product
 * that renames its own vocabulary makes every conversation about it a translation.
 *
 * The trailing clause stays: FR-17 exists so an immature idea is not read as a poor one,
 * and "Level 2" alone invites exactly that reading.
 */
export const MATURITY_LABEL: Record<MaturityLevel, string> = {
  1: "Level 1 — Concept",
  2: "Level 2 — Defined problem",
  3: "Level 3 — Defined solution",
  4: "Level 4 — Validated",
  5: "Level 5 — Implementation ready",
};

/** What each level means, in the submitter's terms. Shown alongside the label. */
export const MATURITY_HELP: Record<MaturityLevel, string> = {
  1: "A general idea, with limited detail so far.",
  2: "The problem and the people it affects are identified.",
  3: "A proposed solution and its use cases are described.",
  4: "There is evidence of demand, or a prototype.",
  5: "Requirements, resources, risks, costs, timeline and measures are all defined.",
};


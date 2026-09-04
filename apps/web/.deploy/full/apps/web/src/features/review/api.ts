import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateReviewRequest, IdeaEvaluationResponse, ListReviewsResponse, OverrideScoreRequest,
  Review, ReviewDecision, ReviewQueueResponse,
} from "@iep/contracts";
import { api } from "../../app/api-client";
import { invalidateAfter, queryKeys } from "../../app/query-keys";

/**
 * Review, override and audit data access (P6).
 *
 * Neither mutation here is optimistic. Both are audited decisions, and SPEC §8.4 is
 * explicit: the UI must not claim a decision the server has not confirmed. A rolled-back
 * "validated" chip is worse than a slow one.
 */

export function useReviewQueue(filters: { page?: number; sort?: string; departmentId?: string }) {
  return useQuery({
    queryKey: queryKeys.review.queue(filters),
    queryFn: () => {
      const s = new URLSearchParams();
      if (filters.page) s.set("page", String(filters.page));
      if (filters.sort) s.set("sort", filters.sort);
      if (filters.departmentId) s.set("departmentId", filters.departmentId);
      const q = s.toString();
      return api<ReviewQueueResponse>(`/review/queue${q ? `?${q}` : ""}`);
    },
  });
}

export function useReviews(ideaId: string) {
  return useQuery({
    queryKey: queryKeys.ideas.reviews(ideaId),
    queryFn: () => api<ListReviewsResponse>(`/ideas/${ideaId}/reviews`),
    enabled: Boolean(ideaId),
  });
}

export function useCreateReview(ideaId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateReviewRequest) =>
      api<Review>(`/ideas/${ideaId}/reviews`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      for (const key of invalidateAfter.review(ideaId)) {
        void qc.invalidateQueries({ queryKey: key });
      }
    },
  });
}

export function useOverrideScore(ideaId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: OverrideScoreRequest) =>
      api<IdeaEvaluationResponse>(`/ideas/${ideaId}/evaluation/overrides`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      // An override moves the score, the composite, every rank in the cohort, and the
      // audit trail. The factory owns that list so a new call site cannot forget one.
      for (const key of invalidateAfter.scoreOverride(ideaId)) {
        void qc.invalidateQueries({ queryKey: key });
      }
    },
  });
}

export const DECISION_LABEL: Record<ReviewDecision, string> = {
  VALIDATED: "Validated",
  NEEDS_CLARIFICATION: "Needs clarification",
  REJECTED: "Rejected",
  PARKED: "Parked",
  OVERRIDDEN: "Score adjusted",
  APPROVED_FOR_PROTOTYPE: "Approved for a prototype",
};

/**
 * What each decision actually means, shown next to the control.
 *
 * A reviewer picking between three words needs to know the consequence of each, and
 * "Rejected" in particular has to read as a judgement about THIS submission rather than
 * about the person (P-4).
 */
export const DECISION_HELP: Record<ReviewDecision, string> = {
  VALIDATED: "The analysis looks right and the idea is worth carrying forward.",
  NEEDS_CLARIFICATION: "Something is missing. The submitter is asked for more, not turned away.",
  REJECTED: "Not viable as it stands. A reason is required and the submitter will see it.",
  PARKED: "Set aside for now, without a judgement on its merit.",
  OVERRIDDEN: "A criterion score was adjusted by hand.",
  APPROVED_FOR_PROTOTYPE: "Cleared to be built as a prototype.",
};

/**
 * The three a reviewer PICKS.
 *
 * The enum carries six because it also labels decisions other paths record:
 * `OVERRIDDEN` comes from a score adjustment, and `PARKED` /
 * `APPROVED_FOR_PROTOTYPE` are lifecycle moves made through the transition control,
 * where the transition table can authorise them. Offering all six here would let a
 * reviewer "decide" a status change that the lifecycle machine never saw.
 */
export const REVIEWER_DECISIONS: readonly ReviewDecision[] = [
  "VALIDATED", "NEEDS_CLARIFICATION", "REJECTED",
];

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateLeadershipDecisionRequest, LeadershipDecision, LeadershipDecisionStatus,
  ListLeadershipDecisionsResponse,
} from "@iep/contracts";
import { api } from "../../app/api-client";
import { invalidateAfter, queryKeys } from "../../app/query-keys";

/**
 * Leadership decision data access (ADR-026).
 *
 * Not optimistic, same reasoning as `useCreateReview` (features/review/api.ts): this is
 * an audited, final organisational decision, and the UI must not claim it before the
 * server confirms it.
 */

export function useLeadershipDecisions(ideaId: string) {
  return useQuery({
    queryKey: queryKeys.ideas.leadershipDecisions(ideaId),
    queryFn: () => api<ListLeadershipDecisionsResponse>(`/ideas/${ideaId}/leadership-decisions`),
    enabled: Boolean(ideaId),
  });
}

export function useCreateLeadershipDecision(ideaId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateLeadershipDecisionRequest) =>
      api<LeadershipDecision>(`/ideas/${ideaId}/leadership-decisions`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      for (const key of invalidateAfter.leadershipDecision(ideaId)) {
        void qc.invalidateQueries({ queryKey: key });
      }
    },
  });
}

export const DECISION_STATUS_LABEL: Record<LeadershipDecisionStatus, string> = {
  APPROVED: "Approved",
  REJECTED: "Rejected",
  NEEDS_VALIDATION: "Needs further validation",
  OVERRIDE_RECOMMENDATION: "Overriding the AI recommendation",
};

/**
 * What each choice actually commits to, shown next to the control — same reasoning as
 * review/api.ts's `DECISION_HELP`: a person picking between four words needs to know the
 * consequence of each. None of these move the idea's status by themselves (P-3) — that
 * stays a separate, explicit lifecycle transition.
 */
export const DECISION_STATUS_HELP: Record<LeadershipDecisionStatus, string> = {
  APPROVED: "The recommendation is accepted as the basis for moving forward.",
  REJECTED: "Not proceeding, on the basis of this recommendation.",
  NEEDS_VALIDATION: "Not enough yet to decide — more validation is needed first.",
  OVERRIDE_RECOMMENDATION:
    "Proceeding differently from what the AI recommended. State why below.",
};

export const LEADERSHIP_DECISION_STATUSES: readonly LeadershipDecisionStatus[] = [
  "APPROVED", "REJECTED", "NEEDS_VALIDATION", "OVERRIDE_RECOMMENDATION",
];

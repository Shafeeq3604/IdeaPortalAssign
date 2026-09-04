import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FeedbackVote, IdeaFeedbackSummary } from "@iep/contracts";
import { api } from "../../app/api-client";
import { queryKeys } from "../../app/query-keys";

/**
 * Thumbs up and down (FR-18, requirements.md §14).
 *
 * Optimistic, unlike every other mutation in this codebase. Score overrides and review
 * decisions are audited decisions and must confirm server-side before the UI claims them
 * (SPEC §8.4). A reaction is not a decision — it is one person's opinion, it changes no
 * score, and a thumb that waits 200ms before responding feels broken. If the write fails
 * the count rolls back and the button is simply as it was.
 */

export function useFeedback(ideaId: string) {
  return useQuery({
    queryKey: queryKeys.ideas.feedback(ideaId),
    queryFn: () => api<IdeaFeedbackSummary>(`/ideas/${ideaId}/feedback`),
    enabled: Boolean(ideaId),
  });
}

export function useVote(ideaId: string) {
  const qc = useQueryClient();
  const key = queryKeys.ideas.feedback(ideaId);

  return useMutation({
    mutationFn: (vote: FeedbackVote | null) =>
      api<IdeaFeedbackSummary>(`/ideas/${ideaId}/feedback`, {
        method: "POST",
        body: JSON.stringify({ vote }),
      }),

    onMutate: async (vote) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<IdeaFeedbackSummary>(key);
      if (previous) {
        // Move the counts the way the server is about to: remove the old vote, add the
        // new one. Pressing the same thumb twice clears it, which is why `vote` is
        // nullable rather than a toggle the client has to reason about.
        const up = previous.up - (previous.myVote === "UP" ? 1 : 0) + (vote === "UP" ? 1 : 0);
        const down = previous.down - (previous.myVote === "DOWN" ? 1 : 0) + (vote === "DOWN" ? 1 : 0);
        qc.setQueryData<IdeaFeedbackSummary>(key, { ...previous, up, down, myVote: vote });
      }
      return { previous };
    },

    onError: (_error, _vote, context) => {
      // Put it back exactly as it was. A count that stays wrong after a failed write is
      // worse than one that never moved.
      if (context?.previous) qc.setQueryData(key, context.previous);
    },

    // Whatever happened, the server's count is the real one.
    onSettled: () => void qc.invalidateQueries({ queryKey: key }),
  });
}

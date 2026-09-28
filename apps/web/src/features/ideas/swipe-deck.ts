import type { IdeaStatus, IdeaSummary } from "@iep/contracts";

/**
 * P20 "weigh in" — which ideas go in someone's swipe deck (SPEC §14 M4).
 *
 * Ranked-onward ideas only: that is the point where every role can open one (`can(…,
 * "idea:read")`), and where there is something finished to react to. Never your own —
 * the thumb is other people's reaction — and never one you have already voted on, so
 * the deck is always new to you.
 */
export const WEIGH_IN_STATUSES: readonly IdeaStatus[] = [
  "RANKED", "UNDER_REVIEW", "PROTOTYPE_CANDIDATE", "PILOT", "PRODUCTION_CANDIDATE", "IMPLEMENTED",
];

export function swipeDeck(items: readonly IdeaSummary[], userId: string): IdeaSummary[] {
  return items.filter(
    (idea) =>
      WEIGH_IN_STATUSES.includes(idea.status) &&
      idea.submitter.id !== userId &&
      idea.feedback.myVote === null,
  );
}

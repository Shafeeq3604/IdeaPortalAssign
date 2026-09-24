import type { StructuredFeedbackType } from "@iep/contracts";

/**
 * The five `FeedbackType` reasons' wording — split out from `SignalsPanel.tsx` (which
 * pairs each with an icon for its own toggle buttons) so `PersonActivity.tsx` can reuse
 * the exact same words for the same fact without importing a component file for a
 * constant (react-refresh only allows a file to export components).
 */
export const STRUCTURED_FEEDBACK_LABEL: Record<StructuredFeedbackType, string> = {
  HAVE_PROBLEM: "I have this problem",
  SIMILAR_USE_CASE: "I have a similar use case",
  CAN_PROVIDE_DATA: "I can provide data",
  CAN_HELP_IMPLEMENT: "I could help build this",
  HAVE_IMPROVEMENT: "I have a suggestion",
};

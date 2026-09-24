import { z } from "zod";
import { LeadershipDecisionStatus } from "../enums.js";
import { ActorRef, Id, Timestamp } from "./common.js";

/**
 * The final organisational decision (ADR-026).
 *
 * This is the ONLY place in this feature where a decision is recorded — the AI's
 * `ImplementationRecommendation` (analysis.ts) is advisory content a human reads; this is
 * the human act of record. Recording one never transitions `idea.status` on its own
 * (P-3) — moving the idea's lifecycle stays the existing, separately-gated act it already
 * is (`lifecycle.ts`'s `TRANSITIONS` table).
 */

export const LeadershipDecision = z.object({
  id: Id,
  decidedBy: ActorRef,
  /** Which AI recommendation this decision responds to — always named, never implicit. */
  recommendationId: Id,
  status: LeadershipDecisionStatus,
  /** Required, unconditionally — a final organisational decision always states why. */
  rationale: z.string(),
  createdAt: Timestamp,
});
export type LeadershipDecision = z.infer<typeof LeadershipDecision>;

export const CreateLeadershipDecisionRequest = z.object({
  recommendationId: Id,
  status: LeadershipDecisionStatus,
  rationale: z.string().trim().min(1, "A final decision requires a rationale").max(4_000),
});
export type CreateLeadershipDecisionRequest = z.infer<typeof CreateLeadershipDecisionRequest>;

export const ListLeadershipDecisionsResponse = z.object({
  items: z.array(LeadershipDecision),
});
export type ListLeadershipDecisionsResponse = z.infer<typeof ListLeadershipDecisionsResponse>;

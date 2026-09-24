import { z } from "zod";
import { Id, Timestamp } from "./common.js";
import { IdeaStatus, ReviewDecision } from "../enums.js";

/**
 * Organisational analytics (P14 — FR-27, and the "M2 full" half of FR-26).
 *
 * SPEC gives P14 one line — "Analytics & reporting · Depends on: P4 runs, P8 version
 * history, P6 audit" — and no §9 acceptance criteria. Every section below is therefore
 * traceable to exactly one of those three dependencies or to a named, not-yet-built item
 * of REQUIREMENTS §18/§19 ("Ideas by status", "Impact vs effort"); nothing here is an
 * invented metric, threshold or target. REQUIREMENTS §32 lists "large numbers of
 * dashboard charts" as a thing NOT to build, so this stays one page of a few figures.
 *
 * Every figure that counts ideas carries an `href` to a list that shows the same ideas —
 * the §6.2 row 40 promise the dashboard tiles already keep ("a tile's count and the page
 * it opens must agree"). That is also why there is no date-range filter: `listIdeas` has
 * no date filter, so a date-scoped count could not link to a list that agrees with it.
 */

export const AnalyticsQuery = z.object({
  departmentId: Id.optional(),
  categoryId: Id.optional(),
});
export type AnalyticsQuery = z.infer<typeof AnalyticsQuery>;

/** REQUIREMENTS §18 "Ideas by status". Non-DRAFT ideas only — a draft is not yet shared. */
export const AnalyticsStatusCount = z.object({
  status: IdeaStatus,
  count: z.number().int().min(0),
  href: z.string(),
});
export type AnalyticsStatusCount = z.infer<typeof AnalyticsStatusCount>;

/** Submissions per calendar month (UTC), oldest first, last 12 months, zero-filled. */
export const AnalyticsMonthCount = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  count: z.number().int().min(0),
});
export type AnalyticsMonthCount = z.infer<typeof AnalyticsMonthCount>;

/**
 * Participation per department. "Advanced" = reached a human-approved delivery stage
 * (PROTOTYPE_CANDIDATE, PILOT, PRODUCTION_CANDIDATE, IMPLEMENTED) — the same four stages
 * the dashboard's outcome tiles already count, not a new definition of success.
 */
export const AnalyticsDepartmentRow = z.object({
  departmentId: Id.nullable(),
  name: z.string(),
  ideas: z.number().int().min(0),
  contributors: z.number().int().min(0),
  reviewed: z.number().int().min(0),
  advanced: z.number().int().min(0),
  /** Null for the "No department" row — `/ideas` has no "unassigned" filter to link to. */
  href: z.string().nullable(),
});
export type AnalyticsDepartmentRow = z.infer<typeof AnalyticsDepartmentRow>;

export const AnalyticsCategoryRow = z.object({
  categoryId: Id.nullable(),
  label: z.string(),
  ideas: z.number().int().min(0),
  /** Null for the "Uncategorised" row, for the same reason. */
  href: z.string().nullable(),
});
export type AnalyticsCategoryRow = z.infer<typeof AnalyticsCategoryRow>;

/**
 * Lifecycle cycle times: `ideas.submitted_at` (P2) → first `evaluations` row (P4) → first
 * `reviews` row (P6); delivery stage from `status_history`. The worker's own
 * SUBMITTED→EVALUATED move writes no `status_history` row, so the first score is read from
 * `evaluations` instead of guessed from a transition that is not recorded. A median,
 * never a mean — one idea parked for a year must not make the whole pipeline look slow.
 * `medianDays` is null when `sampleSize` is 0: no data is said as no data, never as 0.
 */
export const AnalyticsCycleTimeKey = z.enum([
  "SUBMITTED_TO_FIRST_SCORE",
  "FIRST_SCORE_TO_FIRST_REVIEW",
  "SUBMITTED_TO_DELIVERY_STAGE",
]);
export type AnalyticsCycleTimeKey = z.infer<typeof AnalyticsCycleTimeKey>;

export const AnalyticsCycleTime = z.object({
  key: AnalyticsCycleTimeKey,
  label: z.string(),
  medianDays: z.number().min(0).nullable(),
  sampleSize: z.number().int().min(0),
});
export type AnalyticsCycleTime = z.infer<typeof AnalyticsCycleTime>;

/** Human review activity (P6). */
export const AnalyticsReviewActivity = z.object({
  reviews: z.number().int().min(0),
  byDecision: z.array(z.object({ decision: ReviewDecision, count: z.number().int().min(0) })),
  scoreOverrides: z.number().int().min(0),
  leadershipDecisions: z.number().int().min(0),
});
export type AnalyticsReviewActivity = z.infer<typeof AnalyticsReviewActivity>;

/**
 * Re-evaluation outcomes (P8): for every idea with more than one scored version, the
 * DEFAULT profile's composite of its first scored version against its current one.
 * "Unchanged" is an exact tie at the stored 3-decimal precision — no tolerance band is
 * invented here.
 */
export const AnalyticsRevisions = z.object({
  profileName: z.string().nullable(),
  revisedIdeas: z.number().int().min(0),
  improved: z.number().int().min(0),
  declined: z.number().int().min(0),
  unchanged: z.number().int().min(0),
  medianCompositeDelta: z.number().nullable(),
});
export type AnalyticsRevisions = z.infer<typeof AnalyticsRevisions>;

/**
 * REQUIREMENTS §19 "Impact vs effort", from the latest ranking run (P4).
 *
 * `impact` = plain mean of the idea's VALUE-group normalised criterion scores; `ease` =
 * plain mean of its EFFORT-group ones. Both are 0–100 engine numbers already stored on
 * `criterion_scores` — the engine applies each criterion's direction before storing
 * (`implementation_effort` is LOWER_IS_BETTER, so a high normalised value means LESS
 * effort), which is why the axis is called ease rather than effort. Unweighted on
 * purpose: a profile's weights decide rank, not what a group's own score is.
 */
export const AnalyticsImpactPoint = z.object({
  ideaId: Id,
  title: z.string(),
  rank: z.number().int().min(1),
  impact: z.number().min(0).max(100),
  ease: z.number().min(0).max(100),
  href: z.string(),
});
export type AnalyticsImpactPoint = z.infer<typeof AnalyticsImpactPoint>;

export const AnalyticsImpactVsEffort = z.object({
  runId: Id.nullable(),
  profileName: z.string().nullable(),
  computedAt: Timestamp.nullable(),
  points: z.array(AnalyticsImpactPoint).max(200),
});
export type AnalyticsImpactVsEffort = z.infer<typeof AnalyticsImpactVsEffort>;

export const AnalyticsResponse = z.object({
  generatedAt: Timestamp,
  totalIdeas: z.number().int().min(0),
  statusBreakdown: z.array(AnalyticsStatusCount),
  submissionsByMonth: z.array(AnalyticsMonthCount).length(12),
  byDepartment: z.array(AnalyticsDepartmentRow),
  byCategory: z.array(AnalyticsCategoryRow),
  cycleTimes: z.array(AnalyticsCycleTime),
  reviewActivity: AnalyticsReviewActivity,
  revisions: AnalyticsRevisions,
  impactVsEffort: AnalyticsImpactVsEffort,
});
export type AnalyticsResponse = z.infer<typeof AnalyticsResponse>;

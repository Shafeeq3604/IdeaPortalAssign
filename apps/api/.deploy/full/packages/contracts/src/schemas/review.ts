import { z } from "zod";
import { IdeaStatus, ReviewDecision, Role } from "../enums.js";
import { ActorRef, DepartmentRef, Id, PageQuery, Timestamp, paginated, queryArray } from "./common.js";

/** Human review, audit and admin read surfaces (FR-22, FR-29). */

export const Review = z.object({
  id: Id,
  reviewer: ActorRef,
  decision: ReviewDecision,
  comment: z.string().nullable(),
  createdAt: Timestamp,
});
export type Review = z.infer<typeof Review>;

export const CreateReviewRequest = z
  .object({
    decision: ReviewDecision,
    comment: z.string().trim().max(4_000).optional(),
  })
  .refine((v) => v.decision !== "REJECTED" || (v.comment?.trim().length ?? 0) > 0, {
    path: ["comment"],
    // FR-23: "Rejected with Reason". Rejected at the boundary, and by a DB CHECK.
    message: "A rejection requires a reason",
  });
export type CreateReviewRequest = z.infer<typeof CreateReviewRequest>;

export const ReviewQueueItem = z.object({
  ideaId: Id,
  title: z.string(),
  status: IdeaStatus,
  submitter: ActorRef,
  department: DepartmentRef.nullable(),
  rank: z.number().int().min(1).nullable(),
  compositeScore: z.number().min(0).max(100).nullable(),
  submittedAt: Timestamp.nullable(),
  /** How long it has been waiting — the queue is ordered by this by default. */
  waitingDays: z.number().int().min(0),
  hasUnvalidatedAi: z.boolean(),
});
export type ReviewQueueItem = z.infer<typeof ReviewQueueItem>;

export const ReviewQueueQuery = PageQuery.extend({
  status: queryArray(z.array(IdeaStatus)).optional(),
  departmentId: Id.optional(),
  sort: z.enum(["oldest", "recent", "rank"]).default("oldest"),
});
export type ReviewQueueQuery = z.infer<typeof ReviewQueueQuery>;

export const ReviewQueueResponse = paginated(ReviewQueueItem);
export type ReviewQueueResponse = z.infer<typeof ReviewQueueResponse>;

export const ListReviewsResponse = z.object({ items: z.array(Review) });
export type ListReviewsResponse = z.infer<typeof ListReviewsResponse>;

/* ── Audit (FR-29) ── */

export const AuditEntry = z.object({
  id: Id,
  actor: ActorRef.nullable(),
  action: z.string(),
  entityType: z.string(),
  entityId: Id,
  /** Free-form snapshots — shape varies by entity, so `unknown` is honest here. */
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  reason: z.string().nullable(),
  requestId: z.string().nullable(),
  at: Timestamp,
  /** Canonical route for the subject, so every audit row links out (SPEC §6.2 row 44). */
  entityHref: z.string().nullable(),
  /**
   * What the subject is called — an idea's current title, a person's name. Additive
   * (optional): the Subject column said only "idea" on every row, so a page of the log
   * could not answer "which idea?" without opening each one. Null when the subject no
   * longer exists (the log outlives what it describes); `entityHref` is then null too.
   */
  entityLabel: z.string().nullable().optional(),
});
export type AuditEntry = z.infer<typeof AuditEntry>;

export const AuditQuery = PageQuery.extend({
  entityType: z.string().max(64).optional(),
  entityId: Id.optional(),
  actorId: Id.optional(),
  action: z.string().max(64).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
});
export type AuditQuery = z.infer<typeof AuditQuery>;

export const AuditResponse = paginated(AuditEntry);
export type AuditResponse = z.infer<typeof AuditResponse>;

/* ── Admin: users (read-only in M1) ── */

export const AdminUser = z.object({
  id: Id,
  displayName: z.string(),
  email: z.string().email(),
  roles: z.array(Role),
  department: DepartmentRef.nullable(),
  isActive: z.boolean(),
  ideaCount: z.number().int().min(0),
});
export type AdminUser = z.infer<typeof AdminUser>;

export const AdminUsersQuery = PageQuery.extend({
  q: z.string().trim().max(200).optional(),
  role: Role.optional(),
  departmentId: Id.optional(),
});
export type AdminUsersQuery = z.infer<typeof AdminUsersQuery>;

export const AdminUsersResponse = paginated(AdminUser);
export type AdminUsersResponse = z.infer<typeof AdminUsersResponse>;

/* ── Management dashboard (FR-26) — the nine counts of REQUIREMENTS §29 ── */

export const DashboardTile = z.object({
  key: z.string(),
  label: z.string(),
  count: z.number().int().min(0),
  /** Every tile is a link (SPEC §6.2 row 40) — the destination is part of the contract. */
  href: z.string(),
});
export type DashboardTile = z.infer<typeof DashboardTile>;

/**
 * One point on the board's own history — a real past `RankingRun`, not a derived or
 * interpolated figure. `cohortSize`/`topScore` are exactly what that run's own entries
 * say (design-audit finding: the dashboard had no time dimension at all — a management
 * summary that only ever shows "now" — and the fix has to be actual stored history, not
 * an invented trend line; `RankingRun` has carried `computedAt` since P0, this is the
 * first thing to read it back across more than one row).
 */
export const DashboardHistoryPoint = z.object({
  runId: Id,
  computedAt: Timestamp,
  cohortSize: z.number().int().min(0),
  topScore: z.number().min(0).max(100).nullable(),
});
export type DashboardHistoryPoint = z.infer<typeof DashboardHistoryPoint>;

export const DashboardResponse = z.object({
  tiles: z.array(DashboardTile).min(9),
  generatedAt: Timestamp,
  /**
   * Oldest first, capped defensively — the handler always trims to the most recent
   * runs for THIS scope (profile/department), so a fresh environment with one run
   * legitimately returns an array of length 1, not padding to look fuller than it is.
   */
  history: z.array(DashboardHistoryPoint).max(12),
});
export type DashboardResponse = z.infer<typeof DashboardResponse>;

/* ── Sign-in and account management (ADR-023, FR-01) ── */

export const LoginRequest = z.object({
  email: z.string().trim().email("That does not look like an email address"),
  password: z.string().min(1, "Enter your password"),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

/**
 * Creating a user does NOT take a password hash, and no response anywhere returns one.
 * The admin sets an initial password, the API hashes it, and it is never readable again.
 */
export const CreateUserRequest = z.object({
  email: z.string().trim().email(),
  displayName: z.string().trim().min(1).max(120),
  roles: z.array(Role).min(1, "Every account needs at least one role"),
  departmentId: Id.nullable().optional(),
  initialPassword: z.string().min(12, "Use at least 12 characters"),
});
export type CreateUserRequest = z.infer<typeof CreateUserRequest>;

export const UpdateUserRequest = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  roles: z.array(Role).min(1).optional(),
  departmentId: Id.nullable().optional(),
  /** Deactivate rather than delete: audit_log references users and is append-only. */
  isActive: z.boolean().optional(),
  /** Set a new password for someone locked out. There is no self-service reset in M1. */
  newPassword: z.string().min(12).optional(),
});
export type UpdateUserRequest = z.infer<typeof UpdateUserRequest>;

/* ── Feedback (FR-18) ── */

/**
 * Deliberately two values, not a rating.
 *
 * REQUIREMENTS §32 warns against "complex voting systems" and §16 says popularity must not
 * directly determine ranking. A five-star scale invites both mistakes; a thumb is a signal
 * of interest, and it stays out of the scoring engine entirely.
 */
export const FeedbackVote = z.enum(["UP", "DOWN"]);
export type FeedbackVote = z.infer<typeof FeedbackVote>;

export const IdeaFeedbackSummary = z.object({
  ideaId: Id,
  up: z.number().int().min(0),
  down: z.number().int().min(0),
  /** What the signed-in person voted, so the control can show its own state. */
  myVote: FeedbackVote.nullable(),
});
export type IdeaFeedbackSummary = z.infer<typeof IdeaFeedbackSummary>;

export const SetFeedbackRequest = z.object({
  /** null clears the vote — pressing the same thumb twice takes it back. */
  vote: FeedbackVote.nullable(),
});
export type SetFeedbackRequest = z.infer<typeof SetFeedbackRequest>;

/*
 * Structured feedback (FR-18, "feedback types" — SPEC line 87/P11). The P0-frozen
 * `Feedback` table already reserves five more `FeedbackType` values beyond the two
 * (`WOULD_USE`/`SEE_RISK`) the thumb vote above already uses — this exposes them.
 *
 * Deliberately NOT a comment thread: `Feedback` has `@@unique([ideaId, userId, type])`, so
 * one person states each reason at most once per idea, with an optional note — there is no
 * reply, no second post, no back-and-forth. That is a schema constraint, not a UI choice
 * (an actual product decision made explicitly rather than assumed — see CONTRACT-LOG).
 *
 * Still just a signal, same as the vote above and for the same reason: each type is a
 * present/absent toggle, never a rating or a weighted scale, so this stays the kind of
 * structured reaction REQUIREMENTS §32 allows ("complex voting systems" is the five-star
 * scale it warns against, not a second yes/no reason).
 *
 * UPDATE (P11, FR-19): unlike the thumb vote above — which REQUIREMENTS §14 explicitly
 * keeps out of the ranking ("popularity must not directly determine the ranking") — this
 * IS now read by the scoring engine, as the `demonstrated_demand` criterion's evidence
 * (packages/evaluation/src/factors.ts's `buildDemandSignal`). The distinction that makes
 * this different from the vote, not a quiet reversal of the same rule: a structured
 * reason is a person stating a concrete stake (has the problem, can provide data, can
 * help implement it) — the "real people want this" evidence the criterion's own
 * description asks for — not an opinion about the idea's quality, which is what the
 * thumb vote is and why it stays excluded. The criterion is seeded at weight 0 in every
 * profile regardless (packages/contracts/src/criteria.ts) — it only ever counts once an
 * admin deliberately turns it on via P10's weight-editing UI.
 */
export const StructuredFeedbackType = z.enum([
  "HAVE_PROBLEM",
  "SIMILAR_USE_CASE",
  "CAN_PROVIDE_DATA",
  "CAN_HELP_IMPLEMENT",
  "HAVE_IMPROVEMENT",
]);
export type StructuredFeedbackType = z.infer<typeof StructuredFeedbackType>;

export const IdeaSignalEntry = z.object({
  id: Id,
  type: StructuredFeedbackType,
  comment: z.string().nullable(),
  createdAt: z.string(),
  submitter: z.object({ id: Id, displayName: z.string() }),
});
export type IdeaSignalEntry = z.infer<typeof IdeaSignalEntry>;

export const IdeaSignalsSummary = z.object({
  ideaId: Id,
  /** Every active entry, across everyone, newest first — the "what people said" list. */
  entries: z.array(IdeaSignalEntry),
  /** Which types the signed-in person currently has active, so the toggles show their
   *  own state without scanning `entries` for a matching `submitter.id` on the client. */
  mine: z.array(StructuredFeedbackType),
});
export type IdeaSignalsSummary = z.infer<typeof IdeaSignalsSummary>;

export const SetIdeaSignalRequest = z.object({
  type: StructuredFeedbackType,
  /** false removes the entry entirely (comment included) — same "press it again to take
   *  it back" shape as the vote's `null`. */
  active: z.boolean(),
  /** Ignored when `active` is false. Trimmed empty string is treated as "no note", same
   *  as never having typed one. */
  comment: z.string().trim().max(500).nullable().optional(),
});
export type SetIdeaSignalRequest = z.infer<typeof SetIdeaSignalRequest>;

/* ── Self-registration (FR-01a, ADR-023 amendment) ── */

/**
 * Signing yourself up.
 *
 * Note what is NOT here: `roles`. A self-registered account is an EMPLOYEE and nothing
 * else, and the field to ask for more does not exist in the contract — so no request can
 * carry it, no handler can read it, and no future refactor can accidentally honour it.
 *
 * `inviteCode` is the ONE exception, and it is deliberately not a role either. It is a
 * shared secret that only does anything while the platform has no administrator at all;
 * see `SignupRequest.inviteCode` in the API handler for why that window closes for good.
 */
export const SignupRequest = z.object({
  displayName: z.string().trim().min(1, "Tell us your name").max(120),
  email: z.string().trim().email("That does not look like an email address"),
  password: z.string().min(12, "Use at least 12 characters — a short phrase works well"),
  /** Only meaningful during first-run bootstrap. Absent in every ordinary signup. */
  inviteCode: z.string().trim().min(1).max(200).optional(),
});
export type SignupRequest = z.infer<typeof SignupRequest>;

/**
 * What the signup form needs to know before anyone types anything, without being signed
 * in. Deliberately two booleans and no data: it says whether the door is open, not who
 * is inside.
 */
export const SignupOptions = z.object({
  /** False when the organisation has turned self-registration off. */
  enabled: z.boolean(),
  /**
   * The email domains that may register, for the form to say so up front rather than
   * rejecting someone after they have typed a password. Empty = no restriction.
   */
  allowedEmailDomains: z.array(z.string()),
  /**
   * True only while the platform has no administrator — the first-run window in which an
   * invite code can create one. Public because it is only ever true on an installation
   * that has no accounts, no ideas and nothing to protect yet.
   */
  adminBootstrapAvailable: z.boolean(),
});
export type SignupOptions = z.infer<typeof SignupOptions>;

/* ── Personal activity: profile summary + contribution timeline (SPEC §6.1 person page) ──
 *
 * Everything here is a plain count or a plain past event, on purpose (design-review
 * request: "personal activity summary" and "contribution history," explicitly not
 * points/levels/badges/streaks — REQUIREMENTS §32). Every figure is something that
 * already happened and is already stored (ideas, `Feedback`, `Review`,
 * `LeadershipDecision`) — no new fact is invented, and none of it is a score, weight or
 * rank (P-1).
 */

export const PersonActivityEventType = z.enum([
  "IDEA_SUBMITTED",
  "FEEDBACK_GIVEN",
  "REVIEW_GIVEN",
  "DECISION_RECORDED",
]);
export type PersonActivityEventType = z.infer<typeof PersonActivityEventType>;

export const PersonActivityEntry = z.object({
  id: Id,
  type: PersonActivityEventType,
  at: Timestamp,
  idea: z.object({ id: Id, title: z.string() }),
  /**
   * The event's own kind of detail, as its raw contract value — a `FeedbackType`, a
   * `ReviewDecision`, a `LeadershipDecisionStatus` — never a label. Labelling is
   * presentation (same split as `STATUS_LABEL`/`DECISION_LABEL` on the client), and
   * keeping it out of the contract means one wording change, not two.
   */
  detail: z.string().nullable(),
});
export type PersonActivityEntry = z.infer<typeof PersonActivityEntry>;

export const PersonActivitySummary = z.object({
  userId: Id,
  counts: z.object({
    ideasSubmitted: z.number().int().min(0),
    feedbackGiven: z.number().int().min(0),
    reviewsGiven: z.number().int().min(0),
    decisionsRecorded: z.number().int().min(0),
  }),
  /**
   * Newest first across all four event kinds, capped — a profile page, not an audit
   * export (`AuditResponse` already covers the unbounded, paginated case for
   * ADMIN/REVIEWER). Counts above are the true totals; this is a recent sample of them.
   */
  entries: z.array(PersonActivityEntry).max(50),
});
export type PersonActivitySummary = z.infer<typeof PersonActivitySummary>;

/* ── Departments, for the admin's account forms ── */

/**
 * A flat list, not the tree. The only question the account forms ask is "which one",
 * and a hierarchy that nothing renders is a hierarchy that will drift.
 */
export const DepartmentListResponse = z.object({
  items: z.array(DepartmentRef),
});
export type DepartmentListResponse = z.infer<typeof DepartmentListResponse>;

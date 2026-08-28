import { z } from "zod";
import { IdeaStatus, ReviewDecision, Role } from "../enums.js";
import { ActorRef, DepartmentRef, Id, PageQuery, Timestamp, paginated } from "./common.js";

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
  status: z.array(IdeaStatus).optional(),
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

export const DashboardResponse = z.object({
  tiles: z.array(DashboardTile).min(9),
  generatedAt: Timestamp,
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

/* ── Departments, for the admin's account forms ── */

/**
 * A flat list, not the tree. The only question the account forms ask is "which one",
 * and a hierarchy that nothing renders is a hierarchy that will drift.
 */
export const DepartmentListResponse = z.object({
  items: z.array(DepartmentRef),
});
export type DepartmentListResponse = z.infer<typeof DepartmentListResponse>;

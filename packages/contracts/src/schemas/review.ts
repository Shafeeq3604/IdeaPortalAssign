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

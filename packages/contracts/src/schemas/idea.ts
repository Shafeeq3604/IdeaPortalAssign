import { z } from "zod";
import { IdeaStatus, MaturityLevel, Role } from "../enums.js";
import { ActorRef, CategoryRef, DepartmentRef, Id, PageQuery, Timestamp, paginated } from "./common.js";

/** Idea capture, versioning and lifecycle (FR-02, FR-16, FR-23, FR-24). */

/* ── Field limits mirror the DB CHECK constraints exactly (SPEC §5.2).
      Client and server reject the same input, and so does Postgres. ── */
const Title = z.string().trim().min(1).max(200);
const Description = z.string().trim().min(1).max(20_000);
const ShortField = z.string().trim().min(1).max(2_000);
const OptionalField = z.string().trim().max(2_000).nullable();

export const IdeaVersionInput = z.object({
  // The six required fields of FR-02
  title: Title,
  description: Description,
  problemStatement: ShortField,
  expectedUsers: ShortField,
  expectedOutcome: ShortField,
  // Optional — absence drives `missingInformation` and the maturity level, not rejection
  existingProcess: OptionalField.optional(),
  existingSolutions: OptionalField.optional(),
  suggestedTechnology: OptionalField.optional(),
  expectedBenefits: OptionalField.optional(),
  estimatedCostNote: OptionalField.optional(),
  references: OptionalField.optional(),
  departmentId: Id.nullable().optional(),
  categoryId: Id.nullable().optional(),
});
export type IdeaVersionInput = z.infer<typeof IdeaVersionInput>;

export const CreateIdeaRequest = IdeaVersionInput.extend({
  /** false → save as DRAFT; true → straight to SUBMITTED and start analysis. */
  submit: z.boolean().default(false),
});
export type CreateIdeaRequest = z.infer<typeof CreateIdeaRequest>;

/** A draft may be edited in place. A submitted idea may not — it gets a new version. */
export const UpdateDraftRequest = IdeaVersionInput.partial();
export type UpdateDraftRequest = z.infer<typeof UpdateDraftRequest>;

export const CreateVersionRequest = IdeaVersionInput.extend({
  /** Mandatory from v2 onward — DB CHECK enforces it too (FR-24). */
  changeSummary: z.string().trim().min(1).max(2_000),
  /** Recommendations this revision claims to address; resolved on re-evaluation. */
  addressesRecommendationIds: z.array(Id).max(20).default([]),
});
export type CreateVersionRequest = z.infer<typeof CreateVersionRequest>;

export const IdeaVersionSummary = z.object({
  id: Id,
  versionNo: z.number().int().min(1),
  title: Title,
  changeSummary: z.string().nullable(),
  author: ActorRef,
  createdAt: Timestamp,
});
export type IdeaVersionSummary = z.infer<typeof IdeaVersionSummary>;

export const IdeaVersionDetail = IdeaVersionSummary.extend({
  description: z.string(),
  problemStatement: z.string(),
  expectedUsers: z.string(),
  expectedOutcome: z.string(),
  existingProcess: z.string().nullable(),
  existingSolutions: z.string().nullable(),
  suggestedTechnology: z.string().nullable(),
  expectedBenefits: z.string().nullable(),
  estimatedCostNote: z.string().nullable(),
  references: z.string().nullable(),
  attachments: z.array(
    z.object({ id: Id, filename: z.string(), mime: z.string(), bytes: z.number().int() }),
  ),
});
export type IdeaVersionDetail = z.infer<typeof IdeaVersionDetail>;

export const IdeaSummary = z.object({
  id: Id,
  title: Title,
  status: IdeaStatus,
  maturityLevel: MaturityLevel.nullable(),
  submitter: ActorRef,
  department: DepartmentRef.nullable(),
  category: CategoryRef.nullable(),
  currentVersionNo: z.number().int().min(1),
  submittedAt: Timestamp.nullable(),
  updatedAt: Timestamp,
  /** Present once ranked. Rank without explanation is never returned (P-2). */
  rank: z.number().int().min(1).nullable(),
  compositeScore: z.number().min(0).max(100).nullable(),
});
export type IdeaSummary = z.infer<typeof IdeaSummary>;

export const IdeaDetail = IdeaSummary.extend({
  currentVersion: IdeaVersionDetail,
  versionCount: z.number().int().min(1),
  openRecommendationCount: z.number().int().min(0),
  /** What THIS actor may do — so the UI never renders a control the API will refuse. */
  permissions: z.object({
    canEdit: z.boolean(),
    canSubmit: z.boolean(),
    canRevise: z.boolean(),
    canReview: z.boolean(),
    canOverrideScores: z.boolean(),
    allowedTransitions: z.array(IdeaStatus),
  }),
});
export type IdeaDetail = z.infer<typeof IdeaDetail>;

export const ListIdeasQuery = PageQuery.extend({
  status: z.array(IdeaStatus).optional(),
  departmentId: Id.optional(),
  categoryId: Id.optional(),
  submitterId: Id.optional(),
  q: z.string().trim().max(200).optional(),
  sort: z.enum(["recent", "oldest", "title", "status", "rank"]).default("recent"),
});
export type ListIdeasQuery = z.infer<typeof ListIdeasQuery>;

export const ListIdeasResponse = paginated(IdeaSummary);
export type ListIdeasResponse = z.infer<typeof ListIdeasResponse>;

export const ListVersionsResponse = z.object({ items: z.array(IdeaVersionSummary) });
export type ListVersionsResponse = z.infer<typeof ListVersionsResponse>;

/** Lifecycle transition. `reason` is required for the transitions that demand it. */
export const TransitionRequest = z.object({
  to: IdeaStatus,
  reason: z.string().trim().max(2_000).optional(),
});
export type TransitionRequest = z.infer<typeof TransitionRequest>;

export const StatusHistoryEntry = z.object({
  id: Id,
  fromStatus: IdeaStatus.nullable(),
  toStatus: IdeaStatus,
  actor: ActorRef,
  reason: z.string().nullable(),
  at: Timestamp,
});
export type StatusHistoryEntry = z.infer<typeof StatusHistoryEntry>;

/** History tab: versions + status lane + evaluation deltas in one payload (FR-24). */
export const IdeaHistoryResponse = z.object({
  versions: z.array(
    IdeaVersionSummary.extend({
      compositeScore: z.number().nullable(),
      rank: z.number().int().nullable(),
      maturityLevel: MaturityLevel.nullable(),
    }),
  ),
  statusHistory: z.array(StatusHistoryEntry),
});
export type IdeaHistoryResponse = z.infer<typeof IdeaHistoryResponse>;

export const SessionUser = z.object({
  id: Id,
  displayName: z.string(),
  email: z.string().email(),
  roles: z.array(Role).min(1),
  department: DepartmentRef.nullable(),
});
export type SessionUser = z.infer<typeof SessionUser>;

export const SessionResponse = z.object({ user: SessionUser });
export type SessionResponse = z.infer<typeof SessionResponse>;

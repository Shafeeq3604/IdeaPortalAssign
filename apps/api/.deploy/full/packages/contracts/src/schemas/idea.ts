import { z } from "zod";
import { IdeaStatus, MaturityLevel, Role } from "../enums.js";
import {
  ActorRef, CategoryRef, DepartmentRef, Id, PageQuery, Timestamp, paginated, queryArray,
} from "./common.js";
import { FeedbackVote } from "./review.js";

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
  /** First-class, not folded into `description` (platform-transformation brief §7) —
   *  real structured data future strategic analysis, discovery, filtering, categorisation
   *  and reporting can read directly rather than re-extracting from prose. */
  useCases: z.array(z.string().trim().min(1).max(300)).max(10).default([]),
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
  useCases: z.array(z.string()),
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
  /**
   * Vote totals and the caller's own vote, inline on every list row (SPC-14.1, 2026-09-09).
   *
   * Additive: a list item now carries what `GET /ideas/{id}/feedback` already returned,
   * so `IdeaCard` (apps/web/src/features/ideas/IdeaListPage.tsx) reads it from the row it
   * already has instead of firing its own `useFeedback(ideaId)` per card — the difference
   * between one request per page and one request per idea shown on it.
   */
  feedback: z.object({
    up: z.number().int().min(0),
    down: z.number().int().min(0),
    myVote: FeedbackVote.nullable(),
  }),
  /** P18 — comments people can read (visible ones only), batched like `feedback`. */
  commentCount: z.number().int().min(0),
});
export type IdeaSummary = z.infer<typeof IdeaSummary>;

/**
 * FR-20 (P12, AI-10). Deliberately no exposed technical detail (REQUIREMENTS §15: "Do not
 * expose similarity/AI technical details") — `differenceSummary` is plain language, and
 * `similarity` is carried for a reviewer/admin view, not the plain "We found a similar
 * idea" employee-facing banner (the web client chooses what to render per role; see
 * `IdeaDetail.permissions.canSeeMatchScores`).
 */
export const SimilarIdeaRef = z.object({
  ideaId: Id,
  title: Title,
  similarity: z.number().min(0).max(1),
  differenceSummary: z.string().nullable(),
});
export type SimilarIdeaRef = z.infer<typeof SimilarIdeaRef>;

/**
 * FR-21 (P12, AI-11). Advisory only — never gates a status transition (structural rule,
 * §12.2). `recommendation`/`rationale`/`confidence` are null when the non-AI fallback ran
 * (catalogue lookup by category, no model call) or when embeddings found no match at all.
 */
export const ExistingSolutionAssessmentRef = z.object({
  recommendation: z.enum(["BUILD", "BUY", "EXTEND", "INTEGRATE"]).nullable(),
  rationale: z.string().nullable(),
  confidence: z.enum(["LOW", "MEDIUM", "HIGH"]).nullable(),
  matches: z.array(
    z.object({ name: z.string(), kind: z.string(), similarity: z.number().min(0).max(1) }),
  ),
});
export type ExistingSolutionAssessmentRef = z.infer<typeof ExistingSolutionAssessmentRef>;

export const IdeaDetail = IdeaSummary.extend({
  currentVersion: IdeaVersionDetail,
  versionCount: z.number().int().min(1),
  openRecommendationCount: z.number().int().min(0),
  /** Empty until analysis has run once; empty is a valid, common outcome, not a loading
   *  state (most ideas match nothing). */
  similarIdeas: z.array(SimilarIdeaRef),
  /** Null until analysis has run once. Present-but-empty `matches` is also valid — see
   *  the field's own doc comment. */
  existingSolutionAssessment: ExistingSolutionAssessmentRef.nullable(),
  /** What THIS actor may do — so the UI never renders a control the API will refuse. */
  permissions: z.object({
    canEdit: z.boolean(),
    canSubmit: z.boolean(),
    canRevise: z.boolean(),
    canReview: z.boolean(),
    canOverrideScores: z.boolean(),
    /** ADR-026 — may record the final organisational decision on an AI recommendation. */
    canDecideLeadership: z.boolean(),
    allowedTransitions: z.array(IdeaStatus),
    /**
     * FR-21's build/buy/extend/integrate call is internal decision support, not
     * employee-facing content (REQUIREMENTS §15 draws the same line for FR-20's raw
     * score) — REVIEWER/ADMIN/MANAGEMENT see `existingSolutionAssessment` and
     * `similarIdeas[].similarity`; a plain EMPLOYEE sees the similar-idea banner in prose
     * only ("We found a similar idea"), never the number behind it.
     */
    canSeeMatchDetail: z.boolean(),
    /** P18 — may post a comment (readable, and neither a draft nor archived). */
    canComment: z.boolean(),
  }),
  /** P18 — whether the signed-in person follows it, and how many do. The owner is never
   *  counted as a follower: they hear about their own idea regardless. */
  social: z.object({
    following: z.boolean(),
    followerCount: z.number().int().min(0),
  }),
});
export type IdeaDetail = z.infer<typeof IdeaDetail>;

export const ListIdeasQuery = PageQuery.extend({
  status: queryArray(z.array(IdeaStatus)).optional(),
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

/* ── Attachments (FR-02, SPEC §4.3) ── */

/**
 * The three types an idea may carry, and the magic bytes that prove it.
 *
 * SPEC §4.3: "MIME sniffed from magic bytes (never the extension)". The extension is a
 * claim by whoever named the file; the leading bytes are the file. §9.2 makes it an
 * acceptance criterion — a `.exe` renamed to `.pdf` must be refused.
 *
 * DOCX has no signature of its own: it is a ZIP, so it shares `PK\x03\x04` with every
 * other ZIP including a JAR. The sniffer checks the container AND that it holds the
 * `word/` entry an OOXML document must have.
 */
export const ATTACHMENT_TYPES = [
  { mime: "application/pdf", extension: ".pdf", label: "PDF" },
  {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    extension: ".docx",
    label: "Word document",
  },
  { mime: "text/plain", extension: ".txt", label: "Plain text" },
] as const;

export const AttachmentMime = z.enum([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);
export type AttachmentMime = z.infer<typeof AttachmentMime>;

/** SPEC §4.3. Both are hard limits, enforced server-side before anything is written. */
export const MAX_ATTACHMENTS_PER_VERSION = 10;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export const Attachment = z.object({
  id: Id,
  /**
   * The name as uploaded, for display only.
   *
   * NEVER a path. The bytes are stored under a generated key and this string is not used
   * to build one — SPEC §4.3, "stored outside the web root under generated names".
   */
  filename: z.string(),
  mime: AttachmentMime,
  bytes: z.number().int().min(0),
  uploadedBy: ActorRef,
  createdAt: Timestamp,
  /** Where to fetch it. An authorising endpoint, never a static path (§4.3). */
  href: z.string(),
});
export type Attachment = z.infer<typeof Attachment>;

export const AttachmentListResponse = z.object({ items: z.array(Attachment) });
export type AttachmentListResponse = z.infer<typeof AttachmentListResponse>;

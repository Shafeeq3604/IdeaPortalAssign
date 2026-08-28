import { z } from "zod";
import { ErrorCode } from "./errors.js";
import * as C from "./schemas/common.js";
import * as I from "./schemas/idea.js";
import * as A from "./schemas/analysis.js";
import * as E from "./schemas/evaluation.js";
import * as R from "./schemas/review.js";

/**
 * The API endpoint registry (P0 deliverables 2b + 3). FROZEN AT P0.
 *
 * ONE source of truth for the HTTP surface. It generates the OpenAPI catalogue, and in
 * P1 it drives Fastify route registration and the MSW mocks. Because every consumer
 * reads this same object, an endpoint cannot mean different things in different places.
 *
 * `permissions` is declarative and mirrors SPEC §4.2. The route-registration guard in
 * apps/api refuses to boot on a route that is neither `public` nor permissioned, so this
 * field is what makes that check possible.
 */

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface EndpointDef {
  readonly operationId: string;
  readonly method: HttpMethod;
  /** OpenAPI-style path with `{param}` placeholders. */
  readonly path: string;
  readonly summary: string;
  readonly tag: string;
  /** `public` or the permissions required. Never absent. */
  readonly access: "public" | { readonly requires: readonly string[] };
  readonly params?: z.ZodTypeAny | undefined;
  readonly query?: z.ZodTypeAny | undefined;
  readonly body?: z.ZodTypeAny | undefined;
  readonly response: z.ZodTypeAny;
  readonly successStatus: 200 | 201 | 202 | 204;
  /** Documented failure modes beyond the universal 401/500. */
  readonly errors: readonly ErrorCode[];
}

const IdeaParams = z.object({ ideaId: C.Id });
const VersionParams = z.object({ ideaId: C.Id, versionNo: z.coerce.number().int().min(1) });
const RunParams = z.object({ runId: C.Id });

const OWN = ["idea:read:own"] as const;
const READ = ["idea:read"] as const;
const REVIEW = ["review:write"] as const;
// Real permissions only — a string that is not in PERMISSIONS can never be granted,
// so it silently makes an endpoint permanently 403. A contract test now enforces this.
const AUDIT = ["audit:read"] as const;
const USERS = ["user:manage"] as const;
const CONFIG_WRITE = ["config:write"] as const;
const RECOMPUTE = ["ranking:recompute"] as const;

export const ENDPOINTS: readonly EndpointDef[] = [
  /* ── meta ── */
  {
    operationId: "getHealth", method: "GET", path: "/health", tag: "meta",
    summary: "Liveness probe. Deliberately discloses nothing beyond process state.",
    access: "public", response: z.object({ status: z.literal("ok"), service: z.string(), phase: z.string() }),
    successStatus: 200, errors: [],
  },

  /* ── auth ── */
  {
    operationId: "getSession", method: "GET", path: "/auth/session", tag: "auth",
    summary: "The signed-in user, their roles and department.",
    access: { requires: [] }, response: I.SessionResponse, successStatus: 200,
    errors: ["UNAUTHENTICATED", "SESSION_EXPIRED"],
  },
  {
    operationId: "logout", method: "POST", path: "/auth/logout", tag: "auth",
    summary: "Revoke the server-side session.",
    access: { requires: [] }, response: C.OkResponse, successStatus: 200, errors: [],
  },

  /* ── ideas ── */
  {
    operationId: "listIdeas", method: "GET", path: "/ideas", tag: "ideas",
    summary: "List ideas, scoped to what the actor may see (SPEC §4.2).",
    access: { requires: [...READ] }, query: I.ListIdeasQuery, response: I.ListIdeasResponse,
    successStatus: 200, errors: ["VALIDATION_FAILED"],
  },
  {
    operationId: "createIdea", method: "POST", path: "/ideas", tag: "ideas",
    summary: "Create a draft, or submit and start analysis.",
    access: { requires: ["idea:create"] }, body: I.CreateIdeaRequest, response: C.AcceptedResponse,
    successStatus: 202, errors: ["VALIDATION_FAILED", "RATE_LIMITED"],
  },
  {
    operationId: "getIdea", method: "GET", path: "/ideas/{ideaId}", tag: "ideas",
    summary: "Idea detail, including what this actor is permitted to do with it.",
    access: { requires: [...OWN] }, params: IdeaParams, response: I.IdeaDetail,
    successStatus: 200, errors: ["NOT_FOUND"],
  },
  {
    operationId: "updateDraft", method: "PATCH", path: "/ideas/{ideaId}", tag: "ideas",
    summary: "Edit a DRAFT or NEEDS_CLARIFICATION idea in place. Submitted ideas are immutable.",
    access: { requires: ["idea:edit:own"] }, params: IdeaParams, body: I.UpdateDraftRequest,
    response: I.IdeaDetail, successStatus: 200,
    errors: ["VALIDATION_FAILED", "NOT_FOUND", "FORBIDDEN", "IDEA_VERSION_IMMUTABLE"],
  },
  {
    operationId: "createVersion", method: "POST", path: "/ideas/{ideaId}/versions", tag: "ideas",
    summary: "Revise an idea. Creates v(n+1) and re-runs only the steps whose inputs changed.",
    access: { requires: ["idea:edit:own"] }, params: IdeaParams, body: I.CreateVersionRequest,
    response: C.AcceptedResponse, successStatus: 202,
    errors: ["VALIDATION_FAILED", "NOT_FOUND", "FORBIDDEN", "RATE_LIMITED"],
  },
  {
    operationId: "listVersions", method: "GET", path: "/ideas/{ideaId}/versions", tag: "ideas",
    summary: "Version list for the History tab.",
    access: { requires: [...OWN] }, params: IdeaParams, response: I.ListVersionsResponse,
    successStatus: 200, errors: ["NOT_FOUND"],
  },
  {
    operationId: "getVersion", method: "GET", path: "/ideas/{ideaId}/versions/{versionNo}", tag: "ideas",
    summary: "Frozen snapshot of one version.",
    access: { requires: [...OWN] }, params: VersionParams, response: I.IdeaVersionDetail,
    successStatus: 200, errors: ["NOT_FOUND"],
  },
  {
    operationId: "getIdeaHistory", method: "GET", path: "/ideas/{ideaId}/history", tag: "ideas",
    summary: "Versions with evaluation deltas, plus the status lane (FR-24).",
    access: { requires: [...OWN] }, params: IdeaParams, response: I.IdeaHistoryResponse,
    successStatus: 200, errors: ["NOT_FOUND"],
  },
  {
    operationId: "transitionIdea", method: "POST", path: "/ideas/{ideaId}/status", tag: "ideas",
    summary: "Move an idea through the lifecycle. Validated against the transition table.",
    access: { requires: ["idea:transition"] }, params: IdeaParams, body: I.TransitionRequest,
    response: I.IdeaDetail, successStatus: 200,
    errors: ["ILLEGAL_STATUS_TRANSITION", "REASON_REQUIRED", "ROLE_NOT_PERMITTED", "NOT_FOUND"],
  },

  /* ── analysis ── */
  {
    operationId: "getIdeaAnalysis", method: "GET", path: "/ideas/{ideaId}/analysis", tag: "analysis",
    summary: "All AI-derived analysis for the current version, with provenance on every block.",
    access: { requires: [...OWN] }, params: IdeaParams, response: A.IdeaAnalysisResponse,
    successStatus: 200, errors: ["NOT_FOUND"],
  },
  {
    operationId: "getAnalysisStatus", method: "GET", path: "/ideas/{ideaId}/analysis/status", tag: "analysis",
    summary: "Six-step run state for the determinate stepper (SPEC §8.4).",
    access: { requires: [...OWN] }, params: IdeaParams, response: A.AnalysisRunStatus,
    successStatus: 200, errors: ["NOT_FOUND"],
  },

  /* ── evaluation & ranking ── */
  {
    operationId: "getIdeaEvaluation", method: "GET", path: "/ideas/{ideaId}/evaluation", tag: "evaluation",
    summary: "Criterion scores, composite, maturity and the ranking with its explanation.",
    access: { requires: [...OWN] }, params: IdeaParams, response: E.IdeaEvaluationResponse,
    successStatus: 200, errors: ["NOT_FOUND"],
  },
  {
    operationId: "overrideCriterionScore", method: "POST", path: "/ideas/{ideaId}/evaluation/overrides", tag: "evaluation",
    summary: "Adjust a criterion score. Reason mandatory; writes score_overrides + audit_log atomically.",
    access: { requires: [...REVIEW] }, params: IdeaParams, body: E.OverrideScoreRequest,
    response: E.IdeaEvaluationResponse, successStatus: 200,
    errors: ["REASON_REQUIRED", "CANNOT_REVIEW_OWN_IDEA", "ROLE_NOT_PERMITTED", "NOT_FOUND"],
  },
  {
    operationId: "listRankings", method: "GET", path: "/rankings", tag: "rankings",
    summary: "Ranked board for a profile. Each row carries its top strength and constraint.",
    access: { requires: [...READ] }, query: E.ListRankingsQuery, response: E.ListRankingsResponse,
    successStatus: 200, errors: ["VALIDATION_FAILED"],
  },
  {
    operationId: "getRankingRun", method: "GET", path: "/rankings/{runId}", tag: "rankings",
    summary: "A specific immutable ranking run (ADR-008).",
    access: { requires: [...READ] }, params: RunParams, response: E.ListRankingsResponse,
    successStatus: 200, errors: ["NOT_FOUND"],
  },
  {
    operationId: "compareIdeas", method: "GET", path: "/rankings/compare", tag: "rankings",
    summary: "Side-by-side comparison of 2–4 ideas, naming where they diverge.",
    access: { requires: [...READ] }, query: E.CompareQuery, response: E.CompareResponse,
    successStatus: 200, errors: ["VALIDATION_FAILED", "NOT_FOUND"],
  },
  {
    operationId: "recomputeRankings", method: "POST", path: "/rankings/recompute", tag: "rankings",
    summary: "Recompute a cohort. Creates a NEW immutable run; makes no provider call.",
    access: { requires: [...RECOMPUTE] }, body: E.RecomputeRequest, response: E.RankingRunMeta,
    successStatus: 202, errors: ["ROLE_NOT_PERMITTED", "VALIDATION_FAILED"],
  },


  /* ── review ── */
  {
    operationId: "getReviewQueue", method: "GET", path: "/review/queue", tag: "review",
    summary: "Ideas awaiting reviewer action, oldest first.",
    access: { requires: [...REVIEW] }, query: R.ReviewQueueQuery, response: R.ReviewQueueResponse,
    successStatus: 200, errors: ["ROLE_NOT_PERMITTED"],
  },
  {
    operationId: "listReviews", method: "GET", path: "/ideas/{ideaId}/reviews", tag: "review",
    summary: "Review history for an idea.",
    access: { requires: [...OWN] }, params: IdeaParams, response: R.ListReviewsResponse,
    successStatus: 200, errors: ["NOT_FOUND"],
  },
  {
    operationId: "createReview", method: "POST", path: "/ideas/{ideaId}/reviews", tag: "review",
    summary: "Validate, request clarification, or reject with a reason (FR-22).",
    access: { requires: [...REVIEW] }, params: IdeaParams, body: R.CreateReviewRequest,
    response: R.Review, successStatus: 201,
    errors: ["VALIDATION_FAILED", "CANNOT_REVIEW_OWN_IDEA", "ROLE_NOT_PERMITTED", "NOT_FOUND"],
  },

  /* ── config: read-only in M1, writes are 501 until P10 (SPEC §9.10) ── */
  {
    operationId: "listCriteria", method: "GET", path: "/config/criteria", tag: "config",
    summary: "Evaluation criteria. Read-only in M1 — underwrites explainability (NFR-03).",
    access: { requires: ["config:read"] }, response: E.ListCriteriaResponse, successStatus: 200, errors: [],
  },
  {
    operationId: "listProfiles", method: "GET", path: "/config/profiles", tag: "config",
    summary: "Evaluation profiles and their weights, each summing to 100%.",
    access: { requires: ["config:read"] }, response: E.ListProfilesResponse, successStatus: 200, errors: [],
  },
  {
    operationId: "updateProfileWeights", method: "PATCH", path: "/config/profiles/{profileKey}", tag: "config",
    summary: "M2 (P10). Returns 501 in M1 — an explicit deferral, never a dead button.",
    access: { requires: [...CONFIG_WRITE] }, params: z.object({ profileKey: z.string() }),
    body: z.object({ weights: z.array(z.object({ criterionKey: z.string(), weight: z.number() })) }),
    response: C.OkResponse, successStatus: 200, errors: ["NOT_IMPLEMENTED_UNTIL_M2", "ROLE_NOT_PERMITTED"],
  },

  /* ── management & admin ── */
  {
    operationId: "getDashboard", method: "GET", path: "/dashboard", tag: "management",
    summary: "The nine counts of REQUIREMENTS §29. Every tile carries its destination href.",
    access: { requires: ["dashboard:read"] }, query: z.object({ departmentId: C.Id.optional() }),
    response: R.DashboardResponse, successStatus: 200, errors: ["ROLE_NOT_PERMITTED"],
  },
  {
    operationId: "listAuditEntries", method: "GET", path: "/admin/audit", tag: "admin",
    summary: "Append-only audit trail (FR-29). Every row links to its subject.",
    access: { requires: [...AUDIT] }, query: R.AuditQuery, response: R.AuditResponse,
    successStatus: 200, errors: ["ROLE_NOT_PERMITTED", "VALIDATION_FAILED"],
  },
  {
    operationId: "listUsers", method: "GET", path: "/admin/users", tag: "admin",
    summary: "Users and their roles.",
    access: { requires: [...USERS] }, query: R.AdminUsersQuery, response: R.AdminUsersResponse,
    successStatus: 200, errors: ["ROLE_NOT_PERMITTED"],
  },
  {
    operationId: "login", method: "POST", path: "/auth/login", tag: "auth",
    summary: "Sign in with email and password (ADR-023).",
    access: "public", body: R.LoginRequest, response: I.SessionResponse,
    successStatus: 200, errors: ["UNAUTHENTICATED", "VALIDATION_FAILED", "RATE_LIMITED"],
  },
  {
    operationId: "signupOptions", method: "GET", path: "/auth/signup-options", tag: "auth",
    summary: "Whether self-registration is open, and on what terms (FR-01a).",
    access: "public", response: R.SignupOptions,
    successStatus: 200, errors: [],
  },
  {
    operationId: "signup", method: "POST", path: "/auth/signup", tag: "auth",
    summary: "Create your own EMPLOYEE account and sign in (FR-01a).",
    access: "public", body: R.SignupRequest, response: I.SessionResponse,
    successStatus: 201,
    errors: ["VALIDATION_FAILED", "CONCURRENT_MODIFICATION", "ROLE_NOT_PERMITTED", "RATE_LIMITED"],
  },
  {
    operationId: "listDepartments", method: "GET", path: "/admin/departments", tag: "admin",
    summary: "Departments, for assigning one to an account.",
    access: { requires: [...USERS] }, response: R.DepartmentListResponse,
    successStatus: 200, errors: ["ROLE_NOT_PERMITTED"],
  },
  {
    operationId: "createUser", method: "POST", path: "/admin/users", tag: "admin",
    summary: "Create an account and assign its roles.",
    access: { requires: [...USERS] }, body: R.CreateUserRequest, response: R.AdminUser,
    successStatus: 201, errors: ["VALIDATION_FAILED", "ROLE_NOT_PERMITTED", "CONCURRENT_MODIFICATION"],
  },
  {
    operationId: "updateUser", method: "PATCH", path: "/admin/users/{userId}", tag: "admin",
    summary: "Change roles, department, active state, or set a new password.",
    access: { requires: [...USERS] }, params: z.object({ userId: C.Id }),
    body: R.UpdateUserRequest, response: R.AdminUser,
    successStatus: 200, errors: ["VALIDATION_FAILED", "ROLE_NOT_PERMITTED", "NOT_FOUND"],
  },
  {
    operationId: "getIdeaFeedback", method: "GET", path: "/ideas/{ideaId}/feedback", tag: "feedback",
    summary: "Thumbs up and down totals, plus this person's own vote (FR-18).",
    access: { requires: [...OWN] }, params: IdeaParams, response: R.IdeaFeedbackSummary,
    successStatus: 200, errors: ["NOT_FOUND"],
  },
  {
    operationId: "setIdeaFeedback", method: "POST", path: "/ideas/{ideaId}/feedback", tag: "feedback",
    summary: "Record, change or clear your vote. Never affects the ranking (FR-18, P-1).",
    access: { requires: [...OWN] }, params: IdeaParams, body: R.SetFeedbackRequest,
    response: R.IdeaFeedbackSummary, successStatus: 200, errors: ["NOT_FOUND"],
  },
];

export function endpointByOperationId(id: string): EndpointDef | undefined {
  return ENDPOINTS.find((e) => e.operationId === id);
}

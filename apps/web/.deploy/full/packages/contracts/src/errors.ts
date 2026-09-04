import { z } from "zod";

/**
 * Error-code catalogue (SPEC §14 P0.2).
 * Clients switch on `code`, never on `message`. Messages are for humans and may change;
 * codes are contract and may not (SPEC §14.1).
 */
export const ErrorCode = z.enum([
  // 400
  "VALIDATION_FAILED",
  "MALFORMED_REQUEST",
  "UNSUPPORTED_FILE_TYPE",
  "FILE_TOO_LARGE",
  // 401 / 403
  "UNAUTHENTICATED",
  "SESSION_EXPIRED",
  "FORBIDDEN",
  "ROLE_NOT_PERMITTED",
  "NOT_SUBMITTER",
  "CANNOT_REVIEW_OWN_IDEA",
  // 404 — existence is not disclosed for resources the actor may not see (SPEC §9.1)
  "NOT_FOUND",
  // 409
  "ILLEGAL_STATUS_TRANSITION",
  "REASON_REQUIRED",
  "IDEA_VERSION_IMMUTABLE",
  "PROFILE_WEIGHTS_UNBALANCED",
  "CONCURRENT_MODIFICATION",
  // 422 — domain invariants (SPEC §5 constraints)
  "EVIDENCE_REQUIRED",
  "MITIGATION_REQUIRED",
  "CONSTRAINT_CITATION_REQUIRED",
  "EXPLANATION_REQUIRED",
  "RECOMMENDATION_INCOMPLETE",
  // 429
  "RATE_LIMITED",
  "AI_BUDGET_EXCEEDED",
  // 5xx
  "INTERNAL_ERROR",
  "AI_PROVIDER_UNAVAILABLE",
  "AI_OUTPUT_INVALID",
  "DEPENDENCY_UNAVAILABLE",
  // 501 — deliberate M2 deferral; never a silently dead control (SPEC §9.10)
  "NOT_IMPLEMENTED_UNTIL_M2",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const HTTP_STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  MALFORMED_REQUEST: 400,
  UNSUPPORTED_FILE_TYPE: 400,
  FILE_TOO_LARGE: 400,
  UNAUTHENTICATED: 401,
  SESSION_EXPIRED: 401,
  FORBIDDEN: 403,
  ROLE_NOT_PERMITTED: 403,
  NOT_SUBMITTER: 403,
  CANNOT_REVIEW_OWN_IDEA: 403,
  NOT_FOUND: 404,
  ILLEGAL_STATUS_TRANSITION: 409,
  REASON_REQUIRED: 409,
  IDEA_VERSION_IMMUTABLE: 409,
  PROFILE_WEIGHTS_UNBALANCED: 409,
  CONCURRENT_MODIFICATION: 409,
  EVIDENCE_REQUIRED: 422,
  MITIGATION_REQUIRED: 422,
  CONSTRAINT_CITATION_REQUIRED: 422,
  EXPLANATION_REQUIRED: 422,
  RECOMMENDATION_INCOMPLETE: 422,
  RATE_LIMITED: 429,
  AI_BUDGET_EXCEEDED: 429,
  INTERNAL_ERROR: 500,
  AI_PROVIDER_UNAVAILABLE: 503,
  AI_OUTPUT_INVALID: 502,
  DEPENDENCY_UNAVAILABLE: 503,
  NOT_IMPLEMENTED_UNTIL_M2: 501,
};

/** Field paths let the client map a 400 onto the right form input (SPEC §7.8). */
export const FieldIssue = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  message: z.string(),
});
export type FieldIssue = z.infer<typeof FieldIssue>;

export const ErrorResponse = z.object({
  code: ErrorCode,
  message: z.string(),
  /** Correlates with server logs and every ErrorBoundary (SPEC §7.8). */
  requestId: z.string(),
  issues: z.array(FieldIssue).optional(),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;

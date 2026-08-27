/**
 * Filters reaching a key are only ever serialized, so the factory takes a readonly
 * serializable object rather than the exact query type. Requiring the mutable contract
 * type forced call sites to drop `readonly` from their own filter state — trading real
 * immutability for a type that a cache key does not need.
 *
 * Type safety lives where it belongs: on each hook's parameter (see the api.ts inside
 * each feature folder), which IS typed against the contract query schema.
 */
type Filters = object;

/**
 * TanStack Query key factory (P0 deliverable 5c, SPEC §7.8).
 *
 * A CONTRACT between parallel UI slices, not a convenience. Without one, two slices cache
 * the same resource under different keys: one invalidates, the other keeps serving stale
 * data, and the bug shows up as "the score didn't update" long after the cause.
 *
 * Rules:
 *   - Every key starts with a resource scope, so invalidation can be coarse or precise.
 *   - Filter objects come from the contract query types, so a key cannot carry a filter
 *     the API does not accept.
 *   - Nothing outside this file constructs a query key.
 */

export const queryKeys = {
  session: () => ["session"] as const,

  ideas: {
    all: () => ["ideas"] as const,
    list: (filters: Filters) => ["ideas", "list", filters] as const,
    detail: (ideaId: string) => ["ideas", "detail", ideaId] as const,
    versions: (ideaId: string) => ["ideas", "detail", ideaId, "versions"] as const,
    version: (ideaId: string, versionNo: number) =>
      ["ideas", "detail", ideaId, "versions", versionNo] as const,
    history: (ideaId: string) => ["ideas", "detail", ideaId, "history"] as const,
    analysis: (ideaId: string) => ["ideas", "detail", ideaId, "analysis"] as const,
    analysisStatus: (ideaId: string) => ["ideas", "detail", ideaId, "analysis", "status"] as const,
    evaluation: (ideaId: string) => ["ideas", "detail", ideaId, "evaluation"] as const,
    recommendations: (ideaId: string) => ["ideas", "detail", ideaId, "recommendations"] as const,
    reviews: (ideaId: string) => ["ideas", "detail", ideaId, "reviews"] as const,
  },

  rankings: {
    all: () => ["rankings"] as const,
    list: (filters: Filters) => ["rankings", "list", filters] as const,
    run: (runId: string) => ["rankings", "run", runId] as const,
    compare: (ids: readonly string[], profile?: string) =>
      ["rankings", "compare", [...ids].sort(), profile ?? null] as const,
  },

  review: {
    queue: (filters: Filters) => ["review", "queue", filters] as const,
  },

  config: {
    criteria: () => ["config", "criteria"] as const,
    profiles: () => ["config", "profiles"] as const,
  },

  dashboard: (departmentId?: string) => ["dashboard", departmentId ?? null] as const,

  admin: {
    audit: (filters: Filters) => ["admin", "audit", filters] as const,
    users: (filters: Filters) => ["admin", "users", filters] as const,
  },
} as const;

/**
 * What must be invalidated after a mutation. Co-located with the keys so a new mutation
 * cannot forget one — a stale ranking after an override is exactly the class of bug
 * that is painful to trace back.
 */
export const invalidateAfter = {
  /** An override changes the score, the composite, the rank, and the audit trail. */
  scoreOverride: (ideaId: string) => [
    queryKeys.ideas.evaluation(ideaId),
    queryKeys.ideas.detail(ideaId),
    queryKeys.rankings.all(),
    queryKeys.admin.audit({}),
  ],
  statusTransition: (ideaId: string) => [
    queryKeys.ideas.detail(ideaId),
    queryKeys.ideas.history(ideaId),
    queryKeys.ideas.all(),
    queryKeys.review.queue({}),
    queryKeys.admin.audit({}),
  ],
  newVersion: (ideaId: string) => [
    queryKeys.ideas.detail(ideaId),
    queryKeys.ideas.versions(ideaId),
    queryKeys.ideas.history(ideaId),
    queryKeys.ideas.analysis(ideaId),
    queryKeys.ideas.evaluation(ideaId),
    queryKeys.ideas.recommendations(ideaId),
  ],
  review: (ideaId: string) => [
    queryKeys.ideas.reviews(ideaId),
    queryKeys.ideas.detail(ideaId),
    queryKeys.review.queue({}),
    queryKeys.admin.audit({}),
  ],
  /** Re-weighting changes every rank in the cohort (ADR-008). */
  recompute: () => [queryKeys.rankings.all(), queryKeys.dashboard()],
} as const;

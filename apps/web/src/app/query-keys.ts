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
  /** Public. Whether self-registration is open, and on what terms (FR-01a). */
  signupOptions: () => ["signup-options"] as const,

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
    /** ADR-026 — the final organisational decision, distinct from P-4's `recommendations`
     *  key above (a different, unrelated concept — see ADR-026's naming rationale). */
    leadershipDecisions: (ideaId: string) =>
      ["ideas", "detail", ideaId, "leadership-decisions"] as const,
    feedback: (ideaId: string) => ["ideas", "detail", ideaId, "feedback"] as const,
    /** The five structured-feedback reasons (FR-18, P11) — a separate key from `feedback`
     *  above (the thumb vote) since they're two different requests to two different
     *  endpoints, not two views of the same data. */
    signals: (ideaId: string) => ["ideas", "detail", ideaId, "signals"] as const,
    attachments: (ideaId: string) => ["ideas", ideaId, "attachments"] as const,
  },

  rankings: {
    all: () => ["rankings"] as const,
    list: (filters: Filters) => ["rankings", "list", filters] as const,
    run: (runId: string, filters: Filters = {}) => ["rankings", "run", runId, filters] as const,
    compare: (ids: readonly string[], profile?: string) =>
      ["rankings", "compare", [...ids].sort(), profile ?? null] as const,
  },

  review: {
    queue: (filters: Filters) => ["review", "queue", filters] as const,
  },

  config: {
    criteria: () => ["config", "criteria"] as const,
    profiles: () => ["config", "profiles"] as const,
    categories: () => ["config", "categories"] as const,
    existingSolutions: () => ["config", "existing-solutions"] as const,
    detection: () => ["config", "detection"] as const,
  },

  dashboard: (departmentId?: string) => ["dashboard", departmentId ?? null] as const,
  analytics: (filters: { departmentId?: string | undefined; categoryId?: string | undefined }) =>
    ["analytics", filters.departmentId ?? null, filters.categoryId ?? null] as const,

  admin: {
    audit: (filters: Filters) => ["admin", "audit", filters] as const,
    users: (filters: Filters) => ["admin", "users", filters] as const,
    departments: () => ["admin", "departments"] as const,
  },

  /** SPEC §6.1 person page — a person's own activity summary + contribution timeline.
   *  Read-only (no mutation writes it), so no `invalidateAfter` entry: it refetches
   *  fresh on every visit to a `/people/:userId` page the same as `ideas.list` does. */
  people: {
    activity: (userId: string) => ["people", userId, "activity"] as const,
  },

  /** SPC-001 — AI Discovery Agent. Standalone: no idea-scoped key touches this. */
  discovery: {
    history: () => ["discovery", "history"] as const,
    detail: (discoveryQueryId: string) => ["discovery", "detail", discoveryQueryId] as const,
  },

  /** Platform-transformation brief §7 — conversational idea creation. Standalone: a
   *  conversation is scratch state, no idea-scoped key touches this either. */
  ideaCreation: {
    list: () => ["idea-creation", "list"] as const,
    detail: (conversationId: string) => ["idea-creation", "detail", conversationId] as const,
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
  /** Editing a draft in place changes only the idea itself — no version, history, analysis
   *  or evaluation exists yet to invalidate. */
  draftEdit: (ideaId: string) => [
    queryKeys.ideas.detail(ideaId),
    queryKeys.ideas.all(),
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
  /** Recording a leadership decision never moves idea status (P-3) — only its own history
   *  and the audit trail need refreshing, unlike `review` above which also touches the
   *  queue and idea detail's own review-derived fields. */
  leadershipDecision: (ideaId: string) => [
    queryKeys.ideas.leadershipDecisions(ideaId),
    queryKeys.admin.audit({}),
  ],
  /** Re-weighting changes every rank in the cohort (ADR-008). */
  recompute: () => [queryKeys.rankings.all(), queryKeys.dashboard(), ["analytics"] as const],
  /** Editing a profile's weights (P10) only touches config and the audit trail — a rank
   *  doesn't move until someone explicitly recomputes (ADR-008: snapshot runs, not live). */
  profileWeightsUpdate: () => [
    queryKeys.config.criteria(),
    queryKeys.config.profiles(),
    queryKeys.admin.audit({}),
  ],
  categoryUpdate: () => [queryKeys.config.categories(), queryKeys.admin.audit({})],
  existingSolutionUpdate: () => [queryKeys.config.existingSolutions(), queryKeys.admin.audit({})],
  detectionConfigUpdate: () => [queryKeys.config.detection(), queryKeys.admin.audit({})],
} as const;

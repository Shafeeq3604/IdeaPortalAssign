import { ALL_TRANSITIONS, can, type IdeaStatus, type MaturityLevel, type Role } from "@iep/contracts";

/**
 * Row → API response mapping (P2).
 *
 * Kept apart from the route handlers so the shape of what we return is inspectable in one
 * place, and so a database column is never accidentally forwarded to a client just
 * because it happened to be selected.
 */

interface ActorLike {
  readonly id: string;
  readonly displayName: string;
  readonly department?: { readonly name: string } | null;
}

const actorRef = (u: ActorLike) => ({
  id: u.id,
  displayName: u.displayName,
  departmentName: u.department?.name ?? null,
});

const iso = (d: Date | null | undefined): string | null => d?.toISOString() ?? null;

/* eslint-disable @typescript-eslint/no-explicit-any -- Prisma include types are structural;
   the response shape is guaranteed by the contract schemas, which the tests validate. */
type Row = any;

/**
 * @param scored The idea's current-version score and rank, when it has one.
 *
 * Passed in rather than read here because it takes two queries the caller batches across
 * the whole page — doing it per row would be an N+1 on every list in the product.
 */
export function toIdeaSummary(
  idea: Row,
  scored: { compositeScore: number | null; rank: number | null } = {
    compositeScore: null,
    rank: null,
  },
) {
  return {
    id: idea.id,
    title: idea.currentVersion?.title ?? "(untitled)",
    status: idea.status as IdeaStatus,
    maturityLevel: (idea.maturityLevel ?? null) as MaturityLevel | null,
    submitter: actorRef(idea.submitter),
    department: idea.department ? { id: idea.department.id, name: idea.department.name } : null,
    category: idea.category
      ? { id: idea.category.id, key: idea.category.key, label: idea.category.label }
      : null,
    currentVersionNo: idea.currentVersion?.versionNo ?? 1,
    submittedAt: iso(idea.submittedAt),
    updatedAt: iso(idea.updatedAt)!,
    /**
     * The current version's score, and the rank it holds in the latest run that included
     * it. Null when the idea has not been evaluated — never 0, which would read as a bad
     * score rather than an absent one (P-1).
     *
     * These were hard-coded null with a comment saying P7 would wire them up. P7 shipped
     * without doing it, and nothing noticed because no list rendered the column. It
     * surfaced the moment one did.
     */
    rank: scored.rank,
    compositeScore: scored.compositeScore,
  };
}

export function toVersionSummary(v: Row) {
  return {
    id: v.id,
    versionNo: v.versionNo,
    title: v.title,
    changeSummary: v.changeSummary ?? null,
    author: actorRef(v.author),
    createdAt: iso(v.createdAt)!,
  };
}

export function toVersionDetail(v: Row) {
  return {
    ...toVersionSummary(v),
    description: v.description,
    problemStatement: v.problemStatement,
    expectedUsers: v.expectedUsers,
    expectedOutcome: v.expectedOutcome,
    existingProcess: v.existingProcess ?? null,
    existingSolutions: v.existingSolutions ?? null,
    suggestedTechnology: v.suggestedTechnology ?? null,
    expectedBenefits: v.expectedBenefits ?? null,
    estimatedCostNote: v.estimatedCostNote ?? null,
    references: v.references ?? null,
    attachments: (v.attachments ?? []).map((a: Row) => ({
      id: a.id, filename: a.filename, mime: a.mime, bytes: a.bytes,
    })),
  };
}

export function toStatusEntry(h: Row) {
  return {
    id: h.id,
    fromStatus: (h.fromStatus ?? null) as IdeaStatus | null,
    toStatus: h.toStatus as IdeaStatus,
    actor: actorRef(h.actor),
    reason: h.reason ?? null,
    at: iso(h.at)!,
  };
}

/**
 * Idea detail carries what THIS actor may do with it.
 *
 * The client must never decide what is permitted — but it also must not render a control
 * the server will refuse. Sending the decisions means the UI can hide impossible actions
 * without re-implementing the policy, and the two can never disagree.
 */
export function toIdeaDetail(idea: Row, actor: { userId: string; roles: readonly Role[] }) {
  const resource = {
    ideaId: idea.id,
    submitterId: idea.submitterId,
    status: idea.status as IdeaStatus,
  };

  const allowedTransitions = ALL_TRANSITIONS.filter(
    (t) =>
      t.from === resource.status &&
      t.availableInM1 &&
      t.roles.some((r) => actor.roles.includes(r)) &&
      (!t.submitterOnly || idea.submitterId === actor.userId),
  ).map((t) => t.to);

  return {
    ...toIdeaSummary(idea),
    currentVersion: toVersionDetail(idea.currentVersion),
    versionCount: idea._count?.versions ?? 1,
    openRecommendationCount: 0, // P5 supplies this
    permissions: {
      canEdit: can(actor, "idea:edit", resource).allowed,
      canSubmit: can(actor, "idea:submit", resource).allowed,
      canRevise: can(actor, "idea:revise", resource).allowed,
      canReview: can(actor, "review:create", resource).allowed,
      canOverrideScores: can(actor, "score:override", resource).allowed,
      allowedTransitions: [...new Set(allowedTransitions)],
    },
  };
}

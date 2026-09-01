import { createHash } from "node:crypto";
import { writeAudit } from "../../lib/audit.js";
import type { PrismaClient, Prisma } from "@iep/db";
import type { IdeaScope, IdeaStatus } from "@iep/contracts";

/**
 * Idea persistence (P2).
 *
 * The scope filter is applied HERE, in the query, not after fetching. A list endpoint
 * must never return a row the detail endpoint would refuse (SPEC §4.2) — filtering
 * post-hoc leaks through pagination counts even when the rows are dropped.
 */

/** Content hash keys idempotent re-analysis: identical content costs zero tokens. */
export function contentHash(input: Readonly<Record<string, unknown>>): string {
  const canonical = JSON.stringify(
    Object.keys(input)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = input[k] ?? null;
        return acc;
      }, {}),
  );
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * `fields["title"]!` five times over was asserting a guarantee `IdeaFormSchema` already
 * enforces before either repo function below is ever called: these five are required,
 * the rest are genuinely optional. Saying so in the type — required keys explicit,
 * everything else still an open record — removes the assertions instead of trusting
 * them by hand at each access.
 */
type IdeaFields = Record<string, string | null> & {
  title: string;
  description: string;
  problemStatement: string;
  expectedUsers: string;
  expectedOutcome: string;
};

export function scopeToWhere(scope: IdeaScope): Prisma.IdeaWhereInput {
  if (scope.all) return {};
  // "mine, plus anything visible at my role's threshold" — one OR, evaluated in SQL.
  return {
    OR: [
      ...(scope.ownerId ? [{ submitterId: scope.ownerId }] : []),
      ...(scope.statusIn ? [{ status: { in: scope.statusIn as IdeaStatus[] } }] : []),
    ],
  };
}

/**
 * The only user columns any read path needs.
 *
 * `include: { department: true }` selects EVERY column on `users` — including
 * `password_hash`, `failed_logins` and `locked_until`. Nothing leaked it, because every
 * presenter maps fields explicitly, but it was loaded into memory on ordinary idea reads
 * and sat one careless spread away from going out over the wire.
 *
 * The dev-mode response check would NOT have caught that: Zod strips unknown keys when it
 * parses, and the handler sends the original object rather than the parsed one. So the
 * defence has to be here — never load the hash at all.
 */
const USER_SUMMARY_SELECT = {
  id: true,
  displayName: true,
  department: { select: { id: true, name: true } },
} as const;

export const IDEA_DETAIL_INCLUDE = {
  submitter: { select: USER_SUMMARY_SELECT },
  department: true,
  category: true,
  currentVersion: { include: { attachments: true, author: { select: USER_SUMMARY_SELECT } } },
  _count: { select: { versions: true } },
} as const;

export function makeIdeaRepo(db: PrismaClient) {
  return {
    async list(params: {
      scope: IdeaScope;
      status?: readonly IdeaStatus[];
      departmentId?: string;
      categoryId?: string;
      submitterId?: string;
      q?: string;
      sort: "recent" | "oldest" | "title" | "status" | "rank";
      page: number;
      perPage: number;
    }) {
      const where: Prisma.IdeaWhereInput = {
        AND: [
          scopeToWhere(params.scope),
          ...(params.status?.length ? [{ status: { in: params.status as IdeaStatus[] } }] : []),
          ...(params.departmentId ? [{ departmentId: params.departmentId }] : []),
          ...(params.categoryId ? [{ categoryId: params.categoryId }] : []),
          ...(params.submitterId ? [{ submitterId: params.submitterId }] : []),
          ...(params.q
            ? [{ versions: { some: { title: { contains: params.q, mode: "insensitive" as const } } } }]
            : []),
        ],
      };

      const orderBy: Prisma.IdeaOrderByWithRelationInput =
        params.sort === "oldest" ? { createdAt: "asc" }
        : params.sort === "status" ? { status: "asc" }
        : { updatedAt: "desc" };

      const [rows, total] = await Promise.all([
        db.idea.findMany({
          where,
          include: IDEA_DETAIL_INCLUDE,
          orderBy,
          skip: (params.page - 1) * params.perPage,
          take: params.perPage,
        }),
        db.idea.count({ where }),
      ]);
      return { rows, total };
    },

    findById(ideaId: string) {
      return db.idea.findUnique({ where: { id: ideaId }, include: IDEA_DETAIL_INCLUDE });
    },

    listVersions(ideaId: string) {
      return db.ideaVersion.findMany({
        where: { ideaId },
        include: { author: { select: USER_SUMMARY_SELECT } },
        orderBy: { versionNo: "asc" },
      });
    },

    findVersion(ideaId: string, versionNo: number) {
      return db.ideaVersion.findFirst({
        where: { ideaId, versionNo },
        include: { attachments: true, author: { select: USER_SUMMARY_SELECT } },
      });
    },

    statusHistory(ideaId: string) {
      return db.statusHistory.findMany({
        where: { ideaId },
        include: { actor: { select: USER_SUMMARY_SELECT } },
        orderBy: { at: "desc" },
      });
    },

    /**
     * Create an idea and its v1 in one transaction.
     *
     * `currentVersionId` is a deferrable FK, so the idea row and the version it points at
     * commit together — there is no window where an idea exists with no current version.
     */
    async createWithFirstVersion(input: {
      submitterId: string;
      departmentId: string | null;
      categoryId: string | null;
      fields: IdeaFields;
      submit: boolean;
    }) {
      return db.$transaction(async (tx) => {
        const idea = await tx.idea.create({
          data: {
            submitterId: input.submitterId,
            departmentId: input.departmentId,
            categoryId: input.categoryId,
            status: input.submit ? "SUBMITTED" : "DRAFT",
            submittedAt: input.submit ? new Date() : null,
          },
        });

        const version = await tx.ideaVersion.create({
          data: {
            ideaId: idea.id,
            versionNo: 1,
            authorId: input.submitterId,
            contentHash: contentHash(input.fields),
            changeSummary: null, // v1 has none — DB CHECK enforces it
            title: input.fields.title,
            description: input.fields.description,
            problemStatement: input.fields.problemStatement,
            expectedUsers: input.fields.expectedUsers,
            expectedOutcome: input.fields.expectedOutcome,
            existingProcess: input.fields["existingProcess"] ?? null,
            existingSolutions: input.fields["existingSolutions"] ?? null,
            suggestedTechnology: input.fields["suggestedTechnology"] ?? null,
            expectedBenefits: input.fields["expectedBenefits"] ?? null,
            estimatedCostNote: input.fields["estimatedCostNote"] ?? null,
            references: input.fields["references"] ?? null,
          },
        });

        await tx.idea.update({
          where: { id: idea.id },
          data: { currentVersionId: version.id },
        });

        if (input.submit) {
          await tx.statusHistory.create({
            data: { ideaId: idea.id, fromStatus: "DRAFT", toStatus: "SUBMITTED", actorId: input.submitterId },
          });
        }
        return { ideaId: idea.id, versionId: version.id };
      });
    },

    /** Edit a draft in place. Only reachable while the idea is still the author's. */
    async updateDraftVersion(versionId: string, fields: Record<string, string | null>) {
      const data: Prisma.IdeaVersionUpdateInput = { contentHash: contentHash(fields) };
      for (const [k, v] of Object.entries(fields)) {
        if (v !== undefined) (data as Record<string, unknown>)[k] = v;
      }
      return db.ideaVersion.update({ where: { id: versionId }, data });
    },

    /** Revision: v(n+1). The previous version becomes immutable by convention and by policy. */
    async createNextVersion(input: {
      ideaId: string;
      authorId: string;
      changeSummary: string;
      fields: IdeaFields;
      addressesRecommendationIds: readonly string[];
    }) {
      return db.$transaction(async (tx) => {
        const last = await tx.ideaVersion.findFirst({
          where: { ideaId: input.ideaId },
          orderBy: { versionNo: "desc" },
          select: { versionNo: true },
        });
        const versionNo = (last?.versionNo ?? 0) + 1;

        const version = await tx.ideaVersion.create({
          data: {
            ideaId: input.ideaId,
            versionNo,
            authorId: input.authorId,
            changeSummary: input.changeSummary,
            contentHash: contentHash(input.fields),
            title: input.fields.title,
            description: input.fields.description,
            problemStatement: input.fields.problemStatement,
            expectedUsers: input.fields.expectedUsers,
            expectedOutcome: input.fields.expectedOutcome,
            existingProcess: input.fields["existingProcess"] ?? null,
            existingSolutions: input.fields["existingSolutions"] ?? null,
            suggestedTechnology: input.fields["suggestedTechnology"] ?? null,
            expectedBenefits: input.fields["expectedBenefits"] ?? null,
            estimatedCostNote: input.fields["estimatedCostNote"] ?? null,
            references: input.fields["references"] ?? null,
          },
        });

        await tx.idea.update({
          where: { id: input.ideaId },
          data: { currentVersionId: version.id, status: "SUBMITTED", submittedAt: new Date() },
        });

        // Recommendations the author claims to have addressed. P5 confirms on re-evaluation;
        // marking them here would assert an outcome the engine has not measured yet.
        if (input.addressesRecommendationIds.length > 0) {
          await tx.improvementRecommendation.updateMany({
            where: { id: { in: [...input.addressesRecommendationIds] } },
            data: { status: "ADDRESSED", resolvedInVersionId: version.id },
          });
        }
        return { versionId: version.id, versionNo };
      });
    },

    /** Status change + history in one transaction: an unrecorded transition is impossible. */
    async transition(input: {
      ideaId: string;
      from: IdeaStatus;
      to: IdeaStatus;
      actorId: string;
      reason: string | null;
      requestId?: string | null;
    }) {
      return db.$transaction(async (tx) => {
        /**
         * SUBMITTED stamps `submitted_at`, once.
         *
         * The field was only ever set by `createWithFirstVersion({ submit: true })` — the
         * submit-straight-from-the-form path. An idea saved as a draft and submitted
         * afterwards went to SUBMITTED with `submitted_at` still null, so it had no
         * submission date anywhere in the product and sorted as though it had never been
         * submitted.
         *
         * Guarded on the CURRENT value rather than on `from`, so a later return to
         * SUBMITTED — after clarification, say — keeps the original date. When somebody
         * first submitted an idea is not a thing that should move.
         */
        await tx.idea.update({
          where: { id: input.ideaId },
          data: {
            status: input.to,
            ...(input.to === "SUBMITTED" ? { submittedAt: { set: new Date() } } : {}),
          },
        });
        await tx.statusHistory.create({
          data: {
            ideaId: input.ideaId,
            fromStatus: input.from,
            toStatus: input.to,
            actorId: input.actorId,
            reason: input.reason,
          },
        });

        /**
         * FR-23/FR-29 in the SAME transaction as the change.
         *
         * `status_history` is the product-facing lane and `audit_log` is the
         * governance one; they answer different questions and an auditor is not
         * expected to read the former. Writing the audit row afterwards would let a
         * transition commit unlogged, which is the one thing this must not allow.
         */
        await writeAudit(tx, {
          actorId: input.actorId,
          action: "idea.transition",
          entityType: "idea",
          entityId: input.ideaId,
          before: { status: input.from },
          after: { status: input.to },
          reason: input.reason,
          requestId: input.requestId ?? null,
        });
      });
    },
  };
}

export type IdeaRepo = ReturnType<typeof makeIdeaRepo>;

import { createHash } from "node:crypto";
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

export const IDEA_DETAIL_INCLUDE = {
  submitter: { include: { department: true } },
  department: true,
  category: true,
  currentVersion: { include: { attachments: true, author: { include: { department: true } } } },
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
        include: { author: { include: { department: true } } },
        orderBy: { versionNo: "asc" },
      });
    },

    findVersion(ideaId: string, versionNo: number) {
      return db.ideaVersion.findFirst({
        where: { ideaId, versionNo },
        include: { attachments: true, author: { include: { department: true } } },
      });
    },

    statusHistory(ideaId: string) {
      return db.statusHistory.findMany({
        where: { ideaId },
        include: { actor: { include: { department: true } } },
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
      fields: Record<string, string | null>;
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
            title: input.fields["title"]!,
            description: input.fields["description"]!,
            problemStatement: input.fields["problemStatement"]!,
            expectedUsers: input.fields["expectedUsers"]!,
            expectedOutcome: input.fields["expectedOutcome"]!,
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
      fields: Record<string, string | null>;
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
            title: input.fields["title"]!,
            description: input.fields["description"]!,
            problemStatement: input.fields["problemStatement"]!,
            expectedUsers: input.fields["expectedUsers"]!,
            expectedOutcome: input.fields["expectedOutcome"]!,
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
    }) {
      return db.$transaction(async (tx) => {
        await tx.idea.update({ where: { id: input.ideaId }, data: { status: input.to } });
        await tx.statusHistory.create({
          data: {
            ideaId: input.ideaId,
            fromStatus: input.from,
            toStatus: input.to,
            actorId: input.actorId,
            reason: input.reason,
          },
        });
      });
    },
  };
}

export type IdeaRepo = ReturnType<typeof makeIdeaRepo>;

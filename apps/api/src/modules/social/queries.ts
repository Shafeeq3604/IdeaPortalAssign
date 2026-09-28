import type { PrismaClient } from "@iep/db";

/**
 * P18 — the social figures idea responses carry, batched the way `feedbackForIdeas` and
 * `scoresForCurrentVersions` are: one query per page, never one per idea.
 */

/** Visible comments per idea — deleted and hidden ones are not something to read. */
export async function commentCountsFor(db: PrismaClient, ideaIds: readonly string[]): Promise<Map<string, number>> {
  if (ideaIds.length === 0) return new Map();
  const rows = await db.ideaComment.groupBy({
    by: ["ideaId"],
    where: { ideaId: { in: [...ideaIds] }, deletedAt: null, hiddenAt: null },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.ideaId, r._count._all]));
}

export interface IdeaSocial {
  readonly following: boolean;
  readonly followerCount: number;
  readonly commentCount: number;
}

export const NO_SOCIAL: IdeaSocial = { following: false, followerCount: 0, commentCount: 0 };

/** One idea's social state for the signed-in person. */
export async function socialFor(db: PrismaClient, ideaId: string, userId: string): Promise<IdeaSocial> {
  const [mine, followerCount, comments] = await Promise.all([
    db.ideaFollow.findUnique({ where: { ideaId_userId: { ideaId, userId } }, select: { userId: true } }),
    db.ideaFollow.count({ where: { ideaId } }),
    commentCountsFor(db, [ideaId]),
  ]);
  return { following: Boolean(mine), followerCount, commentCount: comments.get(ideaId) ?? 0 };
}

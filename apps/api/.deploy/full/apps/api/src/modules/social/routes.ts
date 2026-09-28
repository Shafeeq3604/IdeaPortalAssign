import type { PrismaClient } from "@iep/db";
import {
  CreateIdeaCommentRequest, HideIdeaCommentRequest, SearchPeopleQuery, SetIdeaFollowRequest,
  UpdateIdeaCommentRequest, can,
  type Actor, type CommentState, type IdeaComment, type IdeaResource, type IdeaStatus, type Role,
} from "@iep/contracts";
import {
  commentExcerpt, ideaFollowerIds, recordIdeaNotification, recordPeopleNotifications,
} from "@iep/evaluation";
import type { Handler } from "../../server.js";
import { requireActor, sendError } from "../../server.js";
import { writeAudit } from "../../lib/audit.js";

/**
 * P18 — the social layer (SPEC §14 M4, D-24): comment threads with @mentions, following
 * an idea, and the people search the @ picker uses.
 *
 * Visibility is the idea's own: a comment exists for exactly the people who can open the
 * idea (`can(…, "idea:read")`), and anyone else gets the same 404 the idea would give —
 * existence is not disclosed. None of this feeds the score.
 */

const NO_IDEA = "No idea with that id";
const NO_COMMENT = "No comment with that id";

type Db = PrismaClient;

async function loadIdea(db: Db, ideaId: string): Promise<IdeaResource | null> {
  const idea = await db.idea.findUnique({ where: { id: ideaId }, select: { id: true, submitterId: true, status: true } });
  return idea ? { ideaId: idea.id, submitterId: idea.submitterId, status: idea.status as IdeaStatus } : null;
}

const COMMENT_INCLUDE = {
  author: { select: { id: true, displayName: true, department: { select: { name: true } } } },
} as const;

type CommentRow = NonNullable<Awaited<ReturnType<typeof loadComment>>>;

function loadComment(db: Db, commentId: string) {
  return db.ideaComment.findUnique({ where: { id: commentId }, include: COMMENT_INCLUDE });
}

const stateOf = (c: { deletedAt: Date | null; hiddenAt: Date | null }): CommentState =>
  c.hiddenAt ? "HIDDEN" : c.deletedAt ? "DELETED" : "VISIBLE";

/** Display names for the people a page of comments mentions — one query, not one per row. */
async function namesFor(db: Db, rows: readonly { mentionIds: string[] }[]): Promise<Map<string, string>> {
  const ids = [...new Set(rows.flatMap((r) => r.mentionIds))];
  if (ids.length === 0) return new Map();
  const users = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true } });
  return new Map(users.map((u) => [u.id, u.displayName]));
}

function present(row: CommentRow, actor: Actor, idea: IdeaResource, names: Map<string, string>): IdeaComment {
  const state = stateOf(row);
  const visible = state === "VISIBLE";
  const mine = row.authorId === actor.userId;
  return {
    id: row.id,
    ideaId: row.ideaId,
    author: { id: row.author.id, displayName: row.author.displayName, departmentName: row.author.department?.name ?? null },
    state,
    body: visible ? row.body : null,
    mentions: visible
      ? row.mentionIds.flatMap((id) => (names.has(id) ? [{ id, displayName: names.get(id) ?? "" }] : []))
      : [],
    createdAt: row.createdAt.toISOString(),
    editedAt: visible && row.editedAt ? row.editedAt.toISOString() : null,
    hiddenReason: state === "HIDDEN" ? row.hiddenReason : null,
    permissions: {
      canEdit: visible && mine && can(actor, "idea:comment", idea).allowed,
      canDelete: visible && mine,
      canHide: visible && can(actor, "comment:moderate").allowed,
    },
  };
}

/**
 * Of the people an author picked, the ones who may be mentioned: active, and able to open
 * the idea. Anyone else is dropped silently — the picker never offered them, so a stale
 * id here is a crafted request or someone whose access changed mid-draft.
 */
async function mentionable(db: Db, idea: IdeaResource, ids: readonly string[], authorId: string): Promise<string[]> {
  const wanted = [...new Set(ids)].filter((id) => id !== authorId);
  if (wanted.length === 0) return [];
  const users = await db.user.findMany({
    where: { id: { in: wanted }, isActive: true },
    select: { id: true, roles: { select: { role: true } } },
  });
  const ok = new Set(
    users
      .filter((u) => can({ userId: u.id, roles: u.roles.map((r) => r.role as Role) }, "idea:read", idea).allowed)
      .map((u) => u.id),
  );
  return wanted.filter((id) => ok.has(id)); // keep the author's order
}

async function followState(db: Db, ideaId: string, userId: string) {
  const [mine, followerCount] = await Promise.all([
    db.ideaFollow.findUnique({ where: { ideaId_userId: { ideaId, userId } }, select: { userId: true } }),
    db.ideaFollow.count({ where: { ideaId } }),
  ]);
  return { ideaId, following: Boolean(mine), followerCount };
}

export function registerSocialRoutes(handlers: Map<string, Handler>): void {
  handlers.set("listIdeaComments", async (request, reply, ctx) => {
    const actor = requireActor(request);
    const { ideaId } = request.params as { ideaId: string };
    const idea = await loadIdea(ctx.db, ideaId);
    if (!idea || !can(actor, "idea:read", idea).allowed) return sendError(reply, "NOT_FOUND", NO_IDEA);

    const rows = await ctx.db.ideaComment.findMany({
      where: { ideaId },
      include: COMMENT_INCLUDE,
      orderBy: { createdAt: "asc" },
      take: 500,
    });
    const names = await namesFor(ctx.db, rows);
    return {
      items: rows.map((row) => present(row, actor, idea, names)),
      canComment: can(actor, "idea:comment", idea).allowed,
    };
  });

  handlers.set("createIdeaComment", async (request, reply, ctx) => {
    const actor = requireActor(request);
    const { ideaId } = request.params as { ideaId: string };
    const parsed = CreateIdeaCommentRequest.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, "VALIDATION_FAILED", parsed.error.issues[0]?.message ?? "Invalid comment");
    }
    const idea = await loadIdea(ctx.db, ideaId);
    if (!idea) return sendError(reply, "NOT_FOUND", NO_IDEA);
    const allowed = can(actor, "idea:comment", idea);
    if (!allowed.allowed) {
      return allowed.reason === "NOT_VISIBLE"
        ? sendError(reply, "NOT_FOUND", NO_IDEA)
        : sendError(reply, "FORBIDDEN", "Comments are closed on a draft or an archived idea");
    }

    const mentionIds = await mentionable(ctx.db, idea, parsed.data.mentionIds, actor.userId);
    const created = await ctx.db.$transaction(async (tx) => {
      const row = await tx.ideaComment.create({
        data: { ideaId, authorId: actor.userId, body: parsed.data.body, mentionIds },
        include: COMMENT_INCLUDE,
      });
      // Commenting is taking part: you hear about the replies. Not for the owner, who
      // hears about their own idea regardless (and is never counted as a follower).
      if (idea.submitterId !== actor.userId) {
        await tx.ideaFollow.upsert({
          where: { ideaId_userId: { ideaId, userId: actor.userId } },
          create: { ideaId, userId: actor.userId },
          update: {},
        });
      }

      // Notifications in the comment's own transaction (the P13 rule: a committed event
      // never loses its notification). Each person gets ONE line: named → MENTIONED;
      // otherwise the owner and followers → COMMENT_ADDED. Never the author.
      const excerpt = commentExcerpt(parsed.data.body);
      const actorName = row.author.displayName;
      const mentioned = new Set(mentionIds);
      await recordPeopleNotifications(tx, {
        ideaId, actorId: actor.userId, recipientIds: mentionIds,
        payload: (ideaTitle) => ({ event: "MENTIONED", ideaTitle, actorName, commentId: row.id, excerpt }),
      });
      // The owner is left out of `recordPeopleNotifications` by design; a mentioned owner
      // still gets the owner line below rather than nothing.
      await recordIdeaNotification(tx, {
        ideaId, actorId: actor.userId,
        payload: (ideaTitle) => ({
          event: "COMMENT_ADDED", ideaTitle, actorName, commentId: row.id, excerpt, audience: "OWNER",
        }),
      });
      const followers = (await ideaFollowerIds(tx, ideaId)).filter((id) => !mentioned.has(id));
      await recordPeopleNotifications(tx, {
        ideaId, actorId: actor.userId, recipientIds: followers,
        payload: (ideaTitle) => ({
          event: "COMMENT_ADDED", ideaTitle, actorName, commentId: row.id, excerpt, audience: "FOLLOWER",
        }),
      });
      return row;
    });

    const names = await namesFor(ctx.db, [created]);
    return present(created, actor, idea, names);
  });

  handlers.set("updateIdeaComment", async (request, reply, ctx) => {
    const actor = requireActor(request);
    const { commentId } = request.params as { commentId: string };
    const parsed = UpdateIdeaCommentRequest.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, "VALIDATION_FAILED", parsed.error.issues[0]?.message ?? "Invalid comment");
    }
    const row = await loadComment(ctx.db, commentId);
    const idea = row ? await loadIdea(ctx.db, row.ideaId) : null;
    if (!row || !idea || !can(actor, "idea:read", idea).allowed) return sendError(reply, "NOT_FOUND", NO_COMMENT);
    if (row.authorId !== actor.userId || stateOf(row) !== "VISIBLE" || !can(actor, "idea:comment", idea).allowed) {
      return sendError(reply, "FORBIDDEN", "Only its author can edit a comment, while comments are open");
    }

    const mentionIds = await mentionable(ctx.db, idea, parsed.data.mentionIds, actor.userId);
    const updated = await ctx.db.ideaComment.update({
      where: { id: commentId },
      data: { body: parsed.data.body, mentionIds, editedAt: new Date() },
      include: COMMENT_INCLUDE,
    });
    return present(updated, actor, idea, await namesFor(ctx.db, [updated]));
  });

  handlers.set("deleteIdeaComment", async (request, reply, ctx) => {
    const actor = requireActor(request);
    const { commentId } = request.params as { commentId: string };
    const row = await loadComment(ctx.db, commentId);
    const idea = row ? await loadIdea(ctx.db, row.ideaId) : null;
    if (!row || !idea || !can(actor, "idea:read", idea).allowed) return sendError(reply, "NOT_FOUND", NO_COMMENT);
    if (row.authorId !== actor.userId) return sendError(reply, "FORBIDDEN", "Only its author can delete a comment");
    if (stateOf(row) !== "VISIBLE") return present(row, actor, idea, new Map()); // already gone — idempotent

    // The words go (a person withdrawing what they wrote expects it gone, not merely
    // hidden); the row stays so the thread shows a "comment deleted" line in its place.
    const updated = await ctx.db.ideaComment.update({
      where: { id: commentId },
      data: { deletedAt: new Date(), body: "(deleted)", mentionIds: [] },
      include: COMMENT_INCLUDE,
    });
    return present(updated, actor, idea, new Map());
  });

  handlers.set("hideIdeaComment", async (request, reply, ctx) => {
    const actor = requireActor(request);
    const { commentId } = request.params as { commentId: string };
    const parsed = HideIdeaCommentRequest.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, "VALIDATION_FAILED", parsed.error.issues[0]?.message ?? "A reason is required");
    }
    const row = await loadComment(ctx.db, commentId);
    const idea = row ? await loadIdea(ctx.db, row.ideaId) : null;
    if (!row || !idea || !can(actor, "comment:moderate").allowed) return sendError(reply, "NOT_FOUND", NO_COMMENT);
    if (stateOf(row) !== "VISIBLE") return present(row, actor, idea, new Map());

    const updated = await ctx.db.$transaction(async (tx) => {
      const hidden = await tx.ideaComment.update({
        where: { id: commentId },
        data: { hiddenAt: new Date(), hiddenById: actor.userId, hiddenReason: parsed.data.reason },
        include: COMMENT_INCLUDE,
      });
      // The withheld text goes into the audit row: the moderation decision stays
      // reviewable (was it fair?) even though no reader of the thread can see it.
      await writeAudit(tx, {
        actorId: actor.userId, action: "comment.hide", entityType: "idea", entityId: row.ideaId,
        before: { commentId, authorId: row.authorId, body: row.body },
        after: { hidden: true },
        reason: parsed.data.reason, requestId: request.id,
      });
      return hidden;
    });
    return present(updated, actor, idea, new Map());
  });

  handlers.set("setIdeaFollow", async (request, reply, ctx) => {
    const actor = requireActor(request);
    const { ideaId } = request.params as { ideaId: string };
    const parsed = SetIdeaFollowRequest.safeParse(request.body);
    if (!parsed.success) return sendError(reply, "VALIDATION_FAILED", "Say whether to follow");
    const idea = await loadIdea(ctx.db, ideaId);
    if (!idea || !can(actor, "idea:read", idea).allowed) return sendError(reply, "NOT_FOUND", NO_IDEA);

    // The owner hears about their own idea regardless, so they are never a follower row.
    if (idea.submitterId !== actor.userId) {
      if (parsed.data.following) {
        await ctx.db.ideaFollow.upsert({
          where: { ideaId_userId: { ideaId, userId: actor.userId } },
          create: { ideaId, userId: actor.userId },
          update: {},
        });
      } else {
        await ctx.db.ideaFollow.deleteMany({ where: { ideaId, userId: actor.userId } });
      }
    }
    return followState(ctx.db, ideaId, actor.userId);
  });

  handlers.set("searchPeople", async (request, reply, ctx) => {
    const actor = requireActor(request);
    const parsed = SearchPeopleQuery.safeParse(request.query);
    if (!parsed.success) return sendError(reply, "VALIDATION_FAILED", "Type a name to search");

    let idea: IdeaResource | null = null;
    if (parsed.data.ideaId) {
      idea = await loadIdea(ctx.db, parsed.data.ideaId);
      // An idea the caller cannot open behaves like no idea: no list of who can see it.
      if (!idea || !can(actor, "idea:read", idea).allowed) return { items: [] };
    }
    const users = await ctx.db.user.findMany({
      where: {
        isActive: true,
        id: { not: actor.userId },
        displayName: { contains: parsed.data.q, mode: "insensitive" },
      },
      select: {
        id: true, displayName: true, department: { select: { name: true } }, roles: { select: { role: true } },
      },
      orderBy: { displayName: "asc" },
      take: 40,
    });
    const target = idea;
    const items = users
      .filter(
        (u) => !target || can({ userId: u.id, roles: u.roles.map((r) => r.role as Role) }, "idea:read", target).allowed,
      )
      .slice(0, 8)
      .map((u) => ({ id: u.id, displayName: u.displayName, departmentName: u.department?.name ?? null }));
    return { items };
  });
}

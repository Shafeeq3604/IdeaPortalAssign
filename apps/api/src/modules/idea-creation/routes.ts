import {
  CreateIdeaCreationConversationRequest, SendIdeaCreationMessageRequest,
  UpdateIdeaCreationDraftRequest, EMPTY_IDEA_CREATION_DRAFT,
  type DraftField, type IdeaCreationDraft,
} from "@iep/contracts";
import type { Handler } from "../../server.js";
import { requireActor, sendError } from "../../server.js";

/**
 * AI-native idea creation routes (platform-transformation brief §1/§2/§7).
 *
 * Standalone by design, same as discovery: nothing here reads or writes `ideas`,
 * `idea_versions`, or any pipeline/evaluation table. A conversation is scratch state —
 * the existing `createIdea`/`createVersion` handlers (`../idea/routes.js`) remain the
 * only way an `Idea` row is ever created. "Review my idea" is a client-side mapping,
 * never a call into this module.
 */

const NOT_FOUND = "No conversation with that id";

function parseDraft(value: unknown): IdeaCreationDraft {
  if (!value || typeof value !== "object") return EMPTY_IDEA_CREATION_DRAFT;
  return { ...EMPTY_IDEA_CREATION_DRAFT, ...(value as Partial<IdeaCreationDraft>) };
}

/** Shared by every handler that returns a conversation — one place the response shape
 *  is built, so `createIdeaCreationConversation`/`getIdeaCreationConversation`/
 *  `sendIdeaCreationMessage`/`updateIdeaCreationDraft` cannot drift from each other. */
function present(
  row: {
    id: string;
    status: string;
    turnCount: number;
    draft: unknown;
    readyToReview: boolean;
    suggestedReplies: string[];
    errorCode: string | null;
    createdAt: Date;
    updatedAt: Date;
    messages: { id: string; role: string; content: string; createdAt: Date }[];
  },
) {
  return {
    id: row.id,
    status: row.status,
    turnCount: row.turnCount,
    draft: parseDraft(row.draft),
    suggestedReplies: row.suggestedReplies,
    readyToReview: row.readyToReview,
    errorCode: row.errorCode,
    messages: row.messages.map((m) => ({
      id: m.id, role: m.role, content: m.content, createdAt: m.createdAt.toISOString(),
    })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const CONVERSATION_INCLUDE = { messages: { orderBy: { createdAt: "asc" as const } } };

export function registerIdeaCreationRoutes(handlers: Map<string, Handler>): void {
  handlers.set("createIdeaCreationConversation", async (request, reply, ctx) => {
    const actor = requireActor(request);
    const parsed = CreateIdeaCreationConversationRequest.safeParse(request.body);
    if (!parsed.success) return sendError(reply, "VALIDATION_FAILED", "That message could not be read");

    const openingMessage = parsed.data.message?.trim();
    const row = await ctx.db.ideaCreationConversation.create({
      data: {
        userId: actor.userId,
        status: openingMessage ? "AWAITING_AI" : "ACTIVE",
        draft: EMPTY_IDEA_CREATION_DRAFT as never,
        ...(openingMessage
          ? { messages: { create: { role: "USER", content: openingMessage } } }
          : {}),
      },
      include: CONVERSATION_INCLUDE,
    });

    // Same degrade-never-throw contract as discovery/analysis: the conversation (and its
    // opening message, if any) is already saved either way.
    const openingMessageId = row.messages[0]?.id;
    const finalRow =
      openingMessage && openingMessageId &&
      !(await ctx.ideaCreation.enqueue({ conversationId: row.id, messageId: openingMessageId }))
      ? await ctx.db.ideaCreationConversation.update({
          where: { id: row.id },
          data: { status: "ACTIVE", errorCode: "QUEUE_UNAVAILABLE" },
          include: CONVERSATION_INCLUDE,
        })
      : row;

    return present(finalRow);
  });

  handlers.set("getIdeaCreationConversation", async (request, reply, ctx) => {
    const actor = requireActor(request);
    const { conversationId } = request.params as { conversationId: string };
    const row = await ctx.db.ideaCreationConversation.findUnique({
      where: { id: conversationId },
      include: CONVERSATION_INCLUDE,
    });
    // Existence of another user's conversation is not disclosed (same rule as SPC-15).
    if (!row || row.userId !== actor.userId) return sendError(reply, "NOT_FOUND", NOT_FOUND);
    return present(row);
  });

  /*
   * Abandoned conversations piled up on the Create page ("Untitled idea · 1 message",
   * four of them) with no way to clear them. Own conversations only, and never while the
   * worker is writing a reply: it would find the row gone mid-turn and retry a job for
   * nothing. Messages go with it (onDelete: Cascade).
   */
  handlers.set("deleteIdeaCreationConversation", async (request, reply, ctx) => {
    const actor = requireActor(request);
    const { conversationId } = request.params as { conversationId: string };
    const row = await ctx.db.ideaCreationConversation.findUnique({
      where: { id: conversationId },
      select: { userId: true, status: true },
    });
    if (!row || row.userId !== actor.userId) return sendError(reply, "NOT_FOUND", NOT_FOUND);
    if (row.status === "AWAITING_AI") {
      return sendError(reply, "CONCURRENT_MODIFICATION", "The assistant is still replying — try again in a moment");
    }
    await ctx.db.ideaCreationConversation.deleteMany({ where: { id: conversationId, userId: actor.userId } });
    return { id: conversationId };
  });

  handlers.set("sendIdeaCreationMessage", async (request, reply, ctx) => {
    const actor = requireActor(request);
    const { conversationId } = request.params as { conversationId: string };
    const parsed = SendIdeaCreationMessageRequest.safeParse(request.body);
    if (!parsed.success) return sendError(reply, "VALIDATION_FAILED", "A message is required");

    const existing = await ctx.db.ideaCreationConversation.findUnique({ where: { id: conversationId } });
    if (!existing || existing.userId !== actor.userId) return sendError(reply, "NOT_FOUND", NOT_FOUND);
    if (existing.status === "HANDED_OFF") {
      return sendError(reply, "VALIDATION_FAILED", "This conversation was already handed off to a form");
    }

    /**
     * Atomic claim, not read-then-write: two concurrent sends (a double-click, a client
     * retry) can both read `status: "ACTIVE"` above before either writes. Whichever one
     * actually flips it to `AWAITING_AI` here wins — the loser's `count` comes back 0,
     * so only one message and one enqueued turn ever result from one exchange.
     */
    const claimed = await ctx.db.ideaCreationConversation.updateMany({
      where: { id: conversationId, userId: actor.userId, status: "ACTIVE" },
      data: { status: "AWAITING_AI" },
    });
    if (claimed.count === 0) {
      return sendError(reply, "VALIDATION_FAILED", "Still waiting on a reply to the last message");
    }

    const userMessage = await ctx.db.ideaCreationMessage.create({
      data: { conversationId, role: "USER", content: parsed.data.message },
    });
    const updated = await ctx.db.ideaCreationConversation.findUniqueOrThrow({
      where: { id: conversationId },
      include: CONVERSATION_INCLUDE,
    });

    const enqueued = await ctx.ideaCreation.enqueue({ conversationId, messageId: userMessage.id });
    const finalRow = enqueued
      ? updated
      : await ctx.db.ideaCreationConversation.update({
          where: { id: conversationId },
          data: { status: "ACTIVE", errorCode: "QUEUE_UNAVAILABLE" },
          include: CONVERSATION_INCLUDE,
        });

    return present(finalRow);
  });

  handlers.set("updateIdeaCreationDraft", async (request, reply, ctx) => {
    const actor = requireActor(request);
    const { conversationId } = request.params as { conversationId: string };
    const parsed = UpdateIdeaCreationDraftRequest.safeParse(request.body);
    if (!parsed.success) return sendError(reply, "VALIDATION_FAILED", "That correction could not be read");

    const existing = await ctx.db.ideaCreationConversation.findUnique({ where: { id: conversationId } });
    if (!existing || existing.userId !== actor.userId) return sendError(reply, "NOT_FOUND", NOT_FOUND);

    /**
     * Brief §4: user correction always wins, and always reads CONFIRMED — a person
     * just said so directly, which is the strongest status a field can hold. Only
     * fields actually present in the request are touched; `useCases`, sent as a whole
     * array or not at all, has no per-field status to set (see `IdeaCreationDraft`).
     */
    const current = parseDraft(existing.draft);
    const next: IdeaCreationDraft = {
      ...current,
      fieldStatus: { ...current.fieldStatus },
    };
    const textFields: readonly DraftField[] = [
      "title", "problemStatement", "proposedSolution", "targetUsers", "expectedOutcome",
    ];
    for (const field of textFields) {
      const value = parsed.data[field];
      if (value === undefined) continue;
      next[field] = value;
      next.fieldStatus[field] = value === null || value.trim() === "" ? "MISSING" : "CONFIRMED";
    }
    if (parsed.data.useCases !== undefined) next.useCases = parsed.data.useCases;

    const updated = await ctx.db.ideaCreationConversation.update({
      where: { id: conversationId },
      data: { draft: next as never },
      include: CONVERSATION_INCLUDE,
    });
    return present(updated);
  });

  handlers.set("listIdeaCreationConversations", async (request, _reply, ctx) => {
    const actor = requireActor(request);
    const rows = await ctx.db.ideaCreationConversation.findMany({
      where: { userId: actor.userId },
      orderBy: { updatedAt: "desc" },
      // Unlike every other list endpoint, this contract has no page envelope yet — take
      // the most recent conversations rather than growing unboundedly for a heavy user.
      take: 50,
    });
    return {
      items: rows.map((r) => {
        const draft = parseDraft(r.draft);
        return {
          id: r.id,
          status: r.status,
          title: draft.title,
          turnCount: r.turnCount,
          updatedAt: r.updatedAt.toISOString(),
        };
      }),
    };
  });
}

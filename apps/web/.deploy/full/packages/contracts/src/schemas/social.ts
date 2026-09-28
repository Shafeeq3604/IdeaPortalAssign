import { z } from "zod";
import { ActorRef, Id, Timestamp } from "./common.js";

/**
 * P18 — the social layer (SPEC §14 M4, D-24): comments with @mentions, following an idea,
 * and the people directory the @mention picker searches.
 *
 * Nothing here feeds the score (P-5 / REQUIREMENTS §14): comments and follows are
 * conversation, not evaluation. The one social signal that does count, "I could help
 * build this", stays where it always was — the structured-feedback signals (review.ts),
 * which the idea page now also shows as the idea's team.
 */

export const COMMENT_MAX_LENGTH = 2000;

/** A person as the picker and a comment's mentions show them — never an email. */
export const PersonRef = z.object({ id: Id, displayName: z.string() });
export type PersonRef = z.infer<typeof PersonRef>;

/**
 * VISIBLE — the text is shown. DELETED — its author withdrew it. HIDDEN — a moderator
 * withheld it, with a reason everyone can read. The row stays in the thread either way,
 * so a reply never answers a silent gap.
 */
export const CommentState = z.enum(["VISIBLE", "DELETED", "HIDDEN"]);
export type CommentState = z.infer<typeof CommentState>;

export const IdeaComment = z.object({
  id: Id,
  ideaId: Id,
  author: ActorRef,
  state: CommentState,
  /** Null unless VISIBLE. */
  body: z.string().nullable(),
  /** The people actually picked when it was written; empty unless VISIBLE. */
  mentions: z.array(PersonRef),
  createdAt: Timestamp,
  editedAt: Timestamp.nullable(),
  /** Only when HIDDEN. */
  hiddenReason: z.string().nullable(),
  /** What the signed-in person may do to this comment — computed by the API, never guessed. */
  permissions: z.object({ canEdit: z.boolean(), canDelete: z.boolean(), canHide: z.boolean() }),
});
export type IdeaComment = z.infer<typeof IdeaComment>;

export const ListIdeaCommentsResponse = z.object({
  /** Oldest first — a thread reads top to bottom. */
  items: z.array(IdeaComment),
  canComment: z.boolean(),
});
export type ListIdeaCommentsResponse = z.infer<typeof ListIdeaCommentsResponse>;

const CommentBody = z.string().trim().min(1, "Write something first").max(COMMENT_MAX_LENGTH);

export const CreateIdeaCommentRequest = z.object({
  body: CommentBody,
  /** Who the author picked from the @ list. Anyone who cannot open the idea is dropped. */
  mentionIds: z.array(Id).max(20).default([]),
});
export type CreateIdeaCommentRequest = z.infer<typeof CreateIdeaCommentRequest>;

export const UpdateIdeaCommentRequest = z.object({
  body: CommentBody,
  /** Edits do not re-notify: someone added in an edit is recorded but not pinged. */
  mentionIds: z.array(Id).max(20).default([]),
});
export type UpdateIdeaCommentRequest = z.infer<typeof UpdateIdeaCommentRequest>;

export const HideIdeaCommentRequest = z.object({
  reason: z.string().trim().min(3, "Say why, so everyone reading the thread knows").max(300),
});
export type HideIdeaCommentRequest = z.infer<typeof HideIdeaCommentRequest>;

export const SetIdeaFollowRequest = z.object({ following: z.boolean() });
export type SetIdeaFollowRequest = z.infer<typeof SetIdeaFollowRequest>;

export const IdeaFollowState = z.object({
  ideaId: Id,
  following: z.boolean(),
  followerCount: z.number().int().min(0),
});
export type IdeaFollowState = z.infer<typeof IdeaFollowState>;

export const SearchPeopleQuery = z.object({
  q: z.string().trim().min(1).max(80),
  /** When given, only people who can open this idea — the @ picker never offers someone
   *  who would receive a notification they cannot follow. */
  ideaId: Id.optional(),
});
export type SearchPeopleQuery = z.infer<typeof SearchPeopleQuery>;

export const SearchPeopleResponse = z.object({
  items: z.array(PersonRef.extend({ departmentName: z.string().nullable() })).max(8),
});
export type SearchPeopleResponse = z.infer<typeof SearchPeopleResponse>;

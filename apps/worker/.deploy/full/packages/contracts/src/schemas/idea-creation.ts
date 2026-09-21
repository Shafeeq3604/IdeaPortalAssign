import { z } from "zod";
import * as C from "./common.js";

/**
 * AI-native idea creation (platform-transformation brief §1/§2/§7) — a persisted,
 * multi-turn conversation that progressively builds a structured idea draft.
 *
 * Deliberately separate from schemas/discovery.ts: Discovery is one-shot research
 * (a query → possible ideas, standalone, SPC-13). This is an interactive session that
 * develops ONE specific idea with the employee, turn by turn. Its own small, additive
 * surface — no relationship to `DiscoveryQuery`, `Idea`, or `IdeaVersion`.
 *
 * A conversation is scratch state. Nothing here ever creates an `Idea` row — the
 * existing `createIdea`/`createVersion` endpoints (schemas/idea.ts) remain the only
 * validated path to one. "Review my idea" is a client-side mapping of `IdeaCreationDraft`
 * into `IdeaFormValues`, not a server call.
 */

export const IdeaCreationStatus = z.enum(["ACTIVE", "AWAITING_AI", "HANDED_OFF"]);
export type IdeaCreationStatus = z.infer<typeof IdeaCreationStatus>;

export const MessageRole = z.enum(["USER", "AI"]);
export type MessageRole = z.infer<typeof MessageRole>;

/** Whether the employee confirmed a field, the AI inferred it, or it's not stated yet —
 *  the mechanism behind "never silently authoritative" (brief §4): a field only ever
 *  reads CONFIRMED once the person said or explicitly accepted it. */
export const DraftFieldStatus = z.enum(["CONFIRMED", "INFERRED", "MISSING"]);
export type DraftFieldStatus = z.infer<typeof DraftFieldStatus>;

const DraftField = z.enum([
  "title", "problemStatement", "proposedSolution", "targetUsers", "expectedOutcome",
]);
export type DraftField = z.infer<typeof DraftField>;

/**
 * The evolving structured idea (brief §4). `useCases` has no per-field status of its
 * own — a list either has entries (from what the user said or confirmed) or it
 * doesn't; there is no single "inferred vs confirmed" state for a whole array the way
 * there is for one text field.
 */
export const IdeaCreationDraft = z.object({
  title: z.string().nullable(),
  problemStatement: z.string().nullable(),
  proposedSolution: z.string().nullable(),
  targetUsers: z.string().nullable(),
  useCases: z.array(z.string()).default([]),
  expectedOutcome: z.string().nullable(),
  fieldStatus: z.record(DraftField, DraftFieldStatus),
  missingInformation: z.array(z.string()).default([]),
});
export type IdeaCreationDraft = z.infer<typeof IdeaCreationDraft>;

/** An empty draft — every field missing. What a brand-new conversation starts from,
 *  and the safe fallback if a row's `draft` JSON is ever unreadable. */
export const EMPTY_IDEA_CREATION_DRAFT: IdeaCreationDraft = {
  title: null,
  problemStatement: null,
  proposedSolution: null,
  targetUsers: null,
  useCases: [],
  expectedOutcome: null,
  fieldStatus: {
    title: "MISSING", problemStatement: "MISSING", proposedSolution: "MISSING",
    targetUsers: "MISSING", expectedOutcome: "MISSING",
  },
  missingInformation: [],
};

export const IdeaCreationMessage = z.object({
  id: C.Id,
  role: MessageRole,
  content: z.string(),
  createdAt: z.string(),
});
export type IdeaCreationMessage = z.infer<typeof IdeaCreationMessage>;

export const IdeaCreationConversation = z.object({
  id: C.Id,
  status: IdeaCreationStatus,
  turnCount: z.number().int().min(0),
  draft: IdeaCreationDraft,
  /** The chips shown below the input — the AI's own suggested next things to say,
   *  from its most recent turn. Empty once handed off. */
  suggestedReplies: z.array(z.string()).default([]),
  /** The AI's own signal that the draft is developed enough to review (brief §3's
   *  "stop asking questions when the idea is sufficiently defined"). The employee may
   *  always act sooner — this never gates the "Review my idea" button shut. */
  readyToReview: z.boolean(),
  errorCode: z.string().nullable(),
  messages: z.array(IdeaCreationMessage),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type IdeaCreationConversation = z.infer<typeof IdeaCreationConversation>;

/** One row in the user's own conversation list — never another user's. */
export const IdeaCreationConversationSummary = z.object({
  id: C.Id,
  status: IdeaCreationStatus,
  title: z.string().nullable(),
  turnCount: z.number().int().min(0),
  updatedAt: z.string(),
});
export type IdeaCreationConversationSummary = z.infer<typeof IdeaCreationConversationSummary>;

export const ListIdeaCreationConversationsResponse = z.object({
  items: z.array(IdeaCreationConversationSummary),
});
export type ListIdeaCreationConversationsResponse = z.infer<
  typeof ListIdeaCreationConversationsResponse
>;

const MessageText = z.string().trim().min(1).max(4_000);

/** An opening message is optional — the page can start a conversation before the
 *  employee has typed anything, and show the AI's first question. */
export const CreateIdeaCreationConversationRequest = z.object({
  message: MessageText.optional(),
});
export type CreateIdeaCreationConversationRequest = z.infer<
  typeof CreateIdeaCreationConversationRequest
>;

export const SendIdeaCreationMessageRequest = z.object({
  message: MessageText,
});
export type SendIdeaCreationMessageRequest = z.infer<typeof SendIdeaCreationMessageRequest>;

/**
 * User-side correction of the draft (brief §4: "never silently authoritative" — the
 * employee can always overrule the AI). Independent of any AI turn: this is a direct
 * edit, not a message. Every corrected field is marked CONFIRMED — a person just said
 * so, which is the strongest status a field can hold.
 */
// Mirrors the bounds `schemas/idea.ts`'s `IdeaVersionInput` enforces on the fields these
// eventually become at handoff — this endpoint had none at all, so an authenticated user
// could PATCH an unbounded string (or a huge `useCases` array) into the `draft` JSONB
// column, which is then re-sent to the AI provider verbatim on the next turn.
export const UpdateIdeaCreationDraftRequest = z.object({
  title: z.string().trim().max(200).nullable().optional(),
  problemStatement: z.string().trim().max(2_000).nullable().optional(),
  proposedSolution: z.string().trim().max(20_000).nullable().optional(),
  targetUsers: z.string().trim().max(2_000).nullable().optional(),
  useCases: z.array(z.string().trim().min(1).max(300)).max(10).optional(),
  expectedOutcome: z.string().trim().max(2_000).nullable().optional(),
});
export type UpdateIdeaCreationDraftRequest = z.infer<typeof UpdateIdeaCreationDraftRequest>;

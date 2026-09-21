import type { PrismaClient } from "@iep/db";
import {
  redact, type IdeaCreationProvider,
} from "@iep/ai";
import { EMPTY_IDEA_CREATION_DRAFT, type DraftField, type IdeaCreationDraft } from "@iep/contracts";
import type { ObservabilityClient } from "./observability.js";

/**
 * AI-native idea creation (platform-transformation brief §7) — job runner.
 *
 * One turn, one job. The worker reads the conversation's FULL current state (messages +
 * draft) fresh from the database on every run rather than trusting anything cached — the
 * same reason a manual draft correction between turns (via `updateIdeaCreationDraft`,
 * apps/api) is respected automatically: this always merges the AI's patch onto whatever
 * `draft` currently holds, never onto a stale copy carried from an earlier turn.
 */

export interface IdeaCreationDeps {
  readonly db: PrismaClient;
  readonly provider: IdeaCreationProvider;
  readonly redactionEnabled: boolean;
  readonly observability: ObservabilityClient;
}

function parseDraft(value: unknown): IdeaCreationDraft {
  if (!value || typeof value !== "object") return EMPTY_IDEA_CREATION_DRAFT;
  return { ...EMPTY_IDEA_CREATION_DRAFT, ...(value as Partial<IdeaCreationDraft>) };
}

const DRAFT_TEXT_FIELDS: readonly DraftField[] = [
  "title", "problemStatement", "proposedSolution", "targetUsers", "expectedOutcome",
];

/**
 * Message history is redacted per-message before it ever reaches the provider (below) —
 * the draft was not, even though `updateIdeaCreationDraft` (apps/api) writes it from raw
 * user input that has never passed through `redact()`. Same treatment here, only for
 * what's actually sent outbound: the persisted/merged draft stays exactly as the person
 * wrote it, since this product's own promise ("your name and email are not sent") is
 * about the AI provider, not about what the person sees back on their own screen.
 */
function redactDraftForProvider(draft: IdeaCreationDraft, enabled: boolean): IdeaCreationDraft {
  const out = { ...draft };
  for (const field of DRAFT_TEXT_FIELDS) {
    const value = draft[field];
    if (value) out[field] = redact(value, enabled).text;
  }
  out.useCases = draft.useCases.map((u) => redact(u, enabled).text);
  return out;
}

/**
 * Merge one turn's patch onto the running draft (brief §4 — confirmed/inferred/missing,
 * user correction always wins).
 *
 * Only fields the PATCH actually names are touched — everything else, including
 * anything the employee corrected by hand since the last AI turn, passes through
 * untouched. `useCases` replaces rather than appends when present: the AI is given the
 * full current list as context (`draftSummaryFor` in packages/ai), so a returned list is
 * its own complete, reconsidered one, not a delta to concatenate.
 */
function mergeDraft(
  current: IdeaCreationDraft,
  patch: Readonly<Partial<Record<DraftField, string>> & { useCases?: readonly string[] }>,
  confidence: Readonly<Partial<Record<DraftField, "CONFIRMED" | "INFERRED">>>,
  missingInformation: readonly string[],
): IdeaCreationDraft {
  const next: IdeaCreationDraft = {
    ...current,
    fieldStatus: { ...current.fieldStatus },
    missingInformation: [...missingInformation],
  };

  const fields: readonly DraftField[] = [
    "title", "problemStatement", "proposedSolution", "targetUsers", "expectedOutcome",
  ];
  for (const field of fields) {
    const value = patch[field];
    if (value === undefined) continue;
    next[field] = value;
    next.fieldStatus[field] = confidence[field] ?? "INFERRED";
  }
  if (patch.useCases !== undefined) next.useCases = [...patch.useCases];

  return next;
}

export async function runIdeaCreationTurn(
  deps: IdeaCreationDeps,
  input: { readonly conversationId: string },
): Promise<void> {
  const { db, provider } = deps;

  const conversation = await db.ideaCreationConversation.findUnique({
    where: { id: input.conversationId },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      user: { select: { id: true, displayName: true } },
    },
  });
  if (!conversation) throw new Error(`idea creation conversation ${input.conversationId} no longer exists`);

  const currentDraft = parseDraft(conversation.draft);
  const history = conversation.messages.map((m) => ({
    role: m.role,
    // SPC-3-style redaction, same as every other surface that hands employee text to a
    // model — applied per message so a long-running conversation is never redacted once
    // and then trusted forever as new messages arrive unredacted.
    content: redact(m.content, deps.redactionEnabled).text,
  }));

  const started = Date.now();
  const outcome = await provider.turn({
    history,
    currentDraft: redactDraftForProvider(currentDraft, deps.redactionEnabled),
  });

  deps.observability.record({
    agentId: "idea-creation.agent",
    agentName: "Idea Creation Agent",
    userId: conversation.userId,
    userName: conversation.user.displayName,
    interactionType: "idea-creation-turn",
    businessTransactionType: "idea_creation_conversation",
    businessTransactionId: conversation.id,
    businessTransactionName: currentDraft.title,
    provider: provider.name,
    modelId: outcome.ok ? outcome.model : "unknown",
    inputTokens: outcome.ok ? outcome.usage.inputTokens : null,
    outputTokens: outcome.ok ? outcome.usage.outputTokens : null,
    latencyMs: Date.now() - started,
    inputPayload: { systemPrompt: "idea-creation", history },
    outputPayload: outcome.ok
      ? { aiMessage: outcome.aiMessage, draftPatch: outcome.draftPatch }
      : null,
    status: outcome.ok ? "success" : "error",
    error: outcome.ok ? null : outcome.errorCode,
    errorType: outcome.ok ? null : outcome.errorCode,
  });

  if (!outcome.ok) {
    await db.ideaCreationConversation.update({
      where: { id: conversation.id },
      data: { status: "ACTIVE", errorCode: outcome.errorCode },
    });
    return;
  }

  // Re-read the draft fresh rather than reusing `currentDraft` from before the (multi-
  // second) `provider.turn()` call above: `updateIdeaCreationDraft` (apps/api) has no
  // AWAITING_AI guard, so a manual correction landing in that window would otherwise be
  // silently discarded when this turn's patch is merged and written back — the exact
  // thing brief §4's "user correction always wins" promises can't happen.
  const latest = await db.ideaCreationConversation.findUniqueOrThrow({
    where: { id: conversation.id },
    select: { draft: true },
  });
  const nextDraft = mergeDraft(
    parseDraft(latest.draft),
    outcome.draftPatch,
    outcome.fieldConfidence,
    outcome.missingInformation,
  );

  await db.$transaction([
    db.ideaCreationMessage.create({
      data: {
        conversationId: conversation.id,
        role: "AI",
        content: outcome.aiMessage,
        draftAfter: nextDraft as never,
      },
    }),
    db.ideaCreationConversation.update({
      where: { id: conversation.id },
      data: {
        status: "ACTIVE",
        draft: nextDraft as never,
        readyToReview: outcome.readyToReview,
        suggestedReplies: [...outcome.suggestedReplies],
        provider: provider.name,
        errorCode: null,
        turnCount: { increment: 1 },
      },
    }),
  ]);
}

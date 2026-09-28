import * as React from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowRight, Check, CircleHelp, ClipboardList, History, MessageSquareText, PenSquare, Send, Sparkles, SquarePen, Trash2,
} from "lucide-react";
import { ApiError } from "../../app/api-client";
import { Badge, Button, Skeleton, Textarea } from "@iep/ui";
import { ago } from "../../app/relative-time";
import type { DraftField, IdeaCreationDraft, IdeaCreationMessage } from "@iep/contracts";
import { PageHeading } from "../../app/PageHero";
import { BrandMark } from "../../app/BrandMark";
import type { IdeaFormValues } from "../ideas/IdeaForm";
import {
  useCreateIdeaCreationConversation, useDeleteIdeaCreationConversation, useIdeaCreationConversation,
  useIdeaCreationHistory,
  useSendIdeaCreationMessage, useUpdateIdeaCreationDraft,
} from "./api";

/**
 * Platform-transformation brief §7 — the primary idea-creation experience.
 *
 * "Start with an idea → talk to the agent → watch the idea take shape → review → submit."
 * A conversation is scratch state (packages/contracts/src/schemas/idea-creation.ts):
 * nothing here ever creates an `Idea` row. "Review my idea" below is a client-side mapping
 * of the evolving `IdeaCreationDraft` into `IdeaFormValues`, handed off to the existing,
 * unchanged `IdeaForm` at `/ideas/new/manual` — that form remains the only validated path
 * to a real submission (brief §5: "do not bypass the existing validation/submission path").
 */

const FIELD_LABEL: Record<DraftField, string> = {
  title: "Title",
  problemStatement: "The problem",
  proposedSolution: "Proposed solution",
  targetUsers: "Target users",
  expectedOutcome: "Expected outcome",
};

const FIELD_ORDER: readonly DraftField[] = [
  "title", "problemStatement", "proposedSolution", "targetUsers", "expectedOutcome",
];

/** Maps the evolving draft onto the existing form's own fields (brief §5) — `useCases`
 *  passes through directly now that it is first-class end to end, no folding into
 *  `description`. Values are trimmed to the form schema's own limits, same as the
 *  Discovery handoff already does for its own prefill. */
function draftToPrefill(draft: IdeaCreationDraft): Partial<IdeaFormValues> {
  return {
    title: (draft.title ?? "").slice(0, 200),
    problemStatement: (draft.problemStatement ?? "").slice(0, 2_000),
    description: (draft.proposedSolution ?? "").slice(0, 20_000),
    expectedUsers: (draft.targetUsers ?? "").slice(0, 2_000),
    expectedOutcome: (draft.expectedOutcome ?? "").slice(0, 2_000),
    useCases: draft.useCases.slice(0, 10).map((u) => u.slice(0, 300)),
  };
}

/**
 * CONFIRMED reads as a person said so directly (the strongest state) — the same green
 * "done" language `IdeaForm` already uses for an answered section. INFERRED deliberately
 * avoids the analysis tab's reserved AI-surface treatment (SPEC §7.4: that pair belongs
 * to the single `Provenance` component, so it cannot quietly drift) — this is a small
 * field-level draft state, not the analysis surface that contract governs, so it gets its
 * own plain accent chip instead. MISSING is the quiet default.
 */
function StatusChip({ status }: { status: "CONFIRMED" | "INFERRED" | "MISSING" }) {
  if (status === "CONFIRMED") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-factor-up-bg px-2 py-0.5 text-100 font-semibold text-factor-up">
        <Check aria-hidden className="size-3" />
        Confirmed
      </span>
    );
  }
  if (status === "INFERRED") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-accent-100 px-2 py-0.5 text-100 font-semibold text-accent-700">
        <CircleHelp aria-hidden className="size-3" />
        AI-suggested
      </span>
    );
  }
  return (
    // P9 tester feedback: a filled grey "Missing" pill on every empty row read as a wall
    // of errors on a page that is, at the start, EXPECTED to be empty. Outlined and
    // worded as "not yet" — it is a to-do the agent is working through, not a failure.
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-100 font-semibold text-muted-foreground ring-1 ring-inset ring-border-strong">
      Not yet
    </span>
  );
}

/** One field in the evolving-idea panel. Editable in place — the mechanism behind
 *  "never silently authoritative" (brief §4): a click always lets the person overrule
 *  whatever the AI last wrote, and a save always lands as CONFIRMED (`routes.ts`). */
function DraftFieldRow({
  field, value, status, onSave, saving,
}: {
  field: DraftField;
  value: string | null;
  status: "CONFIRMED" | "INFERRED" | "MISSING";
  // `onSettled` fires once the save lands (success or failure) — this row stays open
  // until then instead of closing immediately, which used to re-render from the still-
  // stale `value` prop and make the edit visibly disappear before it actually saved.
  onSave: (value: string, onSettled: () => void) => void;
  saving: boolean;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value ?? "");
  const [pendingSave, setPendingSave] = React.useState(false);

  if (editing) {
    return (
      <div className="space-y-2 rounded-lg bg-card p-3 ring-1 ring-inset ring-accent-200">
        <p className="text-100 font-semibold uppercase tracking-wide text-muted-foreground">
          {FIELD_LABEL[field]}
        </p>
        <Textarea
          autoFocus
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="text-200"
        />
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            disabled={saving}
            onClick={() => {
              setPendingSave(true);
              onSave(draft, () => {
                setPendingSave(false);
                setEditing(false);
              });
            }}
          >
            {saving && pendingSave ? "Saving…" : "Save"}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="group rounded-lg p-3 transition-colors hover:bg-muted/60">
      <div className="flex items-start justify-between gap-2">
        <p className="text-100 font-semibold uppercase tracking-wide text-muted-foreground">
          {FIELD_LABEL[field]}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <StatusChip status={status} />
          <Button
            variant="link"
            size="icon"
            type="button"
            aria-label={`Edit ${FIELD_LABEL[field]}`}
            className="size-auto whitespace-normal font-normal hover:shadow-none active:scale-100 block shrink rounded-none text-[length:inherit] duration-150 ease-in-out hover:no-underline text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
            onClick={() => {
              setDraft(value ?? "");
              setEditing(true);
            }}
          >
            <SquarePen aria-hidden className="size-3.5" />
          </Button>
        </div>
      </div>
      <p className={`mt-1 text-200 leading-relaxed ${value ? "" : "text-muted-foreground"}`}>
        {value || "The agent will ask about this"}
      </p>
    </div>
  );
}

function UseCasesRow({
  useCases, onSave, saving,
}: {
  useCases: readonly string[];
  // Same reasoning as `DraftFieldRow` above — `onSettled` fires once the save actually
  // lands, so this row can stay open until then instead of snapping back early.
  onSave: (values: readonly string[], onSettled: () => void) => void;
  saving: boolean;
}) {
  const [editing, setEditing] = React.useState(false);
  const [text, setText] = React.useState(useCases.join("\n"));
  const [pendingSave, setPendingSave] = React.useState(false);

  if (editing) {
    return (
      <div className="space-y-2 rounded-lg bg-card p-3 ring-1 ring-inset ring-accent-200">
        <p className="text-100 font-semibold uppercase tracking-wide text-muted-foreground">Use cases</p>
        <Textarea
          autoFocus
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="One per line"
          className="text-200"
        />
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            disabled={saving}
            onClick={() => {
              setPendingSave(true);
              onSave(text.split("\n").map((s) => s.trim()).filter(Boolean), () => {
                setPendingSave(false);
                setEditing(false);
              });
            }}
          >
            {saving && pendingSave ? "Saving…" : "Save"}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="group rounded-lg p-3 transition-colors hover:bg-muted/60">
      <div className="flex items-start justify-between gap-2">
        <p className="text-100 font-semibold uppercase tracking-wide text-muted-foreground">Use cases</p>
        <Button
          variant="link"
          size="icon"
          type="button"
          aria-label="Edit use cases"
          className="size-auto whitespace-normal font-normal hover:shadow-none active:scale-100 block shrink rounded-none text-[length:inherit] duration-150 ease-in-out hover:no-underline shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
          onClick={() => {
            setText(useCases.join("\n"));
            setEditing(true);
          }}
        >
          <SquarePen aria-hidden className="size-3.5" />
        </Button>
      </div>
      {useCases.length > 0 ? (
        <ul className="mt-1 list-inside list-disc space-y-0.5 text-200 leading-relaxed">
          {useCases.map((u, i) => <li key={i}>{u}</li>)}
        </ul>
      ) : (
        <p className="mt-1 text-200 text-muted-foreground">The agent will ask who would use it, and how</p>
      )}
    </div>
  );
}

function MessageBubble({ message }: { message: IdeaCreationMessage }) {
  const fromUser = message.role === "USER";
  return (
    <div
      className={
        fromUser
          ? "ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-gradient-to-br from-accent-600 to-grad-to px-4 py-2 text-200 text-primary-foreground shadow-e1"
          : "mr-auto max-w-[85%] rounded-2xl rounded-bl-md bg-card px-4 py-3 shadow-e2 ring-1 ring-inset ring-border"
      }
    >
      {!fromUser ? (
        <div className="mb-1.5 flex items-center gap-1.5 text-100 text-muted-foreground">
          <span aria-hidden className="grid size-5 shrink-0 place-items-center rounded-full bg-accent-100 text-accent-700">
            <Sparkles className="size-3" />
          </span>
          <span>Idea agent</span>
        </div>
      ) : null}
      <p className="whitespace-pre-wrap text-200 leading-relaxed">{message.content}</p>
    </div>
  );
}

/** The starting screen — one big prompt, before any conversation exists. */
function StartScreen({ onStart, busy }: { onStart: (message: string) => void; busy: boolean }) {
  const [text, setText] = React.useState("");
  const STARTERS = [
    "Approvals for expense reports take too long and nobody knows why.",
    "Our onboarding checklist is still a shared spreadsheet people forget to update.",
    "I keep manually reconciling two systems that should already agree with each other.",
  ];

  return (
    <div className="dash-hero relative overflow-hidden rounded-2xl p-6 text-grad-ink shadow-e4-lit sm:p-8">
      {/* The product's own mark, as a large watermark (visual-identity pass) — see
          `WelcomeShell`'s gradient panel for the full reasoning. */}
      <BrandMark
        aria-hidden
        className="pointer-events-none absolute -right-12 -top-12 size-72 text-grad-ink opacity-[0.06]"
      />
      {/* `relative`: every real child needs to out-stack the absolutely-positioned
          watermark above, same reasoning as `DashboardHero`/`DiscoveryChatPage`. */}
      <div className="relative">
        <span className="inline-flex items-center gap-2 rounded-full bg-grad-ink/10 px-3 py-1 text-100 uppercase tracking-[0.06em] text-grad-ink-soft ring-1 ring-grad-rule">
          <Sparkles aria-hidden className="size-3" />
          AI-native idea creation
        </span>
        <h1 className="mt-3.5 font-serif text-600 font-extrabold leading-tight tracking-tight text-grad-ink">
          What's the idea?
        </h1>
        <p className="mt-2 max-w-[60ch] text-200 leading-relaxed text-grad-ink-soft">
          Describe it however it's in your head right now — a frustration, a half-formed
          thought, a sentence. The agent asks what's missing, one question at a time, and
          the idea takes shape on the right as you talk. Nothing is submitted until you
          review it yourself.
        </p>

        <form
          className="mt-5 rounded-xl bg-grad-ink/8 p-3 ring-1 ring-grad-rule"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) onStart(text.trim());
          }}
        >
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. Expense approvals take way too long and I don't know why."
            rows={3}
            maxLength={4_000}
            className="border-0 bg-transparent text-grad-ink shadow-none placeholder:text-grad-ink-soft/70 focus-visible:ring-0"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (text.trim()) onStart(text.trim());
              }
            }}
          />
          <div className="flex justify-end border-t border-grad-rule pt-2">
            <Button
              type="submit"
              disabled={!text.trim() || busy}
              className="bg-grad-highlight text-grad-from hover:opacity-90"
            >
              {busy ? "Starting…" : "Start"}
              <Send aria-hidden className="size-3.5" />
            </Button>
          </div>
        </form>

        <div className="mt-4 flex flex-wrap gap-2">
          {STARTERS.map((s) => (
            <Button
              variant="link"
              size="icon"
              key={s}
              type="button"
              disabled={busy}
              onClick={() => onStart(s)}
              className="size-auto whitespace-normal font-normal hover:shadow-none active:scale-100 block shrink duration-150 ease-in-out hover:no-underline rounded-full bg-grad-ink/8 px-3 py-1.5 text-100 text-grad-ink-soft ring-1 ring-grad-rule transition-colors hover:bg-grad-ink/15 disabled:pointer-events-none disabled:opacity-50"
            >
              "{s}"
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** A network/server failure on the current action, worded for whichever one it was. */
function mutationErrorMessage(error: unknown): string | null {
  if (!error) return null;
  if (error instanceof ApiError) return error.body.message;
  return "That didn't reach the server. Check your connection and try again.";
}

export function IdeaCreationPage() {
  const navigate = useNavigate();
  // The conversation id lives in the URL, not just component state — otherwise Back or a
  // reload remounts this page with nothing to resume, and a live conversation (already
  // saved server-side) reads as permanently lost.
  const [searchParams, setSearchParams] = useSearchParams();
  const conversationId = searchParams.get("c");
  const [input, setInput] = React.useState("");

  const create = useCreateIdeaCreationConversation();
  const conversation = useIdeaCreationConversation(conversationId);
  const sendMessage = useSendIdeaCreationMessage(conversationId ?? "");
  const updateDraft = useUpdateIdeaCreationDraft(conversationId ?? "");

  const start = (message: string) => {
    create.mutate(
      { message },
      { onSuccess: (row) => setSearchParams({ c: row.id }, { replace: true }) },
    );
  };

  // AWAITING_AI is server state that doesn't exist until the POST resolves — without also
  // checking the mutation's own pending state, a second Enter press (or a second click on
  // a suggested-reply chip) during that gap fires a second message for the same turn.
  const busy = conversation.data?.status === "AWAITING_AI" || sendMessage.isPending;

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const message = input.trim();
    if (!message || busy) return;
    sendMessage.mutate({ message }, { onSuccess: () => setInput("") });
  };

  const sendReply = (message: string) => {
    if (busy) return;
    sendMessage.mutate({ message });
  };

  const reviewMyIdea = () => {
    if (!conversation.data) return;
    navigate("/ideas/new/manual", {
      state: { prefill: draftToPrefill(conversation.data.draft), prefillSource: "idea-creation" },
    });
  };

  if (!conversationId) {
    return (
      <main className="page mx-auto flex max-w-3xl flex-col gap-4">
        <PageHeading
          icon={Sparkles}
          heading="Create an idea"
          description="Develop your idea with AI, then review and submit it yourself."
        />
        <StartScreen onStart={start} busy={create.isPending} />
        {create.error ? (
          <p role="alert" className="text-center text-200 text-destructive">
            {mutationErrorMessage(create.error)}
          </p>
        ) : null}
        {/*
          P9 tester feedback: the one-line "Prefer to fill out the form yourself?" read as
          ignorable fine print. It is a real second way in, so it gets the weight of one —
          an outlined option with its own reason to pick it — while staying visibly
          secondary to the conversation above (no fill, no brand gradient).
        */}
        <Link
          to="/ideas/new/manual"
          className="group mx-auto flex w-full max-w-xl items-center gap-4 rounded-xl border border-border bg-card px-5 py-4 text-left no-underline shadow-e1 transition-colors hover:border-accent-600 hover:no-underline"
        >
          <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent-100 text-accent-700">
            <ClipboardList className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-300 font-semibold text-foreground">Prefer a form? Fill it in yourself</span>
            <span className="block text-200 text-muted-foreground">
              Every field on one page — the same review and the same AI analysis, just no chat.
            </span>
          </span>
          <ArrowRight aria-hidden className="size-5 shrink-0 text-accent-700 transition-transform group-hover:translate-x-1" />
        </Link>
        <ConversationHistory />
      </main>
    );
  }

  const data = conversation.data;
  const waiting = data?.status === "AWAITING_AI";
  // Announced to assistive tech regardless of which turn produced it — the send mutation
  // (this device's own action) and a status that arrived via the 1s poll (another tab,
  // or simply this render not having caused it) both need the same announcement.
  const liveAnnouncement = waiting
    ? "Thinking…"
    : data?.messages.at(-1)?.role === "AI"
      ? "The idea agent replied."
      : "";
  const sendErrorMessage = mutationErrorMessage(sendMessage.error) ?? mutationErrorMessage(create.error);
  // The API sets this when the queue itself was unavailable (message saved, never
  // answered) — degrade-never-throw means that never surfaces as a rejected request, so
  // this is the only place it can be read from.
  const queueErrorMessage =
    data?.errorCode === "QUEUE_UNAVAILABLE"
      ? "That message was saved, but the agent couldn't be reached to answer it. Try sending it again."
      : null;

  return (
    <main className="page flex flex-col gap-4">
      <PageHeading
        icon={Sparkles}
        heading="Create an idea"
        description="Talk it through with the agent — the idea on the right updates as you go."
        actions={
          // Back to the start screen, where "Your idea conversations" lists this one and
          // every other — nothing is lost by leaving, the conversation is saved as it goes.
          <Button asChild variant="outline">
            <Link to="/ideas/new">
              <History aria-hidden className="size-4" />
              Your conversations
            </Link>
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr] lg:items-start">
        {/* Conversation panel */}
        {/* bg-card, not bg-muted/40: in dark mode the tint of the sunken surface sat almost
            at canvas black, so the whole conversation read as a dark hole (P9 feedback). */}
        <div className="flex flex-col gap-3 rounded-2xl bg-card p-4 shadow-e2 ring-1 ring-inset ring-border">
          {/* Mounted once, always — its TEXT changing is what makes assistive tech
              announce it. A region that only appears once there's something to say never
              fires, because the announcement and the content it announces would arrive in
              the same paint. */}
          <div aria-live="polite" className="sr-only">{liveAnnouncement}</div>

          {conversation.isPending ? (
            <div className="space-y-2 p-2">
              <Skeleton className="h-10 w-2/3" />
              <Skeleton className="ml-auto h-10 w-1/2" />
            </div>
          ) : (
            <div className="flex max-h-[60vh] min-h-[40vh] flex-col gap-3 overflow-y-auto p-1">
              {data?.messages.map((m) => <MessageBubble key={m.id} message={m} />)}
              {waiting ? (
                <div className="mr-auto flex max-w-[85%] items-center gap-1.5 rounded-2xl rounded-bl-md bg-card px-4 py-3 shadow-e2 ring-1 ring-inset ring-border">
                  <span aria-hidden className="grid size-5 shrink-0 place-items-center rounded-full bg-accent-100 text-accent-700">
                    <Sparkles className="size-3" />
                  </span>
                  <ThinkingLabel />
                </div>
              ) : null}
            </div>
          )}

          {queueErrorMessage ? (
            <p role="alert" className="text-200 text-destructive">{queueErrorMessage}</p>
          ) : null}
          {sendErrorMessage ? (
            <p role="alert" className="text-200 text-destructive">{sendErrorMessage}</p>
          ) : null}

          {data?.status === "HANDED_OFF" ? (
            <p className="rounded-lg bg-card p-3 text-200 text-muted-foreground ring-1 ring-inset ring-border">
              This conversation was handed off to the idea form.
            </p>
          ) : (
            <>
              {data && data.suggestedReplies.length > 0 && !waiting ? (
                <div className="flex flex-wrap gap-2">
                  {data.suggestedReplies.map((reply) => (
                    <Button
                      variant="link"
                      size="icon"
                      key={reply}
                      type="button"
                      disabled={busy}
                      onClick={() => sendReply(reply)}
                      className="size-auto whitespace-normal font-normal hover:shadow-none active:scale-100 block shrink duration-150 ease-in-out hover:no-underline rounded-full bg-card px-3 py-1.5 text-100 text-accent-700 ring-1 ring-inset ring-accent-200 transition-colors hover:bg-accent-050 disabled:pointer-events-none disabled:opacity-50"
                    >
                      {reply}
                    </Button>
                  ))}
                </div>
              ) : null}

              <form onSubmit={send} className="flex items-end gap-2">
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={waiting ? "Waiting for a reply…" : "Say more…"}
                  rows={2}
                  maxLength={4_000}
                  disabled={busy}
                  className="flex-1"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) send(e);
                  }}
                />
                <Button type="submit" disabled={!input.trim() || busy}>
                  <Send aria-hidden className="size-3.5" />
                  <span className="sr-only">Send</span>
                </Button>
              </form>
            </>
          )}
        </div>

        {/* Evolving idea panel */}
        <div className="flex flex-col gap-3 rounded-2xl bg-card p-4 shadow-e2 ring-1 ring-inset ring-border">
          <div className="flex items-center justify-between">
            <h2 className="text-300 font-extrabold">Your idea, so far</h2>
            {data?.readyToReview ? (
              <Badge variant="secondary" className="bg-factor-up-bg text-factor-up">Ready to review</Badge>
            ) : null}
          </div>

          {!data ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : (
            <>
              <div className="divide-y divide-border">
                {FIELD_ORDER.map((field) => (
                  <DraftFieldRow
                    key={field}
                    field={field}
                    value={data.draft[field]}
                    status={data.draft.fieldStatus[field] ?? "MISSING"}
                    saving={updateDraft.isPending}
                    onSave={(value, onSettled) =>
                      updateDraft.mutate({ [field]: value }, { onSettled })}
                  />
                ))}
                <UseCasesRow
                  useCases={data.draft.useCases}
                  saving={updateDraft.isPending}
                  onSave={(values, onSettled) =>
                    updateDraft.mutate({ useCases: [...values] }, { onSettled })}
                />
              </div>

              {data.draft.missingInformation.length > 0 ? (
                <div className="rounded-lg bg-muted/60 p-3">
                  <p className="text-100 font-semibold uppercase tracking-wide text-muted-foreground">
                    Still missing
                  </p>
                  <ul className="mt-1 list-inside list-disc space-y-0.5 text-200 text-muted-foreground">
                    {data.draft.missingInformation.map((m, i) => <li key={i}>{m}</li>)}
                  </ul>
                </div>
              ) : null}

              <Button type="button" onClick={reviewMyIdea} className="mt-1">
                <PenSquare aria-hidden className="size-3.5" />
                Review my idea
              </Button>
              <p className="text-100 text-muted-foreground">
                You can act on this any time — the agent's questions never block it.
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

/**
 * P9 tester feedback: replies "take too much time". Most of a reply's wait is the model
 * itself, but a static "Thinking…" for fifteen seconds reads as a hang. The label moves on
 * as time passes so a slow reply still looks like work in progress — and says the message
 * is safe, since the reply is queued server-side and survives a reload.
 */
function ThinkingLabel() {
  const [seconds, setSeconds] = React.useState(0);
  React.useEffect(() => {
    const started = Date.now();
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  const text =
    seconds < 8
      ? "Thinking…"
      : seconds < 20
        ? "Still thinking — working through what you've said…"
        : "Taking a little longer than usual. Your message is saved — the reply will appear here.";
  return <span className="text-200 text-muted-foreground">{text}</span>;
}

const CONVERSATION_STAGE: Record<"ACTIVE" | "AWAITING_AI" | "HANDED_OFF", string> = {
  ACTIVE: "In progress",
  AWAITING_AI: "Waiting for a reply",
  HANDED_OFF: "Sent to review",
};

/**
 * P9 tester feedback: "after the idea is created with the AI-native flow, a history of
 * that chat would be good to see, just like the discovery agent". The conversation id
 * already lives in the URL (`?c=`), so each entry simply reopens it — the full chat and
 * the draft it produced, including ones already handed to the review form.
 */
function ConversationHistory() {
  const history = useIdeaCreationHistory();
  const remove = useDeleteIdeaCreationConversation();
  // Two clicks, not a dialog: the first arms the row's own "Delete" button, so a stray
  // click on the bin never loses a conversation, and nothing modal covers the list.
  const [armed, setArmed] = React.useState<string | null>(null);
  const items = history.data?.items ?? [];
  if (history.isPending || items.length === 0) return null;
  return (
    <section aria-labelledby="idea-conversations" className="mx-auto w-full max-w-xl">
      <h2 id="idea-conversations" className="mb-2 flex items-center gap-2 text-200 font-semibold text-muted-foreground">
        <History aria-hidden className="size-4" />
        Your idea conversations
      </h2>
      {remove.isError ? (
        <p role="alert" className="mb-2 text-200 text-destructive">
          {remove.error instanceof ApiError ? remove.error.message : "That conversation could not be deleted."}
        </p>
      ) : null}
      <ul className="grid gap-2">
        {items.slice(0, 8).map((c) => {
          const title = c.title ?? "Untitled idea";
          const isArmed = armed === c.id;
          return (
            <li key={c.id} className="flex items-stretch gap-2">
              <Link
                to={`/ideas/new?c=${c.id}`}
                className="group flex min-w-0 flex-1 items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 no-underline shadow-e1 transition-colors hover:border-accent-600 hover:no-underline"
              >
                <MessageSquareText aria-hidden className="size-4 shrink-0 text-accent-700" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-200 font-semibold text-foreground">{title}</span>
                  <span className="block text-100 text-muted-foreground">
                    {CONVERSATION_STAGE[c.status]} · {c.turnCount} {c.turnCount === 1 ? "message" : "messages"} · {ago(c.updatedAt)}
                  </span>
                </span>
                <ArrowRight aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </Link>
              {isArmed ? (
                <span className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(c.id, { onSettled: () => setArmed(null) })}
                  >
                    Delete
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setArmed(null)}>
                    Keep
                  </Button>
                </span>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="self-center text-muted-foreground hover:text-destructive"
                  aria-label={`Delete conversation: ${title}`}
                  disabled={c.status === "AWAITING_AI"}
                  onClick={() => setArmed(c.id)}
                >
                  <Trash2 aria-hidden className="size-4" />
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

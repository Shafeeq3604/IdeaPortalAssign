import * as React from "react";
import { useNavigate } from "react-router-dom";
import { ExternalLink, PenSquare, Send, Sparkles } from "lucide-react";
import { Badge, Button, Skeleton, Textarea } from "@iep/ui";
import type { DiscoveryResultItem } from "@iep/contracts";
import { useCreateDiscoveryQuery, useDiscoveryHistory, useDiscoveryQuery } from "./api";

/**
 * SPC-001 — AI Discovery Agent chat page.
 *
 * A standalone chatbot (SPC-13): processing a query never reads or writes an Idea record
 * — nothing here is enforced by a foreign key or a server-side link. "Submit as idea"
 * below is a client-only convenience: it hands the generated idea's text to the ordinary,
 * human-authored `/ideas/new` form (`SubmitIdeaPage`) as a pre-fill, exactly as
 * `schema.prisma`'s SPC-13 comment anticipated — "a user acting on a finding submits a
 * real idea by hand." No discovery_queries row is read, written, or referenced by that
 * form; the two stay structurally unrelated.
 */

/** A source is a clickable link only when it actually looks like one (SPC-9/SPC-11's
 * "real URL only if genuinely confident" — the rest are named publications/communities,
 * shown as plain text rather than a dead or misleading link). */
const URL_PATTERN = /^https?:\/\//i;

function SourceList({ sources }: { sources: readonly string[] }) {
  if (sources.length === 0) return null;
  return (
    <p className="mt-1 text-050 text-muted-foreground">
      Sources:{" "}
      {sources.map((source, i) => (
        <React.Fragment key={source}>
          {i > 0 ? " · " : ""}
          {URL_PATTERN.test(source) ? (
            <a
              href={source}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-0.5 underline underline-offset-2 hover:text-foreground"
            >
              {source}
              <ExternalLink aria-hidden className="size-2.5" />
            </a>
          ) : (
            source
          )}
        </React.Fragment>
      ))}
    </p>
  );
}

/** One labeled part of a structured item — same vocabulary as `IdeaForm.tsx`'s own
 * section labels, since these are the fields a "Submit as idea" prefill feeds. */
function Field({ label, text }: { label: string; text: string }) {
  return (
    <p className="mt-1.5 text-100">
      <span className="font-medium text-muted-foreground">{label}: </span>
      {text}
    </p>
  );
}

function IdeaItem({ item }: { item: DiscoveryResultItem }) {
  const navigate = useNavigate();
  // SPC-23: a discoveryReport row persisted before the structured shape shipped has
  // `summary` and none of the four fields below — rendered as the old flat paragraph
  // instead of failing to show anything.
  const structured = Boolean(item.problem && item.approach && item.whoItHelps);

  const submitAsIdea = () => {
    const sourcesLine = item.sources.length > 0 ? `\n\nSources: ${item.sources.join(", ")}` : "";
    navigate("/ideas/new", {
      state: {
        prefill: structured
          ? {
              title: item.title.slice(0, 200),
              problemStatement: item.problem?.slice(0, 2_000),
              description: `${item.approach}${sourcesLine}`.slice(0, 20_000),
              expectedUsers: item.whoItHelps?.slice(0, 2_000),
              expectedOutcome: item.expectedOutcome?.slice(0, 2_000),
            }
          : {
              title: item.title.slice(0, 200),
              description: `${item.summary}\n\n— via the AI Discovery Agent.${sourcesLine}`.slice(0, 20_000),
            },
      },
    });
  };

  return (
    <li className="rounded-xl bg-card p-3 shadow-e1 ring-1 ring-inset ring-border transition-shadow duration-[var(--dur-base)] hover:shadow-e2">
      <p className="text-200 font-semibold">{item.title}</p>
      {structured ? (
        <div>
          <Field label="The problem" text={item.problem ?? ""} />
          <Field label="The idea" text={item.approach ?? ""} />
          <Field label="Who it helps" text={item.whoItHelps ?? ""} />
          {item.expectedOutcome ? <Field label="What would change" text={item.expectedOutcome} /> : null}
        </div>
      ) : (
        <p className="mt-0.5 text-100 text-muted-foreground">{item.summary}</p>
      )}
      <SourceList sources={item.sources} />
      <Button type="button" variant="outline" size="sm" className="mt-2.5" onClick={submitAsIdea}>
        <PenSquare aria-hidden className="size-3.5" />
        Submit as idea
      </Button>
    </li>
  );
}

function TurnBubble({ discoveryQueryId, query }: { discoveryQueryId: string | null; query: string }) {
  // `discoveryQueryId` is null for the brief moment between the user hitting send and the
  // server assigning a real id — rendering the "Thinking…" state immediately for that case
  // (rather than waiting on the id) is what makes the click feel instant instead of dead.
  const { data, isPending } = useDiscoveryQuery(discoveryQueryId);
  const status = discoveryQueryId === null ? "PENDING" : (data?.status ?? (isPending ? "PENDING" : "FAILED"));

  return (
    <div className="space-y-2">
      <div className="ml-auto max-w-[80%] rounded-2xl rounded-br-md bg-gradient-to-br from-accent-600 to-grad-to px-4 py-2 text-200 text-primary-foreground shadow-e1">
        {query}
      </div>

      <div className="mr-auto max-w-[80%] rounded-2xl rounded-bl-md bg-card px-4 py-3 shadow-e2 ring-1 ring-inset ring-border">
        <div className="mb-2 flex items-center gap-1.5 text-100 text-muted-foreground">
          <span
            aria-hidden
            className="grid size-5 shrink-0 place-items-center rounded-full bg-accent-100 text-accent-700"
          >
            <Sparkles className="size-3" />
          </span>
          <span>Discovery Agent</span>
          {/* SPC-17: every result is marked AI-generated, plainly. */}
          <Badge variant="secondary" className="text-050">AI-generated</Badge>
        </div>

        {(status === "PENDING" || status === "RUNNING") ? (
          <div className="space-y-1.5" aria-live="polite">
            <p className="text-200 text-muted-foreground">Thinking…</p>
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ) : null}

        {status === "FAILED" ? (
          <p className="text-200 text-muted-foreground">
            Could not put together an answer this time
            {data?.errorCode ? ` (${data.errorCode})` : ""}. Try rephrasing the question.
          </p>
        ) : null}

        {status === "SUCCEEDED" && data ? (
          <div className="space-y-3">
            <p className="text-200">{data.summary}</p>
            <ol className="space-y-2">
              {data.items.map((item, i) => (
                <IdeaItem key={i} item={item} />
              ))}
            </ol>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function DiscoveryChatPage() {
  const [input, setInput] = React.useState("");
  // `key` is a stable local identity for the turn, independent of the server's id — which
  // does not exist yet the instant a turn is created (see `submit` below).
  const [turns, setTurns] = React.useState<readonly { key: string; id: string | null; query: string }[]>([]);
  const create = useCreateDiscoveryQuery();
  const history = useDiscoveryHistory();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const query = input.trim();
    if (!query || create.isPending) return;
    setInput("");

    // Add the turn to the page THE INSTANT it's submitted, with no server id yet — not
    // after the request round-trip completes. Waiting for the response before showing
    // anything left the box looking dead for several seconds on every real (non-stub)
    // query, which reads as "did that even work?" rather than "the agent is thinking."
    const key = crypto.randomUUID();
    setTurns((prev) => [...prev, { key, id: null, query }]);

    create.mutate(
      { query },
      {
        onSuccess: (data) =>
          setTurns((prev) => prev.map((t) => (t.key === key ? { ...t, id: data.id } : t))),
        onError: () =>
          // The request never made it to the server — drop the optimistic turn rather
          // than leaving a "Thinking…" bubble that can never resolve.
          setTurns((prev) => prev.filter((t) => t.key !== key)),
      },
    );
  };

  return (
    <main className="page mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-accent-600 to-grad-to text-primary-foreground shadow-e1"
        >
          <Sparkles className="size-4.5" />
        </span>
        <div>
          <h1 className="text-500 font-bold">Discover</h1>
          <p className="text-200 text-muted-foreground">
            Ask a research question — trends, opportunity ideas, or recurring problems people
            discuss. It generates original ideas inspired by what the model already knows, not
            a live web search, framed for how they could help your organization and its
            clients. Nothing here creates or changes an idea on its own — if one is worth
            pursuing, use "Submit as idea" to start a real submission that you write and send
            yourself.
          </p>
        </div>
      </div>

      {turns.length === 0 ? (
        <div className="rounded-2xl bg-accent-050 p-6 text-center shadow-e1 ring-1 ring-inset ring-accent-100">
          <p className="text-200 text-muted-foreground">Try:</p>
          <p className="mt-1 text-300 font-medium text-accent-700">
            "What are the latest AI trends in software development?"
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {turns.map((t) => (
            <TurnBubble key={t.key} discoveryQueryId={t.id} query={t.query} />
          ))}
        </div>
      )}

      <form
        onSubmit={submit}
        className="flex items-end gap-2 rounded-2xl bg-card p-2 shadow-e2 ring-1 ring-inset ring-border"
      >
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask the Discovery Agent…"
          rows={2}
          maxLength={2_000}
          className="border-0 shadow-none focus-visible:ring-0"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) submit(e);
          }}
        />
        <Button
          type="submit"
          size="icon"
          disabled={!input.trim() || create.isPending}
          aria-label="Send"
          className="bg-gradient-to-br from-accent-600 to-grad-to shadow-e1 hover:opacity-90"
        >
          <Send aria-hidden className="size-4" />
        </Button>
      </form>

      {history.data && history.data.items.length > 0 ? (
        <div className="rounded-2xl bg-card p-4 shadow-e1 ring-1 ring-inset ring-border">
          <h2 className="mb-2 text-200 font-semibold text-muted-foreground">Recent queries</h2>
          <ul className="space-y-1">
            {history.data.items
              .filter((h) => !turns.some((t) => t.id === h.id))
              .slice(0, 10)
              .map((h) => (
                <li key={h.id}>
                  <button
                    type="button"
                    className="rounded-md text-left text-200 text-accent-700 underline-offset-2 hover:underline"
                    onClick={() => setTurns((prev) => [...prev, { key: crypto.randomUUID(), id: h.id, query: h.query }])}
                  >
                    {h.query}
                  </button>
                </li>
              ))}
          </ul>
        </div>
      ) : null}
    </main>
  );
}

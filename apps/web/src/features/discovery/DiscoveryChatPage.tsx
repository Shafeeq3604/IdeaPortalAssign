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
 * below is a client-only convenience: it hands the finding's text to the ordinary,
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

function FindingItem({ item }: { item: DiscoveryResultItem }) {
  const navigate = useNavigate();

  const submitAsIdea = () => {
    navigate("/ideas/new", {
      state: {
        prefill: {
          title: item.title.slice(0, 200),
          description:
            `${item.summary}\n\n— via the AI Discovery Agent. Sources: ${item.sources.join(", ")}`
              .slice(0, 20_000),
        },
      },
    });
  };

  return (
    <li className="rounded-xl bg-card p-3 shadow-e1 ring-1 ring-inset ring-border transition-shadow duration-[var(--dur-base)] hover:shadow-e2">
      <p className="text-200 font-semibold">{item.title}</p>
      <p className="mt-0.5 text-100 text-muted-foreground">{item.summary}</p>
      <SourceList sources={item.sources} />
      <Button type="button" variant="outline" size="sm" className="mt-2.5" onClick={submitAsIdea}>
        <PenSquare aria-hidden className="size-3.5" />
        Submit as idea
      </Button>
    </li>
  );
}

function TurnBubble({ discoveryQueryId, query }: { discoveryQueryId: string; query: string }) {
  const { data, isPending } = useDiscoveryQuery(discoveryQueryId);
  const status = data?.status ?? (isPending ? "PENDING" : "FAILED");

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
                <FindingItem key={i} item={item} />
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
  const [turns, setTurns] = React.useState<readonly { id: string; query: string }[]>([]);
  const create = useCreateDiscoveryQuery();
  const history = useDiscoveryHistory();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const query = input.trim();
    if (!query || create.isPending) return;
    create.mutate(
      { query },
      { onSuccess: (data) => setTurns((prev) => [...prev, { id: data.id, query: data.query }]) },
    );
    setInput("");
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
            discuss. It answers from what the model already knows, not a live web search, and
            cites where each finding comes from. Nothing here creates or changes an idea on
            its own — if a finding is worth pursuing, use "Submit as idea" to start a real
            submission that you write and send yourself.
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
            <TurnBubble key={t.id} discoveryQueryId={t.id} query={t.query} />
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
                    onClick={() => setTurns((prev) => [...prev, { id: h.id, query: h.query }])}
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

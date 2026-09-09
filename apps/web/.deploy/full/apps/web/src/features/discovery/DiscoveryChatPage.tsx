import * as React from "react";
import { Send, Sparkles } from "lucide-react";
import { Badge, Button, Skeleton, Textarea } from "@iep/ui";
import { useCreateDiscoveryQuery, useDiscoveryHistory, useDiscoveryQuery } from "./api";

/**
 * SPC-001 — AI Discovery Agent chat page.
 *
 * A standalone chatbot (SPC-13): nothing here reads or writes an Idea. Each message the
 * user sends becomes one discovery query, run once through the 6-step workflow in
 * `packages/ai/src/discovery.ts` (understand intent → identify sources → discover →
 * filter → rank → present), and answered as one chat turn.
 */

function TurnBubble({ discoveryQueryId, query }: { discoveryQueryId: string; query: string }) {
  const { data, isPending } = useDiscoveryQuery(discoveryQueryId);
  const status = data?.status ?? (isPending ? "PENDING" : "FAILED");

  return (
    <div className="space-y-2">
      <div className="ml-auto max-w-[80%] rounded-lg rounded-br-sm bg-accent px-4 py-2 text-200 text-accent-foreground">
        {query}
      </div>

      <div className="mr-auto max-w-[80%] rounded-lg rounded-bl-sm border border-border bg-card px-4 py-3 shadow-e1">
        <div className="mb-2 flex items-center gap-1.5 text-100 text-muted-foreground">
          <Sparkles aria-hidden className="size-3.5" />
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
                <li key={i} className="rounded-md border border-border p-2.5">
                  <p className="text-200 font-semibold">{item.title}</p>
                  <p className="text-100 text-muted-foreground">{item.summary}</p>
                  <p className="mt-1 text-050 text-muted-foreground">
                    Sources: {item.sources.join(" · ")}
                  </p>
                </li>
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
      <div>
        <h1 className="flex items-center gap-2 text-500 font-bold">
          <Sparkles aria-hidden className="size-5" />
          Discover
        </h1>
        <p className="text-200 text-muted-foreground">
          Ask a research question — trends, opportunity ideas, or recurring problems people
          discuss. This is a standalone research tool: nothing here creates or changes an
          idea. It answers from what the model already knows, not a live web search.
        </p>
      </div>

      {turns.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-200 text-muted-foreground">
          Try: "What are the latest AI trends in software development?"
        </div>
      ) : (
        <div className="space-y-4">
          {turns.map((t) => (
            <TurnBubble key={t.id} discoveryQueryId={t.id} query={t.query} />
          ))}
        </div>
      )}

      <form onSubmit={submit} className="flex items-end gap-2">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask the Discovery Agent…"
          rows={2}
          maxLength={2_000}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) submit(e);
          }}
        />
        <Button type="submit" disabled={!input.trim() || create.isPending} aria-label="Send">
          <Send aria-hidden className="size-4" />
        </Button>
      </form>

      {history.data && history.data.items.length > 0 ? (
        <div>
          <h2 className="mb-2 text-200 font-semibold text-muted-foreground">Recent queries</h2>
          <ul className="space-y-1">
            {history.data.items
              .filter((h) => !turns.some((t) => t.id === h.id))
              .slice(0, 10)
              .map((h) => (
                <li key={h.id}>
                  <button
                    type="button"
                    className="text-left text-200 text-accent-700 underline-offset-2 hover:underline"
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

import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { ExternalLink, PenSquare, Send, Sparkles } from "lucide-react";
import { Badge, Button, Skeleton, Textarea } from "@iep/ui";
import type { DiscoveryResultItem } from "@iep/contracts";
import { HeroStat, PageHero } from "../../app/PageHero";
import { useCreateDiscoveryQuery, useDiscoveryHistory, useDiscoveryQuery } from "./api";

/**
 * The empty state used to show exactly one static example, always the same one, and
 * that example was never clickable — it modeled only "a trend" even though the hero's
 * own copy promises three different kinds of question ("trends, opportunity ideas, or
 * recurring problems"). A first-time user had no way to tell the other two were things
 * this could do at all. One example from each mode, picked afresh per visit and
 * clickable (runs the query immediately, the way a suggested-prompt chip should), models
 * the actual range instead of one instance of it.
 */
const EXAMPLE_PROMPTS: readonly { readonly mode: string; readonly query: string }[] = [
  { mode: "A trend", query: "What are the latest AI trends in software development?" },
  { mode: "A trend", query: "How are companies using AI to speed up customer support?" },
  {
    mode: "A recurring problem",
    query: "What recurring problems do finance teams complain about with expense reporting?",
  },
  {
    mode: "A recurring problem",
    query: "What do IT help desks most often get asked to fix by hand?",
  },
  {
    mode: "An opportunity idea",
    query: "Where could better use of internal data reduce manual reporting work?",
  },
  {
    mode: "An opportunity idea",
    query: "What onboarding tasks for new hires are still done manually across teams?",
  },
];

/** One random pick per mode, not three random picks overall — the point is showing the
 * RANGE, so two examples of "a trend" and none of "an opportunity idea" would defeat it.
 * Runs once per mount (not on a timer): a visit shows a fresh set, which is enough to
 * read as "rotating" without an animation loop nobody asked for. */
function oneOfEachMode(
  items: readonly { readonly mode: string; readonly query: string }[],
): { readonly mode: string; readonly query: string }[] {
  const byMode = new Map<string, { readonly mode: string; readonly query: string }[]>();
  for (const item of items) byMode.set(item.mode, [...(byMode.get(item.mode) ?? []), item]);
  return [...byMode.values()].map((group) => group[Math.floor(Math.random() * group.length)]!);
}

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

/**
 * One labeled part of a structured item — same vocabulary as `IdeaForm.tsx`'s own
 * section labels, since these are the fields a "Submit as idea" prefill feeds.
 *
 * The label used to sit inline ("The problem: <text>"), which reads fine for one field
 * but turns four of them back-to-back into one undifferentiated paragraph — exactly what
 * made a whole answer (up to seven of these, each with four fields) scan as a wall of
 * text instead of four distinct facts. A small uppercase caption above its own value, the
 * same pattern the Evaluation tab already uses for its strongest/weakest figures, gives
 * the eye a place to land per field without adding a single extra word.
 */
function Field({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <dt className="text-050 font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-100">{text}</dd>
    </div>
  );
}

function IdeaItem({ item, index }: { item: DiscoveryResultItem; index: number }) {
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
    // `bg-muted`, not `bg-card` — the surrounding chat bubble IS `bg-card`, so a card in
    // the old tone had nothing but a faint ring to tell it apart, and seven of them in a
    // row read as one continuous block. A visibly recessed tile per idea, a numbered
    // marker (there can be up to seven of these in one answer — a real sequence worth
    // counting, not decoration), and a rule before the field list are what actually make
    // this scannable as "seven distinct ideas" rather than "one long answer."
    <li className="rounded-xl bg-muted p-4 shadow-e1 ring-1 ring-inset ring-border transition-shadow duration-[var(--dur-base)] hover:shadow-e2">
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden
          className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-accent-100 text-050 font-bold text-accent-700"
        >
          {index + 1}
        </span>
        <p className="text-200 font-semibold leading-snug">{item.title}</p>
      </div>
      {structured ? (
        <dl className="mt-3 space-y-2.5 border-t border-border pt-3">
          <Field label="The problem" text={item.problem ?? ""} />
          <Field label="The idea" text={item.approach ?? ""} />
          <Field label="Who it helps" text={item.whoItHelps ?? ""} />
          {item.expectedOutcome ? <Field label="What would change" text={item.expectedOutcome} /> : null}
        </dl>
      ) : (
        <p className="mt-1.5 text-100 text-muted-foreground">{item.summary}</p>
      )}
      <SourceList sources={item.sources} />
      <Button type="button" variant="outline" size="sm" className="mt-3 bg-card" onClick={submitAsIdea}>
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
            <ol className="space-y-3">
              {data.items.map((item, i) => (
                <IdeaItem key={i} item={item} index={i} />
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
  // Lazy initializer: picked once, when the page first mounts, not on every re-render —
  // a fresh set every render would mean a set that changes under the reader's cursor.
  const [examples] = React.useState(() => oneOfEachMode(EXAMPLE_PROMPTS));
  const create = useCreateDiscoveryQuery();
  const history = useDiscoveryHistory();

  /** Shared by the form's Enter/Send and by clicking an example prompt below — both are
   * "ask this question," just with the text coming from a different place. */
  const runQuery = (query: string) => {
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

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    runQuery(input.trim());
  };

  return (
    <main className="page mx-auto flex max-w-3xl flex-col gap-6">
      {/* Same `.dash-hero` shell the dashboard uses — this page previously opened with a
          plain icon chip and a paragraph, the least visually distinguished entry point
          in the product for a feature that is otherwise the most novel thing here. */}
      <PageHero
        eyebrow={
          <>
            <Sparkles aria-hidden className="size-3" />
            AI Discovery Agent
          </>
        }
        heading="Discover"
        description={
          <>
            Ask a research question — trends, opportunity ideas, or recurring problems
            people discuss. It generates original ideas inspired by what the model already
            knows, not a live web search, framed for how they could help your organization
            and its clients. Nothing here creates or changes an idea on its own — if one is
            worth pursuing, use "Submit as idea" to start a real submission that you write
            and send yourself.{" "}
            {/* The submission form has carried this same link since P2 (IdeaForm.tsx); an
                AI-generated result here had no equivalent, even though it's the page that
                shows the MOST AI-written text before anyone has decided to trust it. */}
            <Link to="/help/data-and-ai" className="text-grad-ink-soft underline underline-offset-2">
              How this works, and what's sent to it
            </Link>
            .
          </>
        }
        aside={
          history.data && history.data.items.length > 0 ? (
            <div className="rounded-2xl bg-grad-ink/8 p-4 ring-1 ring-grad-rule">
              <HeroStat value={String(history.data.items.length)} label="questions asked so far" />
            </div>
          ) : undefined
        }
      />

      {turns.length === 0 ? (
        <div className="rounded-2xl bg-accent-050 p-6 shadow-e1 ring-1 ring-inset ring-accent-100">
          <p className="text-center text-200 text-muted-foreground">
            Try one of these, or ask your own —
          </p>
          <div className="mt-3 grid gap-2.5 sm:grid-cols-3">
            {examples.map((example) => (
              <button
                key={example.query}
                type="button"
                onClick={() => runQuery(example.query)}
                disabled={create.isPending}
                className="flex flex-col gap-1 rounded-xl bg-card p-3 text-left shadow-e1 ring-1 ring-inset ring-border transition-shadow duration-[var(--dur-base)] hover:shadow-e2 disabled:pointer-events-none disabled:opacity-50"
              >
                <span className="text-050 font-semibold uppercase tracking-wide text-accent-700">
                  {example.mode}
                </span>
                <span className="text-100 text-foreground">{example.query}</span>
              </button>
            ))}
          </div>
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

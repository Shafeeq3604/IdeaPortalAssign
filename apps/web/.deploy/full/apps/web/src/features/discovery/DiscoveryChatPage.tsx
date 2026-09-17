import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  CircleAlert, ExternalLink, Lightbulb, PenSquare, Send, Sparkles, TrendingUp, Users,
} from "lucide-react";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger, Badge, Button, Skeleton, Textarea,
} from "@iep/ui";
import type { DiscoveryResultItem } from "@iep/contracts";
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

/** The category chip + icon each example card wears — same three modes the hero's own
 * copy promises, given a visual identity so the row reads as a menu of AI actions rather
 * than a paragraph's worth of sample text. */
const MODE_ICON: Record<string, React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  "A trend": TrendingUp,
  "A recurring problem": CircleAlert,
  "An opportunity idea": Lightbulb,
};

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
 * SPC-001 — AI Discovery Agent workspace.
 *
 * Restructured from a chat page with a hero bolted on top of it into an "ask → explore →
 * evaluate → submit" workspace (production redesign): the prompt moves into the hero as
 * the page's primary focal point, the hero's aside reports what the tool has actually
 * done rather than one static count, and every generated idea gets the same four-level
 * reading order (name → problem/who/impact → how it would work → sources) so it can be
 * judged in seconds, not read like a report.
 *
 * A standalone chatbot (SPC-13): processing a query never reads or writes an Idea record
 * — nothing here is enforced by a foreign key or a server-side link. "Submit as idea"
 * below is a client-only convenience: it hands the generated idea's text to the ordinary,
 * human-authored `/ideas/new` form (`SubmitIdeaPage`) as a pre-fill, exactly as
 * `schema.prisma`'s SPC-13 comment anticipated — "a user acting on a finding submits a
 * real idea by hand." No discovery_queries row is read, written, or referenced by that
 * form; the two stay structurally unrelated — which is also why "ideas submitted from
 * Discover" cannot be one of the hero's metrics below: nothing records that link.
 */

/** A source is a clickable link only when it actually looks like one (SPC-9/SPC-11's
 * "real URL only if genuinely confident" — the rest are named publications/communities,
 * shown as plain text rather than a dead or misleading link). */
const URL_PATTERN = /^https?:\/\//i;

function SourceList({ sources }: { sources: readonly string[] }) {
  if (sources.length === 0) return null;
  return (
    <p className="mt-1 text-100 text-muted-foreground">
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
 * One facet of the Level-2 grid — Problem / Who it helps / Expected impact, each its own
 * tile rather than a row in one list, so the three facts a reader needs to judge an idea
 * sit side by side instead of stacked under each other (production redesign, change 5/6).
 */
function Facet({
  icon: Icon, label, text,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  text: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <dt className="flex items-center gap-1.5 text-100 font-semibold uppercase tracking-wide text-accent-700">
        <Icon aria-hidden className="size-3.5 shrink-0" />
        {label}
      </dt>
      <dd className="mt-1 text-100 leading-relaxed">{text}</dd>
    </div>
  );
}

function IdeaItem({
  item, index, className,
}: {
  item: DiscoveryResultItem;
  index: number;
  className?: string;
}) {
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
    <li
      className={`rounded-xl bg-muted p-4 shadow-e1 ring-1 ring-inset ring-border transition-shadow duration-[var(--dur-base)] hover:shadow-e2 ${className ?? ""}`}
    >
      {/* Level 1 — the name, the thing a skim has to land on first. */}
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden
          className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-accent-100 text-100 font-bold text-accent-700"
        >
          {index + 1}
        </span>
        <p className="text-300 font-semibold leading-snug">{item.title}</p>
      </div>

      {structured ? (
        <>
          {/* Level 2 — problem / who it helps / impact, as three facts side by side
              rather than a paragraph each, so the case for the idea reads in one
              glance (production redesign, change 5/6). */}
          <dl className="mt-3 grid gap-2 border-t border-border pt-3 sm:grid-cols-3">
            <Facet icon={CircleAlert} label="The problem" text={item.problem ?? ""} />
            <Facet icon={Users} label="Who it helps" text={item.whoItHelps ?? ""} />
            {item.expectedOutcome ? (
              <Facet icon={TrendingUp} label="Expected impact" text={item.expectedOutcome} />
            ) : null}
          </dl>

          {/* Level 3 — how it would work, real data (`approach`), always visible: the
              brief asked for a "suggested actions" list, but nothing in the contract
              produces one, and inventing bullet points here would be exactly the kind
              of fabricated content this product refuses to ship. The real field that
              already existed — the approach itself — takes that slot instead, promoted
              out from behind the old accordion since it's the one thing left that
              actually helps someone decide whether to act. */}
          {item.approach ? (
            <div className="mt-3">
              <p className="text-100 font-semibold uppercase tracking-wide text-muted-foreground">
                How it would work
              </p>
              <p className="mt-1 text-200 leading-relaxed">{item.approach}</p>
            </div>
          ) : null}

          {/* Level 4 — sources only, the one thing genuinely worth a click to reveal. */}
          {item.sources.length > 0 ? (
            <Accordion type="single" collapsible className="mt-1">
              <AccordionItem value="sources" className="border-none">
                <AccordionTrigger className="py-2 text-100 font-semibold uppercase tracking-wide text-muted-foreground hover:no-underline hover:text-foreground">
                  Show sources
                </AccordionTrigger>
                <AccordionContent>
                  <SourceList sources={item.sources} />
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          ) : null}
        </>
      ) : (
        <>
          <p className="mt-1.5 text-200 text-muted-foreground">{item.summary}</p>
          <SourceList sources={item.sources} />
        </>
      )}

      {/* Footer — both exits stay visible together (production redesign, change 7/8):
          "Show sources" (above, when present) never has to be opened before "Submit as
          idea" is reachable, and the submit action now carries its own explanation of
          what pressing it actually does. */}
      <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3.5">
        <p className="text-100 text-muted-foreground">
          Send this recommendation into the idea evaluation workflow.
        </p>
        <Button type="button" size="sm" className="bg-accent-600 hover:bg-accent-600/90" onClick={submitAsIdea}>
          <PenSquare aria-hidden className="size-3.5" />
          Submit as idea
        </Button>
      </div>
    </li>
  );
}

function TurnBubble({
  discoveryQueryId, query, onItemsResolved,
}: {
  discoveryQueryId: string | null;
  query: string;
  onItemsResolved: (count: number) => void;
}) {
  // `discoveryQueryId` is null for the brief moment between the user hitting send and the
  // server assigning a real id — rendering the "Thinking…" state immediately for that case
  // (rather than waiting on the id) is what makes the click feel instant instead of dead.
  const { data, isPending } = useDiscoveryQuery(discoveryQueryId);
  const status = discoveryQueryId === null ? "PENDING" : (data?.status ?? (isPending ? "PENDING" : "FAILED"));

  React.useEffect(() => {
    if (status === "SUCCEEDED" && data) onItemsResolved(data.items.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

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
          <Badge variant="secondary" className="text-100">AI-generated</Badge>
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
            {/*
              This is the model's own framing of the question — useful context, but raw
              first-person reasoning prose read as a chatbot talking to itself when it had
              the exact same visual weight as the structured ideas below (production audit:
              "must not feel like a chatbot printing paragraphs"). A small caption demotes
              it to what it actually is — one line of framing before the real content,
              not the first thing meant to be read closely.
            */}
            <p className="text-100 font-semibold uppercase tracking-wide text-muted-foreground">
              In short
            </p>
            <p className="text-200 text-muted-foreground italic">{data.summary}</p>
            {/* `.motion-reveal` (visual-richness pass — moderate motion on Discover):
                plays once as a fresh answer's ideas mount, one after another. */}
            <ol className="motion-reveal space-y-3">
              {data.items.map((item, i) => (
                <IdeaItem key={i} item={item} index={i} className="motion-reveal" />
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
  // Real, session-scoped count of ideas actually generated — keyed by turn so a re-render
  // never double-counts the same answer. There is no all-time equivalent: nothing persists
  // how many ideas a past query produced (only the query text and its status), and no
  // discovery answer is ever linked to whether it was later submitted — both of those
  // would have to be invented numbers, which this hero does not show (production redesign,
  // change 3: real metrics only).
  const [ideaCounts, setIdeaCounts] = React.useState<Record<string, number>>({});
  const ideasThisSession = Object.values(ideaCounts).reduce((sum, n) => sum + n, 0);

  const create = useCreateDiscoveryQuery();
  const history = useDiscoveryHistory();

  /** Shared by the hero form's Enter/Send and by clicking a suggestion card — both are
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

  const mostRecentTopic = history.data?.items[0]?.query;

  return (
    <main className="page mx-auto flex max-w-3xl flex-col gap-6">
      {/*
        The prompt is now the hero's own content, not a paragraph above a separate input
        further down the page (production redesign, change 1): an AI workspace leads with
        "ask something," not with an explanation of itself. The dark `.dash-hero` shell
        stays — carried over from the dashboard on purpose — but its job changes from
        "explain the feature" to "capture the question and report what the tool has
        actually done" (change 3).
      */}
      <div className="dash-hero relative overflow-hidden rounded-2xl p-6 text-grad-ink shadow-e4 sm:p-7">
        <div className="relative grid gap-6 lg:grid-cols-[1.5fr_1fr]">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-grad-ink/10 px-3 py-1 text-100 uppercase tracking-[0.06em] text-grad-ink-soft ring-1 ring-grad-rule">
              <Sparkles aria-hidden className="size-3" />
              AI Discovery Agent
            </span>
            <h1 className="mt-3.5 font-serif text-600 font-semibold leading-tight tracking-tight text-grad-ink">
              Discover
            </h1>
            <p className="mt-2 max-w-[52ch] text-200 leading-relaxed text-grad-ink-soft">
              Explore trends, recurring problems, and opportunity areas. AI suggests
              initiatives you may want to submit as ideas.{" "}
              <Link to="/help/data-and-ai" className="underline underline-offset-2 hover:text-grad-ink">
                How this works
              </Link>
              .
            </p>

            <form onSubmit={submit} className="mt-4 rounded-xl bg-grad-ink/8 p-3 ring-1 ring-grad-rule">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about trends, recurring business problems, cost savings, innovation opportunities, or process improvements…"
                rows={2}
                maxLength={2_000}
                className="border-0 bg-transparent text-grad-ink shadow-none placeholder:text-grad-ink-soft/70 focus-visible:ring-0"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) submit(e);
                }}
              />
              <div className="flex justify-end border-t border-grad-rule pt-2">
                <Button
                  type="submit"
                  size="sm"
                  disabled={!input.trim() || create.isPending}
                  className="bg-grad-highlight text-grad-from hover:opacity-90"
                >
                  Ask
                  <Send aria-hidden className="size-3.5" />
                </Button>
              </div>
            </form>
          </div>

          {/* The aside reports real usage, not decoration (change 3): every figure here
              is either the length of the caller's own history or a count of ideas this
              page actually rendered this session — nothing invented, and nothing that
              implies a link (like "submitted from Discover") that the product does not
              track. */}
          <div className="grid grid-cols-2 gap-2.5 self-start">
            <div className="rounded-xl bg-grad-ink/8 p-3 ring-1 ring-grad-rule">
              <p className="font-serif text-500 font-semibold leading-none text-grad-ink">
                {history.data ? history.data.items.length : "—"}
              </p>
              <p className="mt-1 text-100 text-grad-ink-soft">Questions asked</p>
            </div>
            <div className="rounded-xl bg-grad-ink/8 p-3 ring-1 ring-grad-rule">
              <p className="font-serif text-500 font-semibold leading-none text-grad-ink">
                {/*
                  Design-audit finding: a bare "0" here on every first visit, sitting next
                  to two tiles that usually show a real accumulated number, read as a
                  broken/empty feature rather than an honestly session-scoped one. The fix
                  is not to hide the zero — it's real — but to say WHY it's zero when the
                  reason is "haven't asked yet this visit" rather than "asked and got
                  nothing," which are two different situations this tile used to render
                  identically.
                */}
                {turns.length === 0 ? "—" : ideasThisSession}
              </p>
              <p className="mt-1 text-100 text-grad-ink-soft">
                {turns.length === 0 ? "Ideas generated this session — ask below to start" : "Ideas generated this session"}
              </p>
            </div>
            <div className="col-span-2 rounded-xl bg-grad-ink/8 p-3 ring-1 ring-grad-rule">
              <p className="truncate text-200 font-semibold text-grad-ink" title={mostRecentTopic}>
                {mostRecentTopic ?? "Nothing asked yet"}
              </p>
              <p className="mt-0.5 text-100 text-grad-ink-soft">Most recent topic</p>
            </div>
          </div>
        </div>
      </div>

      {/*
        Suggestions read as launchable actions, not sample text sitting apart from the
        input (production redesign, change 4): a category, the exact question, and an
        explicit "run this" cue. Shown only before the first real question — once actual
        results exist below, a row of examples above them would compete with, not guide,
        what the page is now actually showing.
      */}
      {turns.length === 0 ? (
        <div>
          <p className="mb-2.5 text-200 font-semibold text-muted-foreground">Try one of these</p>
          <div className="grid gap-2.5 sm:grid-cols-3">
            {examples.map((example) => {
              const Icon = MODE_ICON[example.mode] ?? Lightbulb;
              return (
                <button
                  key={example.query}
                  type="button"
                  onClick={() => runQuery(example.query)}
                  disabled={create.isPending}
                  className="flex flex-col gap-2 rounded-xl bg-card p-3.5 text-left shadow-e1 ring-1 ring-inset ring-border transition-all duration-[var(--dur-base)] hover:-translate-y-0.5 hover:shadow-e3 disabled:pointer-events-none disabled:opacity-50"
                >
                  <span className="flex items-center gap-1.5 text-100 font-semibold uppercase tracking-wide text-accent-700">
                    <Icon aria-hidden className="size-3.5 shrink-0" />
                    {example.mode}
                  </span>
                  <span className="text-100 text-foreground">&ldquo;{example.query}&rdquo;</span>
                  <span className="mt-auto text-100 font-semibold text-accent-700">Run this question →</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Newest first: the input lives in the hero above, not at the foot of a
              growing thread, so a fresh answer belongs right under it rather than at
              the bottom of a list someone has to scroll to find. */}
          {[...turns].reverse().map((t) => (
            <TurnBubble
              key={t.key}
              discoveryQueryId={t.id}
              query={t.query}
              onItemsResolved={(count) => setIdeaCounts((prev) => (prev[t.key] === undefined ? { ...prev, [t.key]: count } : prev))}
            />
          ))}
        </div>
      )}

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

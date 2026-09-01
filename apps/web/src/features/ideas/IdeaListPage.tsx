import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronDown, Lightbulb, Search, X } from "lucide-react";
import { Button, EmptyState, ErrorState, Input, Skeleton, StatusPill } from "@iep/ui";
import { IdeaStatus } from "@iep/contracts";
import type { IdeaSummary } from "@iep/contracts";
import { useSession } from "../../app/use-session";
import { STATUS_LABEL, parseSort, useIdeaList } from "./api";
import { VoteCount } from "../feedback/VoteButtons";
import { ScoreRing } from "../rankings/DashboardHero";

const link = ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
  <Link to={to} className={className}>{children}</Link>
);

const isStatus = (v: string): v is IdeaStatus => IdeaStatus.safeParse(v).success;

/**
 * The statuses worth a one-click filter, in lifecycle order.
 *
 * Not every value in the enum: ARCHIVED and REJECTED are rare and would take two of the
 * slots people actually reach for. They stay reachable through the URL, which is the
 * contract this filter is written against.
 */
const VISIBLE_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "RANKED",
  // `as const satisfies`, not a `readonly IdeaStatus[]` annotation. The annotation widens the
  // element type back to the whole enum, so FILTER_TONE below then demands a tone for all
  // fifteen statuses — while `satisfies` still checks each entry IS a real status.
] as const satisfies readonly IdeaStatus[];

/** The at-rest tone of each filter pill — the tint of the state it selects. */
const FILTER_TONE: Record<(typeof VISIBLE_STATUSES)[number], string> = {
  DRAFT: "bg-muted text-muted-foreground hover:bg-muted",
  SUBMITTED: "bg-state-info-bg text-state-info hover:bg-state-info-bg",
  UNDER_REVIEW: "bg-state-warn-bg text-state-warn hover:bg-state-warn-bg",
  RANKED: "bg-accent text-accent-foreground hover:bg-accent",
};

/**
 * Search submits rather than filtering as you type.
 *
 * A keystroke-triggered URL write puts one history entry per letter in front of Back, and
 * §6.3 assertion 4 says Back must be honest. Enter submits.
 */
function SearchBox({ value, onSubmit }: { value: string; onSubmit: (v: string) => void }) {
  const [draft, setDraft] = React.useState(value);
  const [lastFromUrl, setLastFromUrl] = React.useState(value);

  /**
   * The URL is the source of truth: arriving on a link, or pressing Back, must refill the
   * box. Adjusted during render rather than in an effect — an effect that sets state
   * renders the stale value first and then immediately re-renders, which is the cascading
   * render the lint rule is about. React documents this exact pattern for the case.
   */
  if (value !== lastFromUrl) {
    setLastFromUrl(value);
    setDraft(value);
  }

  return (
    <form
      className="relative"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(draft.trim());
      }}
    >
      <Search
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        type="search"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Search ideas"
        aria-label="Search ideas"
        className="h-9 w-56 pl-9"
      />
    </form>
  );
}

interface Props {
  /** "mine" scopes to the signed-in user; "all" shows everything they may see. */
  readonly scope: "mine" | "all";
}

/**
 * Idea list (SPEC §6.2 rows 2, 25).
 *
 * Two contract rules are visible here:
 *   - the WHOLE ROW navigates, not just the title
 *   - filters and paging live in the URL, so Back restores them (§6.3 assertion 4)
 */
export function IdeaListPage({ scope }: Props) {
  const [params, setParams] = useSearchParams();
  const session = useSession();
  const page = Math.max(1, Number(params.get("page") ?? 1));

  const status = params.getAll("status").filter(isStatus);
  const search = params.get("q") ?? "";

  const list = useIdeaList({
    page,
    ...(scope === "mine" && session.data ? { submitterId: session.data.user.id } : {}),
    ...(search ? { q: search } : {}),
    ...(status.length > 0 ? { status } : {}),
    sort: parseSort(params.get("sort")),
  });

  /**
   * Every filter is a URL write, never component state (SPEC §7.8).
   *
   * Anything that changes WHAT you are looking at resets to page 1 — staying on page 4
   * of a three-page result is how a filter appears to have returned nothing.
   */
  const update = (mutate: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(params);
    mutate(next);
    next.delete("page");
    setParams(next);
  };

  const setPage = (next: number) => {
    const p = new URLSearchParams(params);
    p.set("page", String(next));
    setParams(p); // URL, not state — Back must return to this exact view
  };

  const toggleStatus = (value: IdeaStatus) =>
    update((next) => {
      const now = next.getAll("status").filter(isStatus);
      next.delete("status");
      for (const v of now.includes(value) ? now.filter((x) => x !== value) : [...now, value]) {
        next.append("status", v);
      }
    });

  return (
    <main className="page">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          {/*
            The h1 stays the nav map's own title ("Ideas"), not the canvas's "Explore
            ideas". The map is a frozen P0 artifact and its title is what the route is
            called everywhere else — the breadcrumbs, the sidebar and J-3 all read it. The
            canvas's phrasing lands in the deck below, where it costs nothing.
          */}
          <h1>{scope === "mine" ? "My ideas" : "Ideas"}</h1>
          <p className="muted">
            {scope === "mine"
              ? "Everything you have submitted, including drafts."
              : "Explore what people have proposed. Back the ones you would use — votes are a demand signal reviewers actually read."}
          </p>
        </div>
        <Button asChild>{link({ to: "/ideas/new", children: "Submit an idea" })}</Button>
      </div>

      {/*
        The nav map has declared these search params since P0 and nothing rendered a
        control for any of them — a page called "Explore ideas" with no way to explore.

        Pills rather than buttons, each carrying its own status tone (Idea Platform
        Redesign — "Explore ideas"). The tone is the SAME pairing `StatusPill` uses on the
        cards below, so a filter and the thing it filters for are visibly the same colour;
        a filter row in one flat grey is a row you have to read rather than aim at.

        `brand-pill` for the active state, not the accent: see the note in index.css —
        white on --accent-700 fails AA once the tokens flip to dark.
      */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <SearchBox value={search} onSubmit={(v) => update((n) => (v ? n.set("q", v) : n.delete("q")))} />

        {VISIBLE_STATUSES.map((value) => {
          const on = status.includes(value);
          return (
            <Button
              key={value}
              variant="ghost"
              size="sm"
              aria-pressed={on}
              onClick={() => toggleStatus(value)}
              className={
                on
                  ? "brand-pill rounded-full font-semibold text-grad-ink hover:text-grad-ink"
                  : `rounded-full font-medium ${FILTER_TONE[value]}`
              }
            >
              {STATUS_LABEL[value]}
            </Button>
          );
        })}

        {status.length > 0 || search ? (
          <Button variant="ghost" size="sm" className="rounded-full" onClick={() => setParams(new URLSearchParams())}>
            <X aria-hidden className="size-4" />
            Clear
          </Button>
        ) : null}
      </div>

      {list.isPending ? (
        <div className="grid gap-4 lg:grid-cols-2" aria-busy="true">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-44 w-full rounded-2xl" />
          ))}
        </div>
      ) : list.isError ? (
        <ErrorState
          title="Could not load ideas"
          description="The list did not come back. Trying again usually works."
          onRetry={() => void list.refetch()}
          escapeTo={{ label: "Submit an idea instead", to: "/ideas/new" }}
          renderLink={link}
        />
      ) : list.data.items.length === 0 ? (
        <EmptyState
          icon={<Lightbulb aria-hidden className="size-7" />}
          title={scope === "mine" ? "You have not submitted anything yet" : "No ideas to show yet"}
          description={
            scope === "mine"
              ? "Ideas start as a few sentences in your own words. You can save a draft and come back to it."
              : "Once ideas are submitted and ranked, they appear here."
          }
          action={{ label: "Submit the first one", to: "/ideas/new" }}
          renderLink={link}
        />
      ) : (
        <>
          {/*
            A grid of cards, not a table (Idea Platform Redesign — "Explore ideas").

            The nav map declares `affordance: "row"` for IdeaList → Idea, and the rule that
            declaration is protecting is "the WHOLE item navigates, not just the title".
            That rule is kept exactly: each card is one link covering the whole surface, and
            the filters still live in the URL so Back restores them (§6.3 assertion 4). What
            changed is the shape of the item, because a six-column table is the wrong
            container for a list people are meant to BROWSE — the score, the status and who
            wrote it were three separate columns to saccade across, and on a phone three of
            the six were off-screen entirely.

            The controls are still one per card and still outside the link: a vote count
            nested inside a navigation target is a control you cannot reach without leaving.
          */}
          <ul className="grid list-none gap-4 p-0 lg:grid-cols-2">
            {list.data.items.map((idea) => (
              <li key={idea.id}>
                <IdeaCard idea={idea} />
              </li>
            ))}
          </ul>

          {list.data.meta.totalPages > 1 ? (
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <p className="text-200 text-muted-foreground tabular">
                Showing {list.data.items.length} of {list.data.meta.total} · page{" "}
                {list.data.meta.page} of {list.data.meta.totalPages}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Previous
                </Button>
                {/*
                  The canvas has a single gradient "Show 4 more" that appends to the list.
                  Paging stays Previous/Next: SPEC §7.8 puts the page in the URL so a board
                  is shareable and Back is honest, and a load-more button has no page to put
                  there. The canvas's emphasis is kept — Next is the filled control.
                */}
                <Button
                  size="sm"
                  className="brand-pill rounded-full text-grad-ink"
                  disabled={page >= list.data.meta.totalPages}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                  <ChevronDown aria-hidden className="size-4 -rotate-90" />
                </Button>
              </div>
            </div>
          ) : (
            <p className="mt-6 text-200 text-muted-foreground tabular">
              {list.data.meta.total} {list.data.meta.total === 1 ? "idea" : "ideas"}.
            </p>
          )}
        </>
      )}
    </main>
  );
}

/* ══════════════════════════════════════════════════════════════════
 * One idea, as a card (Idea Platform Redesign — "Explore ideas")
 * ══════════════════════════════════════════════════════════════════ */

/**
 * The coloured rule across the top of a card.
 *
 * The status already has a pill with an icon and a label, so this is the third cue rather
 * than the only one — nothing here is carried by colour alone (SPEC §7.6). The ramp
 * gradient is reserved for RANKED because that is the one state with a score behind it.
 *
 * Every status in the enum is listed. A new lifecycle state added to the contract becomes
 * a compile error here rather than silently rendering a grey line nobody chose.
 */
const RULE: Record<IdeaStatus, string> = {
  DRAFT: "bg-border",
  SUBMITTED: "bg-state-info",
  AI_ANALYSIS: "bg-ai-ink",
  NEEDS_CLARIFICATION: "bg-factor-down",
  EVALUATED: "bg-ramp-4",
  RANKED: "bg-gradient-to-r from-ramp-4 via-ramp-5 to-grad-to",
  UNDER_REVIEW: "bg-state-warn",
  PROTOTYPE_CANDIDATE: "bg-ramp-3",
  PILOT: "bg-ramp-3",
  PRODUCTION_CANDIDATE: "bg-ramp-3",
  IMPLEMENTED: "bg-state-ok",
  PARKED: "bg-border-strong",
  BLOCKED: "bg-state-danger",
  REJECTED: "bg-state-danger",
  ARCHIVED: "bg-border-strong",
};

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();

function IdeaCard({ idea }: { idea: IdeaSummary }) {
  /*
   * "Analysis running" is a state, not a missing score.
   *
   * The canvas draws these two very differently and it is right to: a dial reading nothing
   * says the idea was measured and came out empty, whereas the pipeline simply has not
   * finished. A draft has no score for a third reason again — it has not been submitted.
   */
  const analysing = idea.status === "AI_ANALYSIS";

  return (
    <article className="relative flex h-full flex-col overflow-hidden rounded-2xl bg-card p-5 shadow-e2 ring-1 ring-inset ring-border transition-all duration-[var(--dur-base)] focus-within:ring-2 focus-within:ring-ring hover:-translate-y-0.5 hover:shadow-e3">
      <span aria-hidden className={`absolute inset-x-0 top-0 h-1.5 ${RULE[idea.status]}`} />

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill kind="LIFECYCLE" status={idea.status} label={STATUS_LABEL[idea.status]} />
            {idea.rank === null ? null : (
              <span className="inline-flex items-center rounded-full bg-accent px-2.5 py-0.5 text-100 font-bold tabular-nums text-accent-foreground">
                Ranked #{idea.rank}
              </span>
            )}
          </div>

          {/*
            The link covers the whole card, so the title is the accessible name for the
            navigation and the rest of the card is inside its hit area. `after:absolute
            after:inset-0` is what does that without nesting the vote counts inside an <a>.
          */}
          <h2 className="mt-2.5 text-400 font-semibold leading-snug">
            <Link
              to={`/ideas/${idea.id}/overview`}
              className="no-underline after:absolute after:inset-0 after:content-['']"
            >
              {idea.title}
            </Link>
          </h2>

          {/*
            The canvas puts the problem statement under the title. `IdeaSummary` carries no
            prose — only the title — so there is nothing to excerpt. Adding the field is an
            additive contract change and a real improvement to this card; it is NOT done
            here because the list endpoint would have to select and ship the current
            version's body for every row, which is a decision about the API's shape rather
            than about this page.
          */}
        </div>

        {analysing ? (
          <span
            aria-hidden
            /* Deliberately not the `ai-*` palette: provenance.test.ts reserves it for
               <Provenance>, where it means "a model wrote this". This says a job is
               running, which is a different claim. */
            className="motion-pending-pulse grid size-16 shrink-0 place-items-center rounded-full bg-card text-center text-100 font-bold leading-tight text-accent-700 ring-2 ring-inset ring-ramp-3"
          >
            analysis
            <br />
            running
          </span>
        ) : idea.compositeScore === null ? null : (
          <ScoreRing value={idea.compositeScore} size="sm" />
        )}
      </div>

      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
        <span className="flex min-w-0 items-center gap-2 text-100 text-muted-foreground">
          <span
            aria-hidden
            className="grid size-6.5 shrink-0 place-items-center rounded-full bg-accent text-100 font-extrabold text-accent-foreground"
          >
            {initials(idea.submitter.displayName)}
          </span>
          <span className="truncate">
            {idea.submitter.displayName}
            {idea.department ? ` · ${idea.department.name}` : ""}
          </span>
        </span>

        {/*
          Counts only, no controls. A card is for scanning; voting on something you are
          skimming means voting on a title, which is not an opinion worth recording. The
          buttons live on the idea itself.

          `relative` lifts it above the title link's ::after overlay so the numbers are
          selectable rather than swallowed by the navigation target.
        */}
        {idea.status === "DRAFT" ? (
          <span className="text-100 text-muted-foreground">Not submitted</span>
        ) : (
          <span className="relative">
            <VoteCount ideaId={idea.id} />
          </span>
        )}
      </div>
    </article>
  );
}


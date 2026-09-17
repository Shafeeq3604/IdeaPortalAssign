import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Archive, ArrowDownUp, ChevronDown, Compass, LayoutGrid, Lightbulb, List, PenSquare, Search,
  User, X,
} from "lucide-react";
import {
  Button, EmptyState, ErrorState, Input, Select, SelectContent, SelectItem, SelectTrigger,
  SelectValue, Skeleton, StatusPill, Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@iep/ui";
import { IdeaStatus } from "@iep/contracts";
import type { IdeaSummary } from "@iep/contracts";
import { InlineStat, PageHeading } from "../../app/PageHero";
import { STATUS_LABEL, parseSort, useIdeaList, type IdeaSort } from "./api";
import { IdeaCard } from "./IdeaCard";
import { useSession } from "../../app/use-session";

const link = ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
  <Link to={to} className={className}>{children}</Link>
);

const isStatus = (v: string): v is IdeaStatus => IdeaStatus.safeParse(v).success;

/**
 * The statuses worth a one-click filter, in lifecycle order.
 *
 * Not every value in the enum: REJECTED is rare and would take a slot people actually
 * reach for. It stays reachable through the URL, which is the contract this filter is
 * written against. ARCHIVED gets its own dedicated toggle below instead of a slot here —
 * common enough (anyone who has ever archived something needs a way back to it) to need
 * a real control, but a distinct enough action that it reads better set apart from the
 * lifecycle chips than blended into them.
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

/** Every value `parseSort` accepts, in the order offered — same closed set as the API's
 * own `ListIdeasQuery["sort"]`, so a new sort added to the contract is a compile error
 * here rather than a silently missing menu item. */
const SORT_LABEL: Record<IdeaSort, string> = {
  recent: "Newest first",
  oldest: "Oldest first",
  rank: "Rank",
  title: "Title (A–Z)",
  status: "Status",
};

/**
 * The one control this list was missing (Idea Platform Redesign — "Explore ideas").
 *
 * Filtering by status was the only way to narrow 20+ ideas down to something scannable;
 * there was no way to say HOW to order what's left. Same URL-is-the-source-of-truth
 * contract as everything else on this page (§7.8) — picking an option is a `sort` write,
 * so a shared or reloaded link keeps whatever order was chosen.
 */
function SortSelect({ value, onChange }: { value: IdeaSort; onChange: (next: IdeaSort) => void }) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as IdeaSort)}>
      <SelectTrigger
        aria-label="Sort ideas"
        className="h-9 w-auto gap-1.5 rounded-full border-none bg-transparent font-medium text-muted-foreground shadow-none hover:bg-muted"
      >
        <ArrowDownUp aria-hidden className="size-3.5" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {(Object.keys(SORT_LABEL) as IdeaSort[]).map((key) => (
          <SelectItem key={key} value={key}>
            {SORT_LABEL[key]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

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

  /**
   * There is no sort control on this page — the URL's `sort` wins when someone links to
   * one directly, but absent that, "recent" is the wrong default the moment RANKED is
   * part of the view. A "Ranked" filter showing ideas in submission order rather than
   * rank order reads as broken, not as a neutral choice.
   */
  const sortParam = params.get("sort");
  const sort = sortParam ? parseSort(sortParam) : status.includes(IdeaStatus.enum.RANKED) ? "rank" : "recent";

  const list = useIdeaList({
    page,
    ...(scope === "mine" && session.data ? { submitterId: session.data.user.id } : {}),
    ...(search ? { q: search } : {}),
    ...(status.length > 0 ? { status } : {}),
    sort,
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

  /** An explicit choice always wins over the "rank once Ranked is filtered for" default
   * above — picking "Newest first" while looking at Ranked ideas is a real, sortable
   * decision, not a state that default should silently override. */
  const setSort = (value: IdeaSort) => update((next) => next.set("sort", value));

  /**
   * Grid vs table (§14/§15 of the enterprise-polish pass), URL-backed like every other
   * filter here (§7.8) — a shared link to the table view stays the table view. Table is
   * the "dense enterprise view" the request asks for; it reuses `IdeaSummary` fields only
   * (Rank, Idea, Department, Score, Status, Updated), the same payload the grid already
   * has, so switching views costs no extra request.
   */
  const view = params.get("view") === "table" ? "table" : "grid";
  const setView = (next: "grid" | "table") =>
    update((n) => (next === "grid" ? n.delete("view") : n.set("view", next)));

  return (
    <main className="page">
      {/*
        The h1 stays the nav map's own title ("Ideas"), not the canvas's "Explore
        ideas". The map is a frozen P0 artifact and its title is what the route is
        called everywhere else — the breadcrumbs, the sidebar and J-3 all read it. The
        canvas's phrasing lands in the description, where it costs nothing.

        Plain heading, not the gradient hero (enterprise-polish pass, §3/§19): this page
        is worked in dozens of times a day by every role in the product, not arrived at
        once — the same reasoning that already moved Rankings, the Review queue and both
        admin screens off `PageHero` onto `PageHeading`. The one gradient surface left in
        the product is the Management/Admin dashboard's hero, which nobody sees more than
        once a session.
      */}
      <PageHeading
        icon={scope === "mine" ? User : Compass}
        heading={scope === "mine" ? "My ideas" : "Ideas"}
        description={
          scope === "mine"
            ? "Everything you have submitted, including drafts."
            : "Explore what people have proposed. Back the ones you would use — votes are a demand signal reviewers actually read."
        }
        actions={
          <Button asChild>
            <Link to="/ideas/new">
              <PenSquare aria-hidden className="size-4" />
              Submit an idea
            </Link>
          </Button>
        }
        stats={
          list.data ? (
            <InlineStat
              value={String(list.data.meta.total)}
              label={scope === "mine" ? "your ideas" : "ideas on the board"}
            />
          ) : undefined
        }
      />

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

        <span aria-hidden className="mx-1 hidden h-5 w-px shrink-0 bg-border sm:inline-block" />

        {/*
          Archived ideas were reachable only by hand-editing the URL: no chip, and
          archiving one navigated straight back to the active list, so it read as if the
          idea had been deleted rather than archived. This toggle is the fix — set apart
          from the lifecycle chips above (a divider, a muted tone, an icon) because
          "archived" isn't a step in the pipeline the way the others are.
        */}
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={status.includes(IdeaStatus.enum.ARCHIVED)}
          onClick={() => toggleStatus(IdeaStatus.enum.ARCHIVED)}
          className={
            status.includes(IdeaStatus.enum.ARCHIVED)
              ? "brand-pill rounded-full font-semibold text-grad-ink hover:text-grad-ink"
              : "rounded-full font-medium text-muted-foreground hover:bg-muted"
          }
        >
          <Archive aria-hidden className="size-3.5" />
          Archived
        </Button>

        {status.length > 0 || search ? (
          <Button variant="ghost" size="sm" className="rounded-full" onClick={() => setParams(new URLSearchParams())}>
            <X aria-hidden className="size-4" />
            Clear
          </Button>
        ) : null}

        {/* The one control this list was missing: a way to say HOW to order what the
            filters above narrowed it down to, not just what to narrow it to. `ml-auto`
            keeps it apart from the filter pills rather than reading as one more of them —
            it changes ORDER, not WHAT'S INCLUDED. */}
        <div className="ml-auto flex items-center gap-1">
          <SortSelect value={sort} onChange={setSort} />

          {/* Grid for browsing one idea at a time, table for scanning many at once — the
              same two-mode split Explore/My ideas asked for (§14/§15). A single "view"
              toggle, not a second navigation, since both modes show the exact same
              filtered set. */}
          <div className="flex items-center rounded-full bg-muted p-0.5">
            <button
              type="button"
              aria-pressed={view === "grid"}
              aria-label="Grid view"
              onClick={() => setView("grid")}
              className={`grid size-7 place-items-center rounded-full transition-colors duration-[var(--dur-fast)] ${
                view === "grid" ? "bg-card text-foreground shadow-e1" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <LayoutGrid aria-hidden className="size-3.5" />
            </button>
            <button
              type="button"
              aria-pressed={view === "table"}
              aria-label="Table view"
              onClick={() => setView("table")}
              className={`grid size-7 place-items-center rounded-full transition-colors duration-[var(--dur-fast)] ${
                view === "table" ? "bg-card text-foreground shadow-e1" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <List aria-hidden className="size-3.5" />
            </button>
          </div>
        </div>
      </div>

      {list.isPending ? (
        // Matches whichever view is selected — a table-shaped skeleton followed by a
        // grid of cards (or the reverse) reads as the wrong content loading, not as a
        // preview of what is about to appear.
        view === "table" ? (
          <div className="overflow-hidden rounded-2xl border border-border" aria-busy="true">
            <div className="h-10 bg-muted" />
            <div className="space-y-3 p-4">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3" aria-busy="true">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-44 w-full rounded-2xl" />
            ))}
          </div>
        )
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

            A third column at `xl` (a card this dense — a title, a pill, a score ring, one
            row of metadata — has no reason to sit alone in a wide single column on a
            large monitor): two columns was the whole grid on anything short of an
            ultrawide, which is most of the unused width the "explore" surface was leaving
            on the table.
          */}
          {view === "table" ? (
            <IdeaTable items={list.data.items} />
          ) : (
            <ul className="grid list-none gap-4 p-0 lg:grid-cols-2 xl:grid-cols-3">
              {list.data.items.map((idea) => (
                <li key={idea.id}>
                  <IdeaCard idea={idea} />
                </li>
              ))}
            </ul>
          )}

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
 * All ideas, as a table (enterprise-polish pass §14/§15 — the "dense
 * enterprise view" toggle)
 * ══════════════════════════════════════════════════════════════════ */

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();

const HEAD = "text-100 font-semibold uppercase tracking-wider text-muted-foreground";

function IdeaTable({ items }: { items: IdeaSummary[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <Table>
        <TableHeader className="bg-muted">
          <TableRow className="hover:bg-transparent">
            <TableHead className={HEAD}>Rank</TableHead>
            <TableHead className={HEAD}>Idea</TableHead>
            <TableHead className={HEAD}>Department</TableHead>
            <TableHead className={`${HEAD} text-right`}>Score</TableHead>
            <TableHead className={HEAD}>Status</TableHead>
            <TableHead className={`${HEAD} text-right`}>Updated</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((idea) => (
            <TableRow key={idea.id}>
              <TableCell>
                <span className="inline-flex items-center rounded-md bg-muted px-2.5 py-1 text-100 font-bold text-foreground">
                  {idea.rank === null ? "—" : `#${idea.rank}`}
                </span>
              </TableCell>
              <TableCell className="whitespace-normal">
                {/* The title is the link — same clickability contract the grid's whole
                    card carries (§6.2), just expressed as a table cell here. */}
                <Link to={`/ideas/${idea.id}/overview`} className="font-medium">
                  {idea.title}
                </Link>
                <span className="mt-0.5 flex items-center gap-1.5 text-200 text-muted-foreground">
                  <span
                    aria-hidden
                    className="grid size-4.5 shrink-0 place-items-center rounded-full bg-accent text-100 font-extrabold text-accent-foreground"
                  >
                    {initials(idea.submitter.displayName)}
                  </span>
                  {idea.submitter.displayName}
                </span>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {idea.department?.name ?? "—"}
              </TableCell>
              <TableCell className="text-right">
                {idea.compositeScore === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span className="inline-flex items-center rounded-lg border border-accent-100 bg-accent-050 px-3 py-1 text-200 font-bold tabular-nums text-accent-700">
                    {idea.compositeScore.toFixed(1)}
                  </span>
                )}
              </TableCell>
              <TableCell>
                <StatusPill kind="LIFECYCLE" status={idea.status} label={STATUS_LABEL[idea.status]} />
              </TableCell>
              <TableCell className="text-right text-muted-foreground tabular-nums">
                {new Date(idea.updatedAt).toLocaleDateString()}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}


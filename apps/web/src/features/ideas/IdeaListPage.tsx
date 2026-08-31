import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Lightbulb, Search, X } from "lucide-react";
import {
  Button, EmptyState, ErrorState, Input, ScoreDisplay, Skeleton, StatusPill,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@iep/ui";
import { IdeaStatus } from "@iep/contracts";
import { useSession } from "../../app/use-session";
import { STATUS_LABEL, parseSort, useIdeaList } from "./api";
import { VoteCount } from "../feedback/VoteButtons";

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
const VISIBLE_STATUSES: readonly IdeaStatus[] = [
  "DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "RANKED",
];

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
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1>{scope === "mine" ? "My ideas" : "Ideas"}</h1>
          <p className="muted">
            {scope === "mine"
              ? "Everything you have submitted, including drafts."
              : "Ideas you can see. Other people's appear once they have been ranked."}
          </p>
        </div>
        <Button asChild>{link({ to: "/ideas/new", children: "Submit an idea" })}</Button>
      </div>

      {/*
        The nav map has declared these search params since P0 and nothing rendered a
        control for any of them — a page called "Explore ideas" with no way to explore.
      */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <SearchBox value={search} onSubmit={(v) => update((n) => (v ? n.set("q", v) : n.delete("q")))} />

        {VISIBLE_STATUSES.map((value) => {
          const on = status.includes(value);
          return (
            <Button
              key={value}
              variant={on ? "default" : "outline"}
              size="sm"
              aria-pressed={on}
              onClick={() => toggleStatus(value)}
            >
              {STATUS_LABEL[value]}
            </Button>
          );
        })}

        {status.length > 0 || search ? (
          <Button variant="ghost" size="sm" onClick={() => setParams(new URLSearchParams())}>
            <X aria-hidden className="size-4" />
            Clear
          </Button>
        ) : null}
      </div>

      {list.isPending ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
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
            Six columns do not fit a phone. Without this the table was CLIPPED at the
            viewport edge: titles cut mid-word and Status, Score and Reactions simply gone,
            with no way to reach them. A data table on a narrow screen should scroll, not
            silently lose three of its columns.
          */}
          <div className="-mx-1 overflow-x-auto px-1">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Idea</TableHead>
                <TableHead>Status</TableHead>
                {/* The number people came for, and it was not on the list at all. */}
                <TableHead className="text-right">Score</TableHead>
                <TableHead className="hidden sm:table-cell">Submitted by</TableHead>
                {/* §14: voting activity visible at a glance, not only on the idea. */}
                <TableHead className="hidden text-right sm:table-cell">Reactions</TableHead>
                <TableHead className="hidden text-right md:table-cell">Version</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.items.map((idea) => (
                <TableRow
                  key={idea.id}
                  className="cursor-pointer transition-colors duration-[var(--dur-fast)] hover:bg-accent/40"
                >
                  {/* The link fills the cell so the whole row is the target (§6.2 row 2). */}
                  {/*
                    The title WRAPS. shadcn puts `whitespace-nowrap` on every cell, which
                    is right for a status or a figure and wrong for a sentence: one long
                    title forced the table to nearly twice the width of a phone, so the
                    score sat two swipes off-screen. Wrapping the one column that holds
                    prose lets everything else fit.
                  */}
                  <TableCell className="p-0 whitespace-normal">
                    <Link
                      to={`/ideas/${idea.id}/overview`}
                      className="block min-w-[8.5rem] px-3 py-3 font-medium sm:min-w-[11rem] sm:px-4"
                    >
                      {idea.title}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {/*
                      A tone per lifecycle group, not one grey badge for all fifteen.
                      The pill still carries its icon and its label, so the row survives
                      greyscale and a colour-blind reader loses nothing (SPEC §7.6).
                    */}
                    <StatusPill
                      kind="LIFECYCLE"
                      status={idea.status}
                      label={STATUS_LABEL[idea.status]}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    {idea.compositeScore === null ? (
                      // Not "0". An unevaluated idea has no score, and a zero would read
                      // as a bad one (P-1).
                      <span className="text-100 text-muted-foreground">Not scored</span>
                    ) : (
                      <span className="inline-flex items-baseline gap-2">
                        {idea.rank === null ? null : (
                          <span className="text-100 tabular-nums text-muted-foreground">
                            #{idea.rank}
                          </span>
                        )}
                        <ScoreDisplay value={idea.compositeScore} size="sm" />
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">
                    {idea.submitter.displayName}
                  </TableCell>
                  <TableCell className="hidden text-right sm:table-cell">
                    {/*
                      Counts only, no controls. A row is for scanning; voting from a list
                      you are skimming means voting on a title, which is not an opinion
                      worth recording. The buttons live on the idea itself.
                    */}
                    {idea.status === "DRAFT" ? null : <VoteCount ideaId={idea.id} />}
                  </TableCell>
                  <TableCell className="hidden text-right tabular md:table-cell">
                    v{idea.currentVersionNo}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>

          {list.data.meta.totalPages > 1 ? (
            <div className="mt-6 flex items-center justify-between">
              <p className="text-200 text-muted-foreground tabular">
                Page {list.data.meta.page} of {list.data.meta.totalPages} · {list.data.meta.total} ideas
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= list.data.meta.totalPages}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </main>
  );
}

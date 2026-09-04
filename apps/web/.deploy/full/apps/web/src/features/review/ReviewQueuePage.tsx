import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, Flag, ListChecks } from "lucide-react";
import {
  Badge, Button, Card, CardContent, EmptyState, ErrorState, Skeleton, StatusPill, Table,
  TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@iep/ui";
import { STATUS_LABEL } from "../ideas/api";
import { useReviewQueue } from "./api";

/*
 * A clean, structured table rather than floating row-cards.
 *
 * The row-card treatment (matching /rankings) put six pieces of information per idea into
 * a layout with no fixed columns, and on this screen — where a reviewer scans rank,
 * submitter, AI status and score across many rows at once — that reads as clutter rather
 * than rhythm. A table's aligned columns are the right tool for that comparison; the
 * ranked board and the idea list stay cards because browsing one idea at a time is a
 * different task from scanning a queue. Every colour below is still a design token
 * (`bg-card`, `bg-muted`, `bg-accent-050`, `bg-state-warn-bg` …) — none of it is a raw
 * Tailwind palette class, so the table stays correct in dark mode and inside
 * `pnpm lint:tokens`.
 */
const HEAD = "text-100 font-semibold uppercase tracking-wider text-muted-foreground";

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();

const link = ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
  <Link to={to} className={className}>{children}</Link>
);

/**
 * The reviewer's queue (P6 — J-2, SPEC §9.8).
 *
 * Oldest first, and the wait is a column rather than something a reviewer has to compute.
 * Sorting by score by default would quietly bury the ideas that have been waiting
 * longest, which is the exact failure a queue exists to prevent.
 *
 * Filters live in the URL (SPEC §7.8) so a reviewer can share "the ones I am looking at".
 */
export function ReviewQueuePage() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get("page") ?? 1));
  const sort = params.get("sort") ?? "oldest";

  const query = useReviewQueue({ page, sort });

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    next.set(key, value);
    if (key !== "page") next.delete("page");
    setParams(next);
  };

  return (
    <main className="page">
      <nav aria-label="Breadcrumb" className="crumbs">
        <Link to="/ideas">Ideas</Link>  ›  Review queue
      </nav>
      <h1 className="flex items-center gap-3">
        <span
          aria-hidden
          className="grid size-9 shrink-0 place-items-center rounded-lg bg-state-warn-bg text-state-warn"
        >
          <ListChecks className="size-4.5" />
        </span>
        Review queue
      </h1>

      {query.isPending ? (
        <Skeleton className="mt-6 h-96 w-full" aria-busy="true" />
      ) : query.isError ? (
        <ErrorState
          title="Could not load the queue"
          description="Nothing has been lost — this is the queue view failing to load."
          onRetry={() => void query.refetch()}
          escapeTo={{ label: "Back to ideas", to: "/ideas" }}
          renderLink={link}
        />
      ) : query.data.items.length === 0 ? (
        <EmptyState
          title="Nothing waiting"
          description="No idea is currently awaiting a review decision. That is a good state, not an empty page."
          action={{ label: "Browse all ideas", to: "/ideas" }}
          renderLink={link}
        />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            {/* Same tone as the dashboard's "Needs you" tile — this queue is what that
                tile counts, so the two read as one fact rather than two coincidences. */}
            <span className="inline-flex items-center gap-1.5 rounded-full bg-state-warn-bg px-3 py-1 text-100 font-bold text-state-warn">
              <Flag aria-hidden className="size-3.5" />
              {query.data.meta.total} waiting
            </span>
            {/*
              Buttons, not links. These change how the list is ORDERED — they do not
              navigate anywhere new — and rendering them as inline links put two
              colour-only links inside a line of text, which axe flagged as a WCAG 1.4.1
              failure the moment administrators could finally reach this page.
            */}
            {(["oldest", "recent", "rank"] as const).map((option) => (
              <Button
                key={option}
                size="sm"
                variant="ghost"
                aria-pressed={sort === option}
                onClick={() => setParam("sort", option)}
                className={
                  sort === option
                    ? "brand-pill rounded-full font-semibold text-grad-ink hover:text-grad-ink"
                    : "rounded-full font-medium text-muted-foreground"
                }
              >
                {option === "oldest" ? "Longest waiting" : option === "recent" ? "Newest" : "By rank"}
              </Button>
            ))}
          </div>

          {/* `overflow-hidden` on the card itself, not just the scroll wrapper inside it —
              otherwise the header row's square corners poke past the card's rounded ones. */}
          <Card className="overflow-hidden py-0">
            <CardContent className="p-0">
              <Table>
                <TableHeader className="bg-muted">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className={HEAD}>Rank</TableHead>
                    <TableHead className={HEAD}>Idea title</TableHead>
                    <TableHead className={HEAD}>Submitter</TableHead>
                    <TableHead className={HEAD}>AI status</TableHead>
                    <TableHead className={`${HEAD} text-right`}>Score</TableHead>
                    {/* Not in the requested column list, but SPEC §9.8 / J-2 is explicit
                        that the wait is a column a reviewer reads, not something they
                        compute — dropping it would lose real information, not just style. */}
                    <TableHead className={`${HEAD} text-right`}>Waiting</TableHead>
                    <TableHead className={`${HEAD} text-right`}>
                      <span className="sr-only">Action</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {query.data.items.map((item) => (
                    <TableRow key={item.ideaId}>
                      <TableCell>
                        <span className="inline-flex items-center rounded-md bg-muted px-2.5 py-1 text-100 font-bold text-foreground">
                          {item.rank === null ? "—" : `#${item.rank}`}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        {/* The title is the link: a row that is only clickable in one
                            invisible spot fails the clickability contract (§6.2). */}
                        <Link to={`/ideas/${item.ideaId}/review`} className="font-medium">
                          {item.title}
                        </Link>
                        <span className="mt-0.5 block text-100 text-muted-foreground">
                          <StatusPill kind="LIFECYCLE" status={item.status} label={STATUS_LABEL[item.status]} />
                        </span>
                      </TableCell>
                      <TableCell>
                        <Link
                          to={`/people/${item.submitter.id}`}
                          className="inline-flex items-center gap-2 no-underline"
                        >
                          <span
                            aria-hidden
                            className="grid size-6 shrink-0 place-items-center rounded-full bg-accent text-100 font-extrabold text-accent-foreground"
                          >
                            {initials(item.submitter.displayName)}
                          </span>
                          {item.submitter.displayName}
                        </Link>
                      </TableCell>
                      <TableCell>
                        {/*
                          Muted on purpose — the goal is a quiet secondary label, not a
                          warning. `state-warn` already means "waiting on a person"
                          elsewhere in the product (the dashboard's "Needs you" tile); an
                          idea with unchecked AI content is not that, so it gets the
                          neutral tint instead.
                        */}
                        {item.hasUnvalidatedAi ? (
                          <Badge
                            variant="outline"
                            className="border-border/60 bg-muted font-medium text-muted-foreground"
                          >
                            AI not yet checked
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="inline-flex items-center rounded-lg border border-accent-100 bg-accent-050 px-3 py-1 text-200 font-bold tabular-nums text-accent-700">
                          {item.compositeScore === null ? "—" : item.compositeScore.toFixed(1)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground tabular-nums">
                        {item.waitingDays === 0 ? "today" : `${item.waitingDays}d`}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link
                          to={`/ideas/${item.ideaId}/review`}
                          aria-label={`Open review for ${item.title}`}
                          className="inline-flex rounded-md p-1.5 text-muted-foreground no-underline transition-colors duration-[var(--dur-fast)] hover:bg-muted hover:text-foreground"
                        >
                          <ArrowRight aria-hidden className="size-4" />
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {query.data.meta.totalPages > 1 ? (
            <p className="mt-4 text-200 text-muted-foreground">
              Page {query.data.meta.page} of {query.data.meta.totalPages}
              {page > 1 ? (
                <>
                  {" · "}
                  <Link to={`/review?page=${page - 1}&sort=${sort}`}>Previous</Link>
                </>
              ) : null}
              {page < query.data.meta.totalPages ? (
                <>
                  {" · "}
                  <Link to={`/review?page=${page + 1}&sort=${sort}`}>Next</Link>
                </>
              ) : null}
            </p>
          ) : null}
        </>
      )}
    </main>
  );
}

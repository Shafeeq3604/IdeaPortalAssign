import { Link, useSearchParams } from "react-router-dom";
import {
  Badge, Card, CardContent, EmptyState, ErrorState, Skeleton, Table, TableBody, TableCell,
  TableHead, TableHeader, TableRow,
} from "@iep/ui";
import { STATUS_LABEL } from "../ideas/api";
import { useReviewQueue } from "./api";

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
      <h1>Review queue</h1>

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
            <p className="text-200 text-muted-foreground">
              {query.data.meta.total} waiting
            </p>
            {(["oldest", "recent", "rank"] as const).map((option) => (
              <Link
                key={option}
                to={`/review?sort=${option}`}
                onClick={(event) => {
                  event.preventDefault();
                  setParam("sort", option);
                }}
                aria-current={sort === option ? "true" : undefined}
                className={sort === option ? "text-200 font-medium" : "text-200 text-muted-foreground"}
              >
                {option === "oldest" ? "Longest waiting" : option === "recent" ? "Newest" : "By rank"}
              </Link>
            ))}
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Idea</TableHead>
                    <TableHead>Submitter</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Score</TableHead>
                    <TableHead className="text-right">Rank</TableHead>
                    <TableHead className="text-right">Waiting</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {query.data.items.map((item) => (
                    <TableRow key={item.ideaId}>
                      <TableCell>
                        {/* The title is the link: a row that is only clickable in one
                            invisible spot fails the clickability contract (§6.2). */}
                        <Link to={`/ideas/${item.ideaId}/review`}>{item.title}</Link>
                        {item.hasUnvalidatedAi ? (
                          <Badge variant="outline" className="ml-2">
                            AI not yet checked
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Link to={`/people/${item.submitter.id}`}>{item.submitter.displayName}</Link>
                      </TableCell>
                      <TableCell>{STATUS_LABEL[item.status]}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {item.compositeScore === null ? "—" : item.compositeScore.toFixed(1)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {item.rank === null ? "—" : `#${item.rank}`}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {item.waitingDays === 0 ? "today" : `${item.waitingDays}d`}
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

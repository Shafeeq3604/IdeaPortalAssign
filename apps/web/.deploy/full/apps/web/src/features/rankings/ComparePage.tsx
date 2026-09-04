import { Link, useSearchParams } from "react-router-dom";
import {
  Card, CardContent, CardHeader, CardTitle, EmptyState, ErrorState, ScoreDisplay, Skeleton,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@iep/ui";
import { MATURITY_LABEL } from "../evaluation/api";
import { useCompare } from "./api";

const link = ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
  <Link to={to} className={className}>{children}</Link>
);

/**
 * Side-by-side comparison of two to four ideas (P7 — SPEC §9.9).
 *
 * The divergence table comes FIRST and the full grid second, because a comparison that
 * lists every criterion for every idea leaves the reader to do the diffing. What a
 * decision actually turns on is where the ideas disagree, so that is what the page leads
 * with.
 */
export function ComparePage() {
  const [params] = useSearchParams();
  const ids = params.getAll("ids");
  const profile = params.get("profile") ?? undefined;
  const query = useCompare(ids, profile);

  if (ids.length < 2 || ids.length > 4) {
    return (
      <main className="page">
        <h1>Compare ideas</h1>
        <EmptyState
          title="Pick two to four ideas"
          description="Two is the minimum for a comparison to say anything; above four the table stops being readable."
          action={{ label: "Go to the rankings", to: "/rankings" }}
          renderLink={link}
        />
      </main>
    );
  }

  return (
    <main className="page">
      <nav aria-label="Breadcrumb" className="crumbs">
        <Link to="/rankings">Rankings</Link>  ›  Compare
      </nav>
      <h1>Comparing {ids.length} ideas</h1>

      {query.isPending ? (
        <Skeleton className="mt-6 h-96 w-full" aria-busy="true" />
      ) : query.isError ? (
        <ErrorState
          title="Could not load the comparison"
          description="One of those ideas may have been removed, or you may not have access to it."
          onRetry={() => void query.refetch()}
          escapeTo={{ label: "Back to the rankings", to: "/rankings" }}
          renderLink={link}
        />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {query.data.ideas.map((idea) => (
              <Card key={idea.ideaId}>
                <CardHeader>
                  <CardTitle className="text-300">
                    <Link to={`/ideas/${idea.ideaId}/evaluation`}>{idea.title}</Link>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <ScoreDisplay value={idea.compositeScore} size="md" />
                  <p className="text-100 text-muted-foreground">
                    {idea.rank === null ? "Not on the current board" : `Rank #${idea.rank}`}
                  </p>
                  <p className="text-100 text-muted-foreground">
                    {MATURITY_LABEL[idea.maturityLevel] ?? `Level ${idea.maturityLevel}`}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader><CardTitle>Where they differ</CardTitle></CardHeader>
            <CardContent className="p-0">
              {query.data.divergentCriteria.length === 0 ? (
                <p className="p-6 text-200 text-muted-foreground">
                  These ideas scored identically on every criterion. Whatever separates
                  them is not something the engine measures.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Criterion</TableHead>
                        {query.data.ideas.map((idea) => (
                          <TableHead key={idea.ideaId} className="text-right">
                            {idea.title}
                          </TableHead>
                        ))}
                        <TableHead className="text-right">Gap</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {/* Widest gap first: the top row is what the decision is about. */}
                      {query.data.divergentCriteria.map((d) => (
                        <TableRow key={d.criterionKey}>
                          <TableCell>
                            <Link to={`/config/criteria#${d.criterionKey}`}>{d.criterionLabel}</Link>
                          </TableCell>
                          {query.data.ideas.map((idea) => {
                            const cell = d.byIdea.find((b) => b.ideaId === idea.ideaId);
                            return (
                              <TableCell key={idea.ideaId} className="text-right tabular-nums">
                                {cell ? cell.normalized.toFixed(1) : "—"}
                              </TableCell>
                            );
                          })}
                          <TableCell className="text-right tabular-nums font-medium">
                            {d.spread.toFixed(1)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <p className="text-100 text-muted-foreground">
            Scored under the {query.data.run.profileName} profile. Weights are on{" "}
            <Link to="/config/profiles">the profiles page</Link>; changing profile changes
            what matters, and can change the order.
          </p>
        </div>
      )}
    </main>
  );
}

import * as React from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { GitCompare } from "lucide-react";
import {
  Button, Card, CardContent, CardHeader, CardTitle, Checkbox, EmptyState, ErrorState,
  ScoreDisplay, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@iep/ui";
import { MATURITY_LABEL } from "../evaluation/api";
import { useCompare, useRankings } from "./api";
import { PageHeading } from "../../app/PageHero";

const link = ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
  <Link to={to} className={className}>{children}</Link>
);

/**
 * Pick two to four ranked ideas, then compare them — without a detour through Rankings.
 *
 * The only way onto this page used to be a checkbox on the Rankings list; landing here
 * directly (a bookmark, a link with no `ids`) was a dead end pointing you back there.
 * Scoped to the top 25 by design: comparing something ranked #80 against the leader is
 * rarely the decision anyone is actually making, and a picker searching the whole board
 * would need its own search box and pagination for a feature this page doesn't otherwise
 * need.
 */
function IdeaPicker() {
  const navigate = useNavigate();
  const [selected, setSelected] = React.useState<readonly string[]>([]);
  const query = useRankings({ page: 1, rankBand: "top25" });

  const toggle = (ideaId: string, on: boolean) =>
    setSelected((prev) => {
      const kept = prev.filter((id) => id !== ideaId);
      return on ? [...kept, ideaId] : kept;
    });

  if (query.isPending) return <Skeleton className="mt-6 h-72 w-full" aria-busy="true" />;
  if (query.isError || query.data.items.length === 0) return null;

  return (
    <div className="mt-6">
      <ul className="list-none space-y-2 p-0">
        {query.data.items.map((row) => {
          const on = selected.includes(row.ideaId);
          return (
            <li key={row.ideaId}>
              <label className="flex cursor-pointer items-center gap-3 rounded-xl bg-card p-3 shadow-e1 ring-1 ring-inset ring-border transition-shadow hover:shadow-e2">
                <Checkbox
                  checked={on}
                  onCheckedChange={(checked) => toggle(row.ideaId, checked === true)}
                  disabled={!on && selected.length >= 4}
                  aria-label={`Select ${row.title} for comparison`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{row.title}</span>
                  <span className="text-100 text-muted-foreground">
                    Rank #{row.rank} · {row.compositeScore.toFixed(1)}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      <div className="mt-4 flex items-center gap-3">
        <Button
          disabled={selected.length < 2}
          onClick={() => navigate(`/rankings/compare?${selected.map((id) => `ids=${id}`).join("&")}`)}
        >
          Compare {selected.length > 0 ? selected.length : ""} selected
        </Button>
        <p className="text-100 text-muted-foreground">
          {selected.length < 2
            ? "Pick at least two."
            : selected.length >= 4
              ? "That's the most this table can hold at once."
              : `${4 - selected.length} more allowed.`}
        </p>
      </div>
    </div>
  );
}

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
        <PageHeading icon={GitCompare} heading="Compare ideas" />
        <EmptyState
          title="Pick two to four ideas"
          description="Two is the minimum for a comparison to say anything; above four the table stops being readable. Check them below, or from the Rankings list itself."
          action={{ label: "Go to the rankings", to: "/rankings" }}
          renderLink={link}
        />
        <IdeaPicker />
      </main>
    );
  }

  return (
    <main className="page">
      <nav aria-label="Breadcrumb" className="crumbs">
        <Link to="/rankings">Rankings</Link>  ›  Compare
      </nav>
      <PageHeading
        icon={GitCompare}
        heading={`Comparing ${ids.length} ideas`}
        description="The table below leads with where they disagree — that's what a decision actually turns on."
      />

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

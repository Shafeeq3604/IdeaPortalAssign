import * as React from "react";
import { Link } from "react-router-dom";
import { Button, Card, CardContent, ErrorState, Input, Label, Skeleton } from "@iep/ui";
import { useDashboard, useProfiles, useRecompute } from "./api";

const link = ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
  <Link to={to} className={className}>{children}</Link>
);

/**
 * Management dashboard (P7 — FR-26, SPEC §9.9).
 *
 * Every tile is a link, and the destination comes from the API rather than being
 * assembled here (SPEC §6.2 row 40). That is deliberate: a count whose "see them" link
 * is built client-side drifts from the filter the count was computed with, and the two
 * quietly stop agreeing.
 */
export function DashboardPage() {
  return (
    <main className="page">
      <nav aria-label="Breadcrumb" className="crumbs">
        <Link to="/ideas">Ideas</Link>  ›  Dashboard
      </nav>
      <h1>Dashboard</h1>
      <Tiles />
      <RecomputePanel />
    </main>
  );
}

function Tiles() {
  const query = useDashboard();

  if (query.isPending) {
    return (
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
    );
  }

  if (query.isError) {
    return (
      <ErrorState
        title="Could not load the dashboard"
        description="The underlying data is fine — this is the summary failing to load."
        onRetry={() => void query.refetch()}
        escapeTo={{ label: "Back to ideas", to: "/ideas" }}
        renderLink={link}
      />
    );
  }

  return (
    <>
      {GROUPS.map((group) => {
        const tiles = query.data.tiles.filter((t) => group.keys.includes(t.key));
        if (tiles.length === 0) return null;

        return (
          <section key={group.title} className="mt-8 first:mt-6">
            <h2 className="text-100 font-medium uppercase tracking-widest text-muted-foreground">
              {group.title}
            </h2>
            <p className="mt-1 text-200 text-muted-foreground">{group.note}</p>

            <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {tiles.map((tile) => (
                <Card key={tile.key} className={tile.count === 0 ? "border-dashed" : undefined}>
                  <CardContent className="pt-6">
                    {/* The whole tile is the link — a count you cannot click is a dead
                        end wearing a number (SPEC §6.3). */}
                    <Link to={tile.href} className="block">
                      <span
                        className={
                          // A zero should not shout as loudly as a real number. Nine tiles
                          // at equal weight, six of them zero, is a wall of noughts with
                          // the three counts that matter hidden inside it.
                          tile.count === 0
                            ? "block text-700 font-semibold tabular-nums text-muted-foreground"
                            : "block text-700 font-semibold tabular-nums text-primary"
                        }
                      >
                        {tile.count}
                      </span>
                      <span className="block text-200">{tile.label}</span>
                    </Link>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        );
      })}

      <p className="mt-4 text-100 text-muted-foreground">
        As of {new Date(query.data.generatedAt).toLocaleString()}. Every tile leads to the
        list it counted.
      </p>
    </>
  );
}

/**
 * The nine counts of requirements.md §29, in two groups.
 *
 * All nine are still here and still links — the requirement is the count, not the layout.
 * What changed is that they no longer sit in one undifferentiated grid where a zero has
 * the same weight as a real number.
 *
 * The split is honest rather than cosmetic: the first group is the pipeline this product
 * runs today, and the second is outcome tracking, which lands in P15 and P16. Those tiles
 * read zero because nothing writes to them yet, and grouping them says so instead of
 * leaving a manager to wonder why nothing has ever been piloted.
 *
 * Grouped by KEY, not by index. A tile added to the API without a group here simply does
 * not render, which is a visible omission rather than a silently mis-grouped count.
 */
const GROUPS: readonly { title: string; note: string; keys: readonly string[] }[] = [
  {
    title: "The pipeline",
    note: "Where ideas are right now.",
    keys: ["total", "new", "under_evaluation", "requiring_review", "top_ranked"],
  },
  {
    title: "Outcomes",
    note: "What happened after a decision. Tracking for these lands in a later phase, so they read zero.",
    keys: ["prototype", "pilot", "implemented", "parked"],
  },
];

/**
 * Recompute (FR-13, ADR-008).
 *
 * A reason is required and is stored on the run, so a board that surprises someone can
 * be traced to the decision that produced it. Recompute makes no provider call — it is
 * arithmetic over stored evaluations — which is why it is safe to expose as a button.
 */
function RecomputePanel() {
  const profiles = useProfiles();
  const recompute = useRecompute();
  const [profileKey, setProfileKey] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [touched, setTouched] = React.useState(false);

  const options = profiles.data?.items ?? [];
  const active = profileKey || options.find((p) => p.isDefault)?.key || options[0]?.key || "";
  const reasonMissing = reason.trim().length === 0;

  if (options.length === 0) return null;

  return (
    <Card className="mt-8">
      <CardContent className="pt-6">
        <h2 className="text-400 font-medium">Recompute the rankings</h2>
        <p className="mt-1 text-200 text-muted-foreground">
          Creates a new snapshot from the scores as they stand now. The previous run stays
          readable, so you can always show what the board said before.
        </p>

        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            setTouched(true);
            if (reasonMissing) return;
            recompute.mutate({ profileKey: active, reason: reason.trim() });
          }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-200 text-muted-foreground">Profile</span>
            {options.map((p) => (
              <Button
                key={p.key}
                type="button"
                size="sm"
                variant={p.key === active ? "default" : "outline"}
                onClick={() => setProfileKey(p.key)}
              >
                {p.name}
              </Button>
            ))}
          </div>

          <div>
            <Label htmlFor="field-recomputeReason">Why (required)</Label>
            <Input
              id="field-recomputeReason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. quarterly review board"
              aria-invalid={touched && reasonMissing}
              aria-describedby={touched && reasonMissing ? "error-recomputeReason" : undefined}
            />
            {touched && reasonMissing ? (
              <p id="error-recomputeReason" role="alert" className="mt-1 text-100 text-destructive">
                The reason is stored on the run and shown on the board. Say why.
              </p>
            ) : null}
          </div>

          {recompute.isError ? (
            <p role="alert" className="text-100 text-destructive">
              The recompute did not run. The current board is unchanged.
            </p>
          ) : null}
          {recompute.isSuccess ? (
            <p role="status" className="text-100 text-factor-up">
              Done — {recompute.data.cohortSize} ideas ranked.{" "}
              <Link to="/rankings">See the new board</Link>.
            </p>
          ) : null}

          <Button type="submit" disabled={recompute.isPending}>
            {recompute.isPending ? "Recomputing…" : "Recompute"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

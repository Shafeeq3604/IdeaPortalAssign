import * as React from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  Badge, Button, Card, CardContent, Checkbox, EmptyState, ErrorState, RankBadge,
  ScoreDisplay, Skeleton, StatusPill,
} from "@iep/ui";
import type { ListRankingsResponse } from "@iep/contracts";
import { FEASIBILITY_LABEL } from "../analysis/api";
import { MATURITY_LABEL } from "../evaluation/api";
import { useProfiles, useRankingRun, useRankings } from "./api";

const link = ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
  <Link to={to} className={className}>{children}</Link>
);

/**
 * The ranked board (P7 — FR-26, SPEC §9.9).
 *
 * Two rules shape it:
 *
 *  - **Every row explains itself.** Rank, score, top strength and top constraint are all
 *    on the row. A bare ordered list is exactly what P-2 forbids, and "click through to
 *    find out why" is the version of this screen that erodes trust fastest.
 *  - **Profile and filters live in the URL** (SPEC §7.8), so a board is shareable and
 *    Back restores what you were looking at.
 */
export function RankingsPage({ mode = "current" }: { mode?: "current" | "run" }) {
  const { runId = "" } = useParams();
  const [params, setParams] = useSearchParams();

  const page = Math.max(1, Number(params.get("page") ?? 1));
  const profile = params.get("profile") ?? undefined;
  const rankBand = params.get("rankBand") ?? "all";
  const selected = params.getAll("compare");

  const profiles = useProfiles();
  const current = useRankings({ page, profile, rankBand });
  const historic = useRankingRun(runId);
  const query = mode === "run" ? historic : current;

  const update = (mutate: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(params);
    mutate(next);
    setParams(next);
  };

  const toggleCompare = (ideaId: string, on: boolean) =>
    update((next) => {
      const kept = next.getAll("compare").filter((id) => id !== ideaId);
      next.delete("compare");
      for (const id of on ? [...kept, ideaId] : kept) next.append("compare", id);
    });

  return (
    <main className="page">
      <nav aria-label="Breadcrumb" className="crumbs">
        <Link to="/ideas">Ideas</Link>  ›  {mode === "run" ? "A past ranking" : "Rankings"}
      </nav>
      <h1>{mode === "run" ? "Ranking run" : "Rankings"}</h1>

      {query.isPending ? (
        <Skeleton className="mt-6 h-96 w-full" aria-busy="true" />
      ) : query.isError ? (
        <ErrorState
          title="Could not load the rankings"
          description="Nothing has been lost — this is the board failing to load."
          onRetry={() => void query.refetch()}
          escapeTo={{ label: "Back to ideas", to: "/ideas" }}
          renderLink={link}
        />
      ) : (
        <Board
          data={query.data}
          mode={mode}
          profiles={profiles.data?.items ?? []}
          activeProfile={query.data.run.profileKey}
          rankBand={rankBand}
          selected={selected}
          onProfile={(key) => update((next) => { next.set("profile", key); next.delete("page"); })}
          onRankBand={(band) => update((next) => { next.set("rankBand", band); next.delete("page"); })}
          onToggleCompare={toggleCompare}
          onPage={(n) => update((next) => next.set("page", String(n)))}
        />
      )}
    </main>
  );
}

function Board({
  data, mode, profiles, activeProfile, rankBand, selected,
  onProfile, onRankBand, onToggleCompare, onPage,
}: {
  data: ListRankingsResponse;
  mode: "current" | "run";
  profiles: readonly { key: string; name: string }[];
  activeProfile: string;
  rankBand: string;
  selected: readonly string[];
  onProfile: (key: string) => void;
  onRankBand: (band: string) => void;
  onToggleCompare: (ideaId: string, on: boolean) => void;
  onPage: (page: number) => void;
}) {
  /**
   * The empty case replaces the LIST, not the page.
   *
   * Returning early here was a dead end: switching to a profile with no ranking run
   * removed the profile selector along with the rows, so the only way back was the
   * browser button. The controls that got you into a state have to survive it
   * (SPEC §6.3 assertion 3). The J-3 journey caught this.
   */
  const empty = data.items.length === 0;

  return (
    <>
      <div className="mb-4 space-y-3">
        {mode === "current" && profiles.length > 1 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-200 text-muted-foreground">Weighted for</span>
            {profiles.map((p) => (
              <Button
                key={p.key}
                size="sm"
                variant={p.key === activeProfile ? "default" : "outline"}
                onClick={() => onProfile(p.key)}
              >
                {p.name}
              </Button>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-200 text-muted-foreground">Show</span>
          {(["top10", "top25", "top50", "all"] as const).map((band) => (
            <Button
              key={band}
              size="sm"
              variant={band === rankBand ? "default" : "outline"}
              onClick={() => onRankBand(band)}
            >
              {band === "all" ? "Everything" : `Top ${band.replace("top", "")}`}
            </Button>
          ))}
        </div>

        {selected.length >= 2 ? (
          <p className="text-200">
            <Link to={`/rankings/compare?${selected.map((id) => `ids=${id}`).join("&")}`}>
              Compare {selected.length} selected ideas
            </Link>
          </p>
        ) : selected.length === 1 ? (
          <p className="text-100 text-muted-foreground">Select one more to compare.</p>
        ) : null}
      </div>

      {empty ? (
        <EmptyState
          title="No ranked ideas here"
          description={
            data.run.cohortSize === 0
              ? "Nothing has been evaluated under this profile yet. Ideas appear once their analysis finishes — the controls above still work."
              : "No idea matches these filters. Widen them, or switch profile, using the controls above."
          }
          action={{ label: "Browse all ideas", to: "/ideas" }}
          renderLink={link}
        />
      ) : null}

      <ol className="space-y-3">
        {data.items.map((row) => (
          <li key={row.ideaId}>
            {/* settle-rank's FLIP reorder is not implemented; the delta chip and the
                afterglow it pairs with are. Called out rather than faked — SPEC §8.3
                describes a motion this board does not yet perform. */}
            <Card>
              <CardContent className="space-y-3 pt-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <RankBadge
                        rank={row.rank}
                        previousRank={row.previousRank}
                        total={data.run.cohortSize}
                      />
                    </div>
                    <h2 className="mt-1 text-400 font-medium">
                      <Link to={`/ideas/${row.ideaId}/evaluation`}>{row.title}</Link>
                    </h2>
                    <p className="text-100 text-muted-foreground">
                      <Link to={`/people/${row.submitter.id}`}>{row.submitter.displayName}</Link>
                      {row.department ? ` · ${row.department}` : ""}
                    </p>
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    <ScoreDisplay value={row.compositeScore} size="sm" />
                    <label className="flex items-center gap-2 text-100 text-muted-foreground">
                      <Checkbox
                        checked={selected.includes(row.ideaId)}
                        onCheckedChange={(on) => onToggleCompare(row.ideaId, on === true)}
                        aria-label={`Select ${row.title} for comparison`}
                      />
                      Compare
                    </label>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {row.feasibilityStatus ? (
                    <StatusPill
                      kind="FEASIBILITY"
                      feasibility={row.feasibilityStatus as never}
                      label={
                        FEASIBILITY_LABEL[row.feasibilityStatus as keyof typeof FEASIBILITY_LABEL] ??
                        row.feasibilityStatus
                      }
                    />
                  ) : null}
                  <Badge variant="outline">
                    {MATURITY_LABEL[row.maturityLevel]?.split(" — ")[0] ?? `Level ${row.maturityLevel}`}
                  </Badge>
                </div>

                {/* P-2 on the board itself: why this row is here, without a click. */}
                <dl className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <dt className="text-100 font-medium text-factor-up">Strongest</dt>
                    <dd className="text-200">
                      {row.topStrength
                        ? `${row.topStrength.criterionLabel} — ${row.topStrength.text}`
                        : "No criterion stood out."}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-100 font-medium text-factor-down">Weakest</dt>
                    <dd className="text-200">
                      {row.topConstraint
                        ? `${row.topConstraint.criterionLabel} — ${row.topConstraint.text}`
                        : "Nothing held it back notably."}
                    </dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
          </li>
        ))}
      </ol>

      <p className="mt-4 text-100 text-muted-foreground">
        {mode === "run" ? "This run was" : "Current board, "} computed{" "}
        {new Date(data.run.computedAt).toLocaleString()} under the {data.run.profileName}{" "}
        profile, engine {data.run.engineVersion}. Reason: {data.run.triggerReason}.
        {" "}
        <Link to="/config/profiles">See how this profile is weighted</Link>.
      </p>

      {data.meta.totalPages > 1 ? (
        <p className="mt-3 text-200 text-muted-foreground">
          Page {data.meta.page} of {data.meta.totalPages}
          {data.meta.page > 1 ? (
            <>
              {" · "}
              <Button variant="link" size="sm" onClick={() => onPage(data.meta.page - 1)}>
                Previous
              </Button>
            </>
          ) : null}
          {data.meta.page < data.meta.totalPages ? (
            <>
              {" · "}
              <Button variant="link" size="sm" onClick={() => onPage(data.meta.page + 1)}>
                Next
              </Button>
            </>
          ) : null}
        </p>
      ) : null}
    </>
  );
}

import * as React from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Trophy } from "lucide-react";
import { Button, Checkbox, EmptyState, ErrorState, Skeleton, StatusPill } from "@iep/ui";
import type { ExplanationItem, ListRankingsResponse, RankingEntry } from "@iep/contracts";
import { FEASIBILITY_LABEL } from "../analysis/api";
import { useProfiles, useRankingRun, useRankings } from "./api";
import { RankDelta } from "./DashboardHero";

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

/**
 * One line of "why this rank", as figures rather than a sentence.
 *
 * The engine writes a full sentence per factor and the board printed it whole:
 * "Business impact — Business impact scored 88 of 100 and carries 18% of this profile,
 * adding 15.8 points." Eighteen rows of that is nine hundred words of near-identical
 * prose with the criterion name in it twice, and a reader gives up on it by row three —
 * which defeats P-2 more thoroughly than showing less does.
 *
 * Every number here is the same number, from the same fields. The sentence is still the
 * accessible name and the tooltip, and still appears in full on the Evaluation tab,
 * which is the surface with room for it.
 */
function Factor({ kind, item }: { kind: "up" | "down"; item: ExplanationItem | null }) {
  const up = kind === "up";
  const tone = up ? "text-factor-up" : "text-factor-down";

  /**
   * A run computed before the engine recorded these figures.
   *
   * The numbers do not exist in that snapshot and never will — a ranking run is immutable
   * (ADR-008), so there is nothing to back-fill and nothing to migrate. The sentence it
   * DID record is shown in full instead, which is exactly what the board used to show.
   */
  const hasFigures = item !== null && item.normalized !== undefined && item.headroom !== undefined;

  return (
    <div>
      <dt
        className={`text-100 font-medium uppercase tracking-wider ${
          item ? tone : "text-muted-foreground"
        }`}
      >
        {up ? "Strongest" : "Weakest"}
      </dt>

      {item === null ? (
        <dd className="text-200 text-muted-foreground">
          {up ? "No criterion stood out." : "Nothing held it back."}
        </dd>
      ) : hasFigures ? (
        <dd className="flex flex-wrap items-baseline gap-x-2 text-200" title={item.text}>
          <span className="font-medium">{item.criterionLabel}</span>
          <span className="tabular-nums text-muted-foreground">{item.normalized}/100</span>
          <span className={`tabular-nums font-medium ${tone}`}>
            {up
              ? `+${item.contribution.toFixed(1)} pts`
              // `hasFigures` above already guarantees this is defined; `?? 0` says so
              // without a non-null assertion the type checker cannot itself verify.
              : `${(item.headroom ?? 0).toFixed(1)} pts available`}
          </span>
          {/* Nothing is lost to a screen reader — it reads the engine's own sentence. */}
          <span className="sr-only">{item.text}</span>
        </dd>
      ) : (
        <dd className="text-200">
          <span className="font-medium">{item.criterionLabel}</span> — {item.text}
        </dd>
      )}
    </div>
  );
}

/**
 * The top three (Idea Platform Redesign — "podium").
 *
 * Rank 1 gets the brand gradient and grows; 2 and 3 stay on the surface. That is a real
 * hierarchy rather than three identical cards with different numerals on them, and it is
 * the single change that makes this screen read as a BOARD.
 *
 * P-2 survives the promotion: the leader still shows its strongest and weakest criteria
 * as chips, so the biggest, most persuasive card on the page is still the one that most
 * clearly says why. A podium without that is exactly the "bare ordered list" the product
 * principle forbids, dressed up.
 */
function PodiumCard({
  row,
  total,
  selected,
  onToggleCompare,
}: {
  row: RankingEntry;
  total: number;
  selected: boolean;
  onToggleCompare: (ideaId: string, on: boolean) => void;
}) {
  const first = row.rank === 1;

  /** The bar is the composite as a proportion of 100 — presentational, hence aria-hidden. */
  const width = `${Math.max(2, Math.min(100, row.compositeScore))}%`;

  return (
    <div
      className={
        first
          ? "board-crown motion-defer relative overflow-hidden rounded-2xl p-6 text-grad-ink shadow-e4"
          : "relative overflow-hidden rounded-2xl bg-card p-5 shadow-e2 ring-1 ring-inset ring-border"
      }
    >
      {first ? null : (
        <span
          aria-hidden
          className={`absolute inset-x-0 top-0 h-1.5 ${row.rank === 2 ? "bg-ramp-3" : "bg-ramp-2"}`}
        />
      )}

      <div className="relative flex items-center justify-between gap-3">
        {first ? (
          <span className="inline-flex items-center gap-2">
            <span className="grid size-9 place-items-center rounded-xl bg-grad-highlight/20 text-grad-highlight">
              <Trophy aria-hidden className="size-4.5" />
            </span>
            <span className="font-serif text-600 font-bold leading-none">1</span>
          </span>
        ) : (
          <span className="font-serif text-600 font-bold leading-none text-ramp-4">{row.rank}</span>
        )}
        <RankDelta rank={row.rank} previousRank={row.previousRank} onBrand={first} />
      </div>

      <h2
        className={`relative mt-3.5 font-semibold leading-snug ${first ? "text-400" : "text-300"}`}
      >
        <Link
          to={`/ideas/${row.ideaId}/evaluation`}
          className={first ? "text-grad-ink no-underline hover:underline" : ""}
        >
          {row.title}
        </Link>
      </h2>

      <p className={`relative mt-1.5 text-100 ${first ? "text-grad-ink-soft" : "text-muted-foreground"}`}>
        <Link
          to={`/people/${row.submitter.id}`}
          className={first ? "text-grad-ink-soft no-underline hover:underline" : ""}
        >
          {row.submitter.displayName}
        </Link>
        {row.department ? ` · ${row.department}` : ""}
      </p>

      <p
        className={`relative mt-3.5 font-serif font-bold leading-none tabular-nums ${
          first ? "text-800 text-grad-highlight" : "text-600 text-accent-700"
        }`}
      >
        {row.compositeScore.toFixed(1)}
        <span className="sr-only">
          {" "}
          out of 100, ranked {row.rank} of {total}
        </span>
      </p>

      <div
        aria-hidden
        className={`relative mt-2.5 h-1.5 overflow-hidden rounded-full ${first ? "bg-grad-ink/20" : "bg-ramp-1"}`}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-[var(--dur-settle)] ease-[var(--ease-out-quint)] ${
            first ? "bg-grad-highlight" : row.rank === 2 ? "bg-ramp-4" : "bg-ramp-3"
          }`}
          style={{ width }}
        />
      </div>

      {/*
        P-2 on the podium. The leader wears its two figures as chips because it has the
        room; 2 and 3 keep the same `Factor` treatment as every row below them, so the
        explanation is never the thing that got dropped to make a card look tidy.
      */}
      {first ? (
        <div className="relative mt-3.5 flex flex-wrap gap-2">
          {row.topStrength ? (
            <span className="inline-flex items-center rounded-full bg-grad-ink/15 px-2.5 py-1 text-100 font-bold ring-1 ring-grad-rule">
              {row.topStrength.criterionLabel} +{row.topStrength.contribution.toFixed(1)}
            </span>
          ) : null}
          {row.topConstraint?.headroom === undefined ? null : (
            <span className="inline-flex items-center rounded-full bg-grad-ink/15 px-2.5 py-1 text-100 font-bold ring-1 ring-grad-rule">
              {row.topConstraint.criterionLabel} −{row.topConstraint.headroom.toFixed(1)}
            </span>
          )}
        </div>
      ) : (
        <dl className="mt-3 grid gap-1">
          <Factor kind="up" item={row.topStrength} />
          <Factor kind="down" item={row.topConstraint} />
        </dl>
      )}

      {row.feasibilityStatus ? (
        <div className="relative mt-3">
          {first ? (
            <span className="inline-flex items-center rounded-full bg-grad-ink/15 px-2.5 py-1 text-100 font-semibold ring-1 ring-grad-rule">
              {FEASIBILITY_LABEL[row.feasibilityStatus as keyof typeof FEASIBILITY_LABEL] ??
                row.feasibilityStatus}
            </span>
          ) : (
            <StatusPill
              kind="FEASIBILITY"
              feasibility={row.feasibilityStatus as never}
              label={
                FEASIBILITY_LABEL[row.feasibilityStatus as keyof typeof FEASIBILITY_LABEL] ??
                row.feasibilityStatus
              }
            />
          )}
        </div>
      ) : null}

      {/* Compare has to reach the top three too — a comparison that cannot include the
          leader is not a comparison anybody wanted (J-3 selects the top of the board). */}
      <label
        className={`relative mt-3.5 flex items-center gap-2 text-100 ${
          first ? "text-grad-ink-soft" : "text-muted-foreground"
        }`}
      >
        <Checkbox
          checked={selected}
          onCheckedChange={(on) => onToggleCompare(row.ideaId, on === true)}
          aria-label={`Select ${row.title} for comparison`}
          className={first ? "border-grad-rule data-[state=checked]:bg-grad-highlight" : ""}
        />
        Compare
      </label>
    </div>
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

  const podium = data.items.filter((row) => row.rank <= 3);
  const rest = data.items.filter((row) => row.rank > 3);

  return (
    <>
      {/*
        Pills, and the active one carries the brand gradient (Idea Platform Redesign —
        "The board"). `brand-pill` rather than the accent for the reason recorded in
        index.css: white on --accent-700 fails AA once the tokens flip to dark, and these
        are the most-clicked controls on the page.
      */}
      <div className="mb-4 space-y-3">
        {mode === "current" && profiles.length > 1 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-200 text-muted-foreground">Weighted for</span>
            {profiles.map((p) => (
              <Button
                key={p.key}
                size="sm"
                variant="ghost"
                aria-pressed={p.key === activeProfile}
                className={
                  p.key === activeProfile
                    ? "brand-pill rounded-full font-semibold text-grad-ink hover:text-grad-ink"
                    : "rounded-full bg-card font-medium ring-1 ring-inset ring-border"
                }
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
              variant="ghost"
              aria-pressed={band === rankBand}
              className={
                band === rankBand
                  ? "brand-pill rounded-full font-semibold text-grad-ink hover:text-grad-ink"
                  : "rounded-full bg-card font-medium ring-1 ring-inset ring-border"
              }
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

      {/*
        The top three get a podium; everything else gets a row (Idea Platform Redesign —
        "The board").

        Split by the RANK, not by position in the array. A filtered or second-page view
        contains no rank 1, so it correctly gets no podium rather than crowning whatever
        happens to be first on screen — which is the bug this shape invites.
      */}
      {podium.length > 0 ? (
        <ol className="grid list-none grid-cols-1 items-end gap-3.5 p-0 md:grid-cols-3">
          {podium.map((row) => (
            <li
              key={row.ideaId}
              /* Order 2 · 1 · 3 on a real podium; source order stays 1 · 2 · 3 so a screen
                 reader and the keyboard get the board in rank order. */
              className={row.rank === 1 ? "md:order-2" : row.rank === 2 ? "md:order-1" : "md:order-3"}
            >
              <PodiumCard
                row={row}
                total={data.run.cohortSize}
                selected={selected.includes(row.ideaId)}
                onToggleCompare={onToggleCompare}
              />
            </li>
          ))}
        </ol>
      ) : null}

      <ol className={`list-none space-y-2.5 p-0 ${podium.length > 0 ? "mt-4" : ""}`}>
        {rest.map((row) => (
          <li key={row.ideaId}>
            {/* settle-rank's FLIP reorder is not implemented; the delta chip and the
                afterglow it pairs with are. Called out rather than faked — SPEC §8.3
                describes a motion this board does not yet perform. */}
            <div className="grid grid-cols-[3.25rem_minmax(0,1fr)] items-center gap-x-4 gap-y-3 rounded-2xl bg-card p-4 shadow-e1 ring-1 ring-inset ring-border transition-shadow duration-[var(--dur-base)] hover:shadow-e2 lg:grid-cols-[3.25rem_minmax(0,1fr)_auto]">
              <span className="grid size-11 place-items-center rounded-xl bg-accent-050 font-serif text-400 font-bold tabular-nums text-accent-700 ring-1 ring-inset ring-ramp-2">
                {row.rank}
              </span>

              <div className="min-w-0">
                <h2 className="text-300 font-semibold leading-snug">
                  <Link to={`/ideas/${row.ideaId}/evaluation`}>{row.title}</Link>
                </h2>
                <p className="mt-0.5 text-100 text-muted-foreground">
                  <Link to={`/people/${row.submitter.id}`}>{row.submitter.displayName}</Link>
                  {row.department ? ` · ${row.department}` : ""}
                  {row.feasibilityStatus ? (
                    <>
                      {" · "}
                      <span className="font-semibold text-factor-up">
                        {FEASIBILITY_LABEL[
                          row.feasibilityStatus as keyof typeof FEASIBILITY_LABEL
                        ] ?? row.feasibilityStatus}
                      </span>
                    </>
                  ) : null}
                </p>

                {/*
                  P-2 on the row itself: why this idea is here, without a click.

                  The canvas draws a five-segment bar labelled "impact · effort · adoption ·
                  cost · headroom". `RankingEntry` carries two explanation items, not five —
                  the top strength and the top constraint — so three of those segments would
                  be lengths nothing computed. The two real figures are shown as figures.
                  Widening the contract to carry every criterion's contribution is additive
                  and would let the full bar be drawn honestly; that is an API decision, not
                  one to make silently here.
                */}
                <dl className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
                  <Factor kind="up" item={row.topStrength} />
                  <Factor kind="down" item={row.topConstraint} />
                </dl>
              </div>

              <div className="col-start-2 flex items-center justify-between gap-4 lg:col-start-3 lg:flex-col lg:items-end lg:gap-2">
                <div className="text-right">
                  <p className="font-serif text-500 font-bold leading-none tabular-nums text-accent-700">
                    {row.compositeScore.toFixed(1)}
                  </p>
                  <span className="sr-only">
                    out of 100, ranked {row.rank} of {data.run.cohortSize}
                  </span>
                  <div className="mt-1.5 flex justify-end">
                    <RankDelta rank={row.rank} previousRank={row.previousRank} />
                  </div>
                </div>

                <label className="flex shrink-0 items-center gap-2 text-100 text-muted-foreground">
                  <Checkbox
                    checked={selected.includes(row.ideaId)}
                    onCheckedChange={(on) => onToggleCompare(row.ideaId, on === true)}
                    aria-label={`Select ${row.title} for comparison`}
                  />
                  Compare
                </label>
              </div>
            </div>
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

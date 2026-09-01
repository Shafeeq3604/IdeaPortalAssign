import * as React from "react";
import { Link } from "react-router-dom";
import { Button, Card, CardContent, ErrorState, Input, Label, Skeleton } from "@iep/ui";
import type { DashboardResponse, ListRankingsResponse } from "@iep/contracts";
import { useDashboard, useProfiles, useRankings, useRecompute } from "./api";
import { DashboardHero, Spotlight } from "./DashboardHero";

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

  /**
   * The board, for the hero and the spotlight.
   *
   * Read here rather than inside the hero so there is ONE query for the page: the hero,
   * the spotlight and the tiles all describe the same run, and two independent fetches
   * could describe two different ones a second apart.
   *
   * Declared with the other hook, ABOVE the early returns. Hooks run in the same order
   * on every render or React loses track of which state belongs to which call.
   */
  const board = useRankings({ page: 1, rankBand: "all" });

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
      <DashboardHero data={query.data} board={board.data} />

      <PipelineTiles tiles={query.data.tiles} board={board.data} />

      <Spotlight board={board.data} />

      <OutcomeTrack tiles={query.data.tiles} />

      <p className="mt-6 text-100 text-muted-foreground">
        As of {new Date(query.data.generatedAt).toLocaleString()}. Every tile leads to the
        list it counted.
      </p>
    </>
  );
}

/*
 * The nine counts of requirements.md §29, in two sections.
 *
 * All nine are still here and still links — the requirement is the count, not the layout.
 * What changed is that they no longer sit in one undifferentiated grid where a zero has
 * the same weight as a real number.
 *
 * The split is honest rather than cosmetic: the first section is the pipeline this product
 * runs today, and the second is outcome tracking, which lands in P15 and P16. Those counts
 * read zero because nothing writes to them yet, and saying so is better than leaving a
 * manager to wonder why nothing has ever been piloted.
 *
 * Both are keyed by the API's tile KEY, not by index. A tile added to the API without an
 * entry here simply does not render, which is a visible omission rather than a silently
 * mis-grouped count.
 */

/* ══════════════════════════════════════════════════════════════════
 * The pipeline (Idea Platform Redesign — "pipeline tiles")
 * ══════════════════════════════════════════════════════════════════ */

/**
 * A tone and a short eyebrow per stage.
 *
 * The canvas gives each of the five its own tinted surface, which is what turns a row of
 * five identical accent boxes into five places. The tones are the tokens' own semantic
 * pairs — info for what has just arrived, the accent ramp for what the pipeline is still
 * working through, warn for what is waiting on a person, the brand gradient for the board.
 *
 * `eyebrow` is the canvas's short form and is decoration: the API's own `label` is still
 * rendered underneath and is still what the link is announced as ("8 Total ideas"),
 * because a screen reader hearing "Total · 8 · ideas in play" has been given a puzzle.
 *
 * Keyed by the API's tile key, so a renamed or added tile fails visibly rather than
 * getting a default treatment nobody chose.
 */
const PIPELINE: readonly {
  key: string;
  eyebrow: string;
  surface: string;
  ink: string;
  rule: string;
}[] = [
  { key: "total", eyebrow: "Total", surface: "bg-accent-050 ring-1 ring-inset ring-ramp-2",
    ink: "text-accent-foreground", rule: "bg-gradient-to-r from-ramp-3 to-ramp-5" },
  { key: "new", eyebrow: "New", surface: "bg-state-info-bg ring-1 ring-inset ring-state-info/25",
    ink: "text-state-info", rule: "bg-state-info" },
  /*
   * NOT the `ai-*` palette, though the canvas paints this tile violet.
   *
   * `tests/arch/provenance.test.ts` reserves the AI provenance tokens for <Provenance>,
   * so the treatment means exactly one thing: this content came out of a model. A count of
   * the ideas the pipeline is working on is not model output — it is a number the database
   * computed. Borrowing the palette for "a model is busy" is the first step in it meaning
   * nothing. The pulsing bar below is what carries "in progress".
   */
  { key: "under_evaluation", eyebrow: "Evaluating", surface: "bg-accent-100 ring-1 ring-inset ring-ramp-3",
    ink: "text-accent-700", rule: "bg-ramp-4" },
  { key: "requiring_review", eyebrow: "Needs you", surface: "bg-state-warn-bg ring-1 ring-inset ring-state-warn/25",
    ink: "text-state-warn", rule: "bg-state-warn" },
  { key: "top_ranked", eyebrow: "Top ranked", surface: "board-crown text-grad-ink shadow-e3",
    ink: "text-grad-highlight", rule: "bg-grad-highlight" },
];

function PipelineTiles({
  tiles,
  board,
}: {
  tiles: DashboardResponse["tiles"];
  board: ListRankingsResponse | undefined;
}) {
  const byKey = new Map(tiles.map((t) => [t.key, t]));

  return (
    <section className="mt-8 first:mt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="font-serif text-500 font-semibold">The pipeline</h2>
          <p className="mt-0.5 text-200 text-muted-foreground">
            Where ideas are right now. Every tile leads to the list it counted.
          </p>
        </div>
      </div>

      <div className="mt-3.5 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {PIPELINE.map((stage) => {
          const tile = byKey.get(stage.key);
          if (!tile) return null;
          const live = tile.count > 0;

          return (
            <Link
              key={stage.key}
              to={tile.href}
              /* The whole tile is the link — a count you cannot click is a dead end
                 wearing a number (SPEC §6.3). */
              className={`relative block overflow-hidden rounded-2xl p-4 no-underline transition-all duration-[var(--dur-base)] hover:-translate-y-0.5 hover:shadow-e3 ${
                live ? `${stage.surface} shadow-e2` : "bg-card ring-1 ring-inset ring-border"
              }`}
            >
              <span aria-hidden className={`absolute inset-x-0 top-0 h-1 ${live ? stage.rule : "bg-border"}`} />

              <span
                aria-hidden
                className={`mt-1.5 block text-100 font-bold uppercase tracking-[0.1em] ${
                  live ? stage.ink : "text-muted-foreground"
                }`}
              >
                {stage.eyebrow}
              </span>

              <span
                className={
                  // A zero should not shout as loudly as a real number. Nine tiles at
                  // equal weight, six of them zero, is a wall of noughts with the three
                  // counts that matter hidden inside it.
                  live
                    ? `mt-1.5 block font-serif text-800 font-bold leading-none tabular-nums ${stage.ink}`
                    : "mt-1.5 block font-serif text-700 font-semibold leading-none tabular-nums text-muted-foreground"
                }
              >
                {tile.count}
              </span>

              <span
                className={`mt-1.5 block text-200 ${
                  stage.key === "top_ranked" && live ? "text-grad-ink-soft" : "text-muted-foreground"
                }`}
              >
                {tile.label}
              </span>

              {live ? <Flourish stageKey={stage.key} board={board} /> : null}
            </Link>
          );
        })}
      </div>
    </section>
  );
}

/**
 * The per-tile flourish, where one exists that is telling the truth.
 *
 * The canvas gives all five a graphic: a six-bar sparkline on Total, "+2 this week" on
 * New, a progress bar on Evaluating, an "Open queue" pill on Needs you, and a stack of
 * faces on Top ranked. Three of those are drawn from data this product does not have —
 * nothing stores a weekly history of the cohort, and nothing computes a week-on-week
 * delta. A sparkline of invented figures on a dashboard whose whole claim is that its
 * numbers are explained is the single worst thing this screen could ship, so the two that
 * cannot be sourced are simply absent.
 *
 * The three that remain are real: an indeterminate bar means "a model is working on
 * these", the queue pill is the tile's own destination named, and the faces are the
 * people who actually submitted the ideas on the board.
 */
function Flourish({
  stageKey,
  board,
}: {
  stageKey: string;
  board: ListRankingsResponse | undefined;
}) {
  if (stageKey === "under_evaluation") {
    /* Indeterminate on purpose — it says "running", not "62% done". The pipeline reports
       per-idea progress on the idea's own Analysis tab, which is where a real figure
       lives; a bar here would be a percentage of nothing. */
    return (
      <span aria-hidden className="mt-3 block h-1.5 overflow-hidden rounded-full bg-card">
        <span className="dash-pulse block size-full rounded-full bg-ramp-5" />
      </span>
    );
  }

  if (stageKey === "requiring_review") {
    return (
      <span
        aria-hidden
        className="mt-3 inline-flex h-7 items-center rounded-full bg-state-warn px-3 text-100 font-bold text-card"
      >
        Open queue
      </span>
    );
  }

  if (stageKey === "top_ranked") {
    /* The first four on the board, by initials. Deduplicated: one person with three
       ranked ideas is one face, not the same face three times. */
    const seen = new Map<string, string>();
    for (const row of board?.items ?? []) {
      if (!seen.has(row.submitter.id)) seen.set(row.submitter.id, row.submitter.displayName);
      if (seen.size === 4) break;
    }
    const faces = [...seen.values()];
    if (faces.length === 0) return null;

    return (
      <span aria-hidden className="mt-3 flex items-center">
        {faces.map((name, i) => (
          <span
            key={name}
            className={`grid size-6.5 place-items-center rounded-full bg-grad-ink/25 text-100 font-extrabold text-grad-ink ring-2 ring-grad-via ${
              i === 0 ? "" : "-ml-2"
            }`}
          >
            {initials(name)}
          </span>
        ))}
      </span>
    );
  }

  return null;
}

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();

/* ══════════════════════════════════════════════════════════════════
 * What happens after a decision (Idea Platform Redesign — "outcomes journey")
 * ══════════════════════════════════════════════════════════════════ */

const OUTCOMES: readonly { key: string; label: string }[] = [
  { key: "prototype", label: "Prototype" },
  { key: "pilot", label: "Pilot" },
  { key: "implemented", label: "Implemented" },
  { key: "parked", label: "Parked" },
];

/**
 * The four outcome counts as a journey rather than four more tiles.
 *
 * They all read zero, and they will until P15 writes to them. Four zeroes in the same
 * grid as the live pipeline invites the reading that something is broken; a dotted track
 * with a "Coming in P15" chip says what is actually true — the stages exist, nothing has
 * reached them yet.
 *
 * Still four links. The counts are a requirement (requirements.md §29) and a count you
 * cannot follow is the dead end §6.3 forbids, empty or not.
 */
function OutcomeTrack({ tiles }: { tiles: DashboardResponse["tiles"] }) {
  const byKey = new Map(tiles.map((t) => [t.key, t]));

  return (
    <section className="mt-8 rounded-2xl bg-card p-5 ring-1 ring-inset ring-border">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="font-serif text-400 font-semibold">What happens after a decision</h2>
          <p className="mt-0.5 text-200 text-muted-foreground">
            Outcome tracking lands in a later phase, so this track is still empty — by
            design, not by accident.
          </p>
        </div>
        <span className="rounded-full bg-muted px-2.5 py-0.5 text-100 font-bold uppercase tracking-[0.08em] text-muted-foreground">
          Coming in P15
        </span>
      </div>

      <div className="relative mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {/* The dotted track, drawn once behind all four. Hidden where the stages wrap to
            two rows — a connector that connects the wrong pairs is worse than none. */}
        <span
          aria-hidden
          className="stage-track absolute left-[8%] right-[8%] top-5.5 hidden h-0.5 sm:block"
        />
        {OUTCOMES.map((stage) => {
          const tile = byKey.get(stage.key);
          if (!tile) return null;

          return (
            <Link
              key={stage.key}
              to={tile.href}
              className="relative flex flex-col items-center gap-2 rounded-xl py-1 no-underline transition-colors duration-[var(--dur-fast)] hover:bg-muted"
            >
              <span className="grid size-11 place-items-center rounded-full bg-card font-serif text-400 font-bold tabular-nums text-muted-foreground ring-2 ring-inset ring-ramp-2">
                {tile.count}
              </span>
              {/* The API's label carries the meaning; the short form is what fits under a
                  circle. Both are in the accessible name. */}
              <span className="text-100 font-semibold">{stage.label}</span>
              <span className="sr-only">{tile.label}</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

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

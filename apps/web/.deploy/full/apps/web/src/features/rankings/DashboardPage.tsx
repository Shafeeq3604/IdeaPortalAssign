import * as React from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, BarChart3, CheckCircle2, Flag, FlaskConical, Hourglass, Layers, ParkingSquare, Rocket, Sparkles,
  Trophy,
} from "lucide-react";
import { ErrorState, Skeleton, StatusPill } from "@iep/ui";
import type { DashboardResponse, ListRankingsResponse } from "@iep/contracts";
import { useDashboard, useRankings } from "./api";
import { BoardComposition, DashboardHero, Spotlight } from "./DashboardHero";
import { useCountUp } from "../../app/use-count-up";
import { ago } from "../../app/relative-time";
import { STATUS_LABEL, useIdeaList } from "../ideas/api";

/** A KPI tile's own count, ticking up to its value (visual-richness pass) — reserved for
 * these five headline figures, not every score on the board (that would animate 20-30
 * numbers in a grid at once, the exact "looks like a demo" effect to avoid). */
function TileCount({ value }: { value: number }) {
  return <>{Math.round(useCountUp(value))}</>;
}

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
        <Link to="/">Home</Link>  ›  Dashboard
      </nav>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1>Dashboard</h1>
        {/* P14: analytics is reached from here, not the main nav — REQUIREMENTS §20 keeps
            the main navigation small. */}
        <Link to="/analytics" className="inline-flex items-center gap-1.5 text-200 font-semibold text-accent-700 hover:underline">
          <BarChart3 aria-hidden className="size-4" />
          Analytics
          <ArrowRight aria-hidden className="size-3.5" />
        </Link>
      </div>
      <Tiles />
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

      {/*
        Featured opportunity | Opportunity overview (visual-composition pass §8): the
        board's one most-important fact, paired with real context about it, instead of
        sitting alone above a full-width row. Stacks to one column below `lg` — the
        Spotlight (the more important of the two) comes first either way.
      */}
      {board.data?.items.some((e) => e.rank === 1) ? (
        <section className="mt-8 grid items-stretch gap-4 lg:grid-cols-[2fr_1fr]">
          <Spotlight board={board.data} />
          <BoardComposition board={board.data} />
        </section>
      ) : null}

      <RecentActivity />

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
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  surface: string;
  ink: string;
  rule: string;
  /**
   * The icon's own small square badge (design-review request, against a reference
   * screenshot whose tiles lead with a coloured icon chip) — the same
   * chip-behind-an-icon shape `NavLink`'s sidebar tones already use, not a new pattern.
   * Deliberately derived from each stage's own existing `ink`/`surface` family rather
   * than a fresh hue per tile: `under_evaluation` and `top_ranked` stay in the accent
   * blue family on purpose (see that comment below) rather than the reference's
   * purple/teal, for the same reasons those two fields already state.
   */
  badge: string;
}[] = [
  { key: "total", eyebrow: "Total", icon: Layers, surface: "bg-accent-050 ring-1 ring-inset ring-ramp-2",
    ink: "text-accent-foreground", rule: "bg-[color:var(--grad-highlight)]", badge: "bg-accent text-accent-foreground" },
  { key: "new", eyebrow: "New", icon: Sparkles, surface: "bg-state-info-bg ring-1 ring-inset ring-state-info/25",
    ink: "text-state-info", rule: "bg-state-info", badge: "bg-state-info-bg text-state-info" },
  /*
   * NOT the `ai-*` palette, though the canvas paints this tile violet.
   *
   * `tests/arch/provenance.test.ts` reserves the AI provenance tokens for <Provenance>,
   * so the treatment means exactly one thing: this content came out of a model. A count of
   * the ideas the pipeline is working on is not model output — it is a number the database
   * computed. Borrowing the palette for "a model is busy" is the first step in it meaning
   * nothing. The pulsing bar below is what carries "in progress". Hourglass rather than a
   * spinner glyph for the same reason a static shape does not.
   */
  { key: "under_evaluation", eyebrow: "Evaluating", icon: Hourglass, surface: "bg-accent-100 ring-1 ring-inset ring-ramp-3",
    ink: "text-accent-700", rule: "bg-ramp-4", badge: "bg-ramp-2 text-accent-700" },
  { key: "requiring_review", eyebrow: "Needs you", icon: Flag, surface: "tile-warn-tint ring-1 ring-inset ring-state-warn/25",
    ink: "text-state-warn", rule: "bg-state-warn", badge: "bg-state-warn-bg text-state-warn" },
  /*
   * NOT a full brand-gradient surface — this is one of five equal-sized KPI tiles, not a
   * hero. A second full-gradient surface on the same screen as `DashboardHero` competes
   * with it rather than supporting it, and turns "the board has a leader" into "purple is
   * the whole dashboard" (enterprise polish pass, §3/§19: brand colour is an accent, not a
   * surface). A light accent tint, same family as `total`, keeps the tile calm while the
   * trophy icon and label still say what it is.
   */
  { key: "top_ranked", eyebrow: "Top ranked", icon: Trophy, surface: "bg-accent-050 ring-1 ring-inset ring-ramp-3",
    ink: "text-accent-700", rule: "bg-[color:var(--grad-highlight)]", badge: "bg-ramp-2 text-accent-700" },
];

/** What actually moves each of the two "is this stalled?" tiles — see the comment at
 * their empty-state line below. Keyed by `PIPELINE`'s own `key`, not a fallback: a stage
 * added later without an entry here is a compile error, not a silently generic message. */
const EMPTY_HINT: Record<"new" | "under_evaluation", string> = {
  new: "New ideas appear here the moment someone submits one.",
  under_evaluation: "Fills in while AI analysis runs on a submitted idea.",
};

/**
 * An explicit "View X →" under each tile (design-review finding, against a reference
 * screenshot): the whole tile has always been the link (SPEC §6.3 — "a count you cannot
 * click is a dead end wearing a number"), but nothing on it SAID so. Text per stage,
 * not a reused "View" + `tile.label` — the API's `label` is a longer descriptive phrase
 * ("ideas on the board"), and "View ideas on the board" reads worse than a short,
 * specific link phrase written for this spot.
 */
const VIEW_LABEL: Record<(typeof PIPELINE)[number]["key"], string> = {
  total: "View all ideas",
  new: "View new",
  under_evaluation: "View evaluating",
  requiring_review: "View needs you",
  top_ranked: "View top ranked",
};

function PipelineTiles({
  tiles,
  board,
}: {
  tiles: DashboardResponse["tiles"];
  board: ListRankingsResponse | undefined;
}) {
  const byKey = new Map(tiles.map((t) => [t.key, t]));

  /**
   * Each tile's own count, scaled against the loudest one on the board — a real
   * magnitude, not an invented trend or a share of a whole. These five counts overlap
   * (an idea can be both "top ranked" and "needs you"), so a stacked "% of total" bar
   * would imply a partition that does not exist; this reads each bar on its own, the
   * same rule `Flourish` above already applies to what it will and will not draw.
   */
  const maxCount = Math.max(1, ...PIPELINE.map((s) => byKey.get(s.key)?.count ?? 0));
  const totalCount = byKey.get("total")?.count ?? 0;

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

      {/*
        `.motion-reveal` (visual-richness pass — moderate motion on Dashboard): a stagger
        fade+rise that plays once when these tiles first mount. It does NOT replay on an
        ordinary re-render (a CSS keyframe animation only (re)starts when its element is
        newly inserted into the DOM, not on a prop-only update), so filtering, a recompute,
        or any other state change here stays instant, not re-choreographed.
      */}
      {/*
        Mobile-recomposition finding: below `sm` this was a single column, so five tiles
        that read as one compact strip on desktop became five full-width cards stacked a
        phone-screen apart — a KPI row someone had to scroll through one number at a
        time. Two columns even at the narrowest width keeps the "row of stats you can
        scan together" reading intact; it only opens out to three, then five, once there
        is room for a real row.
      */}
      <div className="motion-reveal mt-4 grid grid-cols-2 gap-4 sm:gap-4.5 lg:grid-cols-3 xl:grid-cols-5">
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
              className={`motion-reveal relative block overflow-hidden rounded-2xl p-5 no-underline transition-all duration-[var(--dur-base)] hover:-translate-y-0.5 hover:shadow-e3 sm:p-6 ${
                live ? `${stage.surface} shadow-e2` : "bg-card ring-1 ring-inset ring-border"
              }`}
            >
              <span aria-hidden className={`absolute inset-x-0 top-0 h-1 ${live ? stage.rule : "bg-border"}`} />

              <span
                aria-hidden
                className={`mt-2 grid size-9 shrink-0 place-items-center rounded-md sm:size-10 ${
                  live ? stage.badge : "bg-muted text-muted-foreground"
                }`}
              >
                <stage.icon aria-hidden className="size-4.5" />
              </span>

              <span
                aria-hidden
                className={`mt-2.5 flex items-center gap-1.5 text-100 font-bold uppercase tracking-[0.1em] ${
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
                  //
                  // `text-600` at phone width, stepping up to the full `text-800`/`text-700`
                  // once two tiles share a row instead of five — the same digits, sized for
                  // the two-column layout they actually sit in on a phone.
                  live
                    ? `mt-2 block font-serif text-600 font-bold leading-none tabular-nums sm:text-800 ${stage.ink}`
                    : "mt-2 block font-serif text-600 font-semibold leading-none tabular-nums text-muted-foreground sm:text-700"
                }
              >
                <TileCount value={tile.count} />
              </span>

              <span className="mt-2 block text-200 text-muted-foreground">
                {tile.label}
              </span>

              {/*
                One real number derived from another, not an invented trend — the "+12%
                vs previous period" the canvas asked for has nothing behind it (no run
                history is stored), but a share of TODAY's own total is arithmetic over
                data already on the page. Only on the tile someone should act on; the
                other four are already self-explanatory from their eyebrow and label.
              */}
              {stage.key === "requiring_review" && live && totalCount > 0 ? (
                <span className="mt-0.5 block text-100 text-muted-foreground">
                  {Math.round((tile.count / totalCount) * 100)}% of the board
                </span>
              ) : null}

              {/*
                Design-audit finding: "New" and "Evaluating" reading zero at the same time
                looked like the intake pipeline had stalled, not like nothing new has
                shown up since the board last moved — the tile gave no way to tell those
                two very different situations apart. Naming the second one, only for the
                two stages someone would actually worry about (Total/Needs you/Top ranked
                reading zero isn't a "stall" question the same way), removes the ambiguity
                without inventing a number this product does not have.

                UI audit finding (follow-up): "Nothing at this stage right now" said the
                tile was empty but not what would fill it — every other genuinely empty
                surface in the product (`EmptyState`) pairs the fact with a next step, and
                this tile read as the one place that didn't. `EMPTY_HINT` below is the same
                idea sized for a KPI tile's one line: what actually moves this specific
                count, not a generic "check back later."
              */}
              {!live && (stage.key === "new" || stage.key === "under_evaluation") ? (
                <span className="mt-0.5 block text-100 text-muted-foreground">
                  {EMPTY_HINT[stage.key]}
                </span>
              ) : null}

              {/* This tile's count against the loudest one on the board — a magnitude,
                  not a percentage of anything, since these five counts overlap and do
                  not add up to a whole. */}
              <span
                aria-hidden
                className="mt-2 block h-1 overflow-hidden rounded-full bg-border"
              >
                <span
                  className={`block h-full rounded-full ${live ? stage.rule : "bg-transparent"}`}
                  style={{ width: `${Math.max(live ? 6 : 0, (tile.count / maxCount) * 100)}%` }}
                />
              </span>

              <span
                className={`mt-2.5 flex items-center gap-1 text-100 font-semibold ${
                  live ? stage.ink : "text-muted-foreground"
                }`}
              >
                {VIEW_LABEL[stage.key]}
                <ArrowRight aria-hidden className="size-3" />
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
      // `bg-muted`, not `bg-card` — every other progress track in the product
      // (RankingsPage's criterion bars, AnalysisTab's step dots, ContributionBar) uses the
      // solid `--surface-sunken` groove; this one used the translucent glass surface
      // instead, which Aurora's dark theme now visibly renders as a glassy, half-see-
      // through pill next to every plain track around it.
      <span aria-hidden className="mt-3 block h-1.5 overflow-hidden rounded-full bg-muted">
        <span className="dash-pulse block size-full rounded-full bg-ramp-5" />
      </span>
    );
  }

  if (stageKey === "requiring_review") {
    /*
     * Aurora pass, found live by the dark-theme axe sweep: this used `text-card`, which
     * happened to read fine only because `--surface` used to BE a solid dark colour — once
     * Aurora made `--surface` translucent glass, the label rendered at ~4% opacity, nearly
     * invisible on the amber fill. `text-primary-foreground` (`--ink-000`) is the token
     * actually meant for "the ink that contrasts with a solid, saturated fill" in both
     * themes — white on light mode's dark-brown state-warn fill, near-black on dark mode's
     * bright amber one — which is exactly what a label sitting on `bg-state-warn` needs.
     */
    return (
      <span
        aria-hidden
        className="mt-3 inline-flex h-7 items-center rounded-full bg-state-warn px-3 text-100 font-bold text-primary-foreground"
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
            className={`grid size-6.5 place-items-center rounded-full bg-accent text-100 font-extrabold text-accent-foreground ring-2 ring-card ${
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
 * Activity — what moved most recently, not just what the board counts.
 * ══════════════════════════════════════════════════════════════════ */

/**
 * The five most recently touched ideas across the whole board (`/ideas?sort=recent`,
 * the same endpoint and sort Explore already offers — nothing new on the server, just a
 * tighter `perPage` than that page's own default).
 *
 * The pipeline tiles above answer "how many, at each stage, right now" — a snapshot with
 * no sense of motion. This answers the different question a dashboard is also for: "what
 * just happened." `updatedAt` is a real, already-returned field, not a fabricated
 * "trending" signal — recency is the one kind of activity this product can currently
 * measure honestly. A per-idea velocity/engagement ranking would need real signals this
 * API does not yet compute (flagged in the platform-transformation audit); this does not
 * pretend to be that.
 */
function RecentActivity() {
  const recent = useIdeaList({ sort: "recent", perPage: 5 });

  if (recent.isPending) {
    return (
      <section className="mt-8">
        <h2 className="font-serif text-500 font-semibold">Activity</h2>
        <div className="mt-3.5 space-y-2" aria-busy="true">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      </section>
    );
  }

  // Quiet on failure — the pipeline tiles above already carry this page's headline
  // numbers, so a second error banner for a secondary section is not worth the alarm.
  if (recent.isError || recent.data.items.length === 0) return null;

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="font-serif text-500 font-semibold">Activity</h2>
          <p className="mt-0.5 text-200 text-muted-foreground">
            What moved most recently across the whole board.
          </p>
        </div>
        <Link to="/ideas?sort=recent" className="text-200 font-medium">
          See everything
        </Link>
      </div>

      <ul className="mt-3.5 list-none space-y-2 p-0">
        {recent.data.items.map((idea) => (
          <li key={idea.id}>
            <Link
              to={`/ideas/${idea.id}/overview`}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl border border-border bg-card p-3.5 no-underline transition-colors duration-[var(--dur-fast)] hover:bg-muted/60"
            >
              <span className="flex min-w-0 items-center gap-3">
                <StatusPill kind="LIFECYCLE" status={idea.status} label={STATUS_LABEL[idea.status]} />
                <span className="min-w-0 truncate font-medium text-foreground">{idea.title}</span>
              </span>
              <span className="whitespace-nowrap text-100 text-muted-foreground">
                {idea.submitter.displayName} · {ago(idea.updatedAt)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════
 * What happens after a decision (Idea Platform Redesign — "outcomes journey")
 * ══════════════════════════════════════════════════════════════════ */

const OUTCOMES: readonly {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}[] = [
  { key: "prototype", label: "Prototype", icon: FlaskConical },
  { key: "pilot", label: "Pilot", icon: Rocket },
  { key: "implemented", label: "Implemented", icon: CheckCircle2 },
  { key: "parked", label: "Parked", icon: ParkingSquare },
];

/**
 * The four outcome counts as one quiet footnote, not a fifth section fighting the live
 * pipeline above it for the same visual weight.
 *
 * They all read zero, and they will until P15 writes to them. The original design gave
 * this its own full-width card with four large "0" circles — the single least rewarding
 * thing on the page, sitting dead-centre in the scroll (production UX review). A count
 * that cannot move yet does not need the same visual budget as one that can; a single
 * slim row states the honest reason once and lists the four destinations as plain,
 * small links, so the page's remaining weight stays with the live board above it.
 *
 * Still four links. The counts are a requirement (requirements.md §29) and a count you
 * cannot follow is the dead end §6.3 forbids, empty or not.
 */
function OutcomeTrack({ tiles }: { tiles: DashboardResponse["tiles"] }) {
  const byKey = new Map(tiles.map((t) => [t.key, t]));

  return (
    <section className="mt-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl bg-muted/60 px-4 py-2.5">
      <p className="text-100 text-muted-foreground">
        Outcome tracking (prototype → pilot → implemented → parked) arrives in P15 — still
        empty by design, not by accident.
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {OUTCOMES.map((stage) => {
          const tile = byKey.get(stage.key);
          if (!tile) return null;
          return (
            <Link
              key={stage.key}
              to={tile.href}
              className="inline-flex items-center gap-1.5 text-100 font-medium text-muted-foreground no-underline hover:text-foreground"
            >
              <stage.icon aria-hidden className="size-3.5 shrink-0" />
              {stage.label}
              <span className="tabular-nums">({tile.count})</span>
              <span className="sr-only">{tile.label}</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

/*
 * The recompute control used to live here. It's an administrative action — creating a new
 * ranking snapshot, not reading one — and a dashboard's job is to summarize, not to host
 * a form (production UX review: "the page doesn't end on a summary, it ends on a form").
 * It now lives on Administration → Audit log, collapsed by default, next to the very log
 * that records every recompute it produces (see `RecomputePanel` in AdminPages.tsx).
 */

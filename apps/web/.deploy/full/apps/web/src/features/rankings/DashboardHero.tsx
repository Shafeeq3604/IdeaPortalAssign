import * as React from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ListChecks, TrendingDown, TrendingUp } from "lucide-react";
import { matchRouteId } from "@iep/contracts";
import type { AnalyticsResponse, DashboardResponse, ListRankingsResponse } from "@iep/contracts";
import { canSee, useSession } from "../../app/use-session";
import { ago } from "../../app/relative-time";
import { BrandMark } from "../../app/BrandMark";

/**
 * The dashboard hero (Idea Platform Redesign — "hero").
 *
 * The canvas puts a gradient panel at the top of the dashboard carrying a greeting, what
 * changed, and the two things worth doing next. This is that panel, with one rule applied
 * throughout: **every number is real**.
 *
 * The canvas mocked "4.2d idea → score" and "92% explained". Both are invented — nothing
 * in this product measures either, and CLAUDE.md is explicit that a number not in SPEC is
 * a stop, not a guess. A dashboard whose headline statistics are decorative teaches people
 * that the numbers below them are decorative too. They are replaced with two the engine
 * actually knows: how many ideas are on the board, and what the leader scored.
 */

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

const count = (data: DashboardResponse, key: string): number =>
  data.tiles.find((t) => t.key === key)?.count ?? 0;

export function DashboardHero({
  data,
  board,
  analytics,
}: {
  data: DashboardResponse;
  /** Undefined while the board is still loading — the hero renders without it. */
  board: ListRankingsResponse | undefined;
  /** Undefined while loading or on failure — the two tiles it feeds fall back to counts. */
  analytics: AnalyticsResponse | undefined;
}) {
  const session = useSession();
  const firstName = (session.data?.user.displayName ?? "").split(/\s+/)[0] ?? "";

  /*
   * The dashboard is MANAGEMENT/ADMIN's; the review queue is REVIEWER/ADMIN's — the two
   * overlap only at ADMIN. Read from the nav map rather than a second hardcoded role list,
   * so this cannot drift from the route's own declared access.
   */
  const canReview = canSee(session.data?.user.roles ?? [], matchRouteId("/review")?.roles ?? []);

  const toReview = count(data, "requiring_review");
  const evaluating = count(data, "under_evaluation");
  const fresh = count(data, "new");
  const ranked = count(data, "top_ranked");
  const inDelivery = count(data, "prototype") + count(data, "pilot");

  /** `previousRank` is null on a first appearance — a new entrant, not a move. */
  const moved = (board?.items ?? []).filter(
    (e) => e.previousRank !== null && e.previousRank !== e.rank,
  ).length;
  const leader = board?.items.find((e) => e.rank === 1);

  /*
   * P9 usability round 1 ("richer, enterprise-grade look"): the headline leads with what
   * needs doing, when something does. A dashboard that opens on "3 ideas are waiting on a
   * reviewer" is a to-do; one that opens on board movement is a report. Movement is still
   * said — in the line underneath — and is the headline when nothing is waiting.
   */
  const headline =
    toReview > 0
      ? `${toReview === 1 ? "One idea is" : `${toReview} ideas are`} waiting on a reviewer.`
      : moved > 0
        ? `${moved === 1 ? "One idea" : `${moved} ideas`} changed places on the last run.`
        : "Quiet since the last run — nobody changed places.";

  const detail = [
    leader ? `“${leader.title}” is leading at ${leader.compositeScore.toFixed(1)}` : null,
    toReview > 0 && moved > 0
      ? `${moved === 1 ? "one idea" : `${moved} ideas`} changed places on the last run`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  /* ── the four hero figures — every one computed, none drawn for effect ── */
  const topScores = data.history
    .map((h) => h.topScore)
    .filter((s): s is number => s !== null);
  const months = analytics?.submissionsByMonth ?? [];
  const thisMonth = months[months.length - 1];
  const firstScore = analytics?.cycleTimes.find((c) => c.key === "SUBMITTED_TO_FIRST_SCORE");
  const showReviewCta = toReview > 0 && canReview;

  return (
    <div className="dash-hero relative overflow-hidden rounded-2xl p-6 text-grad-ink shadow-e4-lit sm:p-8 lg:p-9">
      <BrandMark
        aria-hidden
        className="pointer-events-none absolute -right-12 -top-12 size-72 text-grad-ink opacity-[0.05]"
      />
      <div className="relative grid gap-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:items-center">
        <div className="min-w-0">
          <span className="inline-flex items-center gap-2 rounded-full bg-grad-ink/10 px-3 py-1 text-100 font-bold uppercase tracking-[0.08em] text-grad-ink-soft ring-1 ring-grad-rule">
            <span className="dash-pulse size-1.5 rounded-full bg-grad-highlight" />
            Board recomputed {ago(data.generatedAt)}
          </span>

          <h2 className="mt-4 text-500 font-extrabold leading-tight tracking-tight text-balance sm:text-700 lg:text-800">
            {greeting()}
            {firstName ? `, ${firstName}` : ""}.
            <br />
            {headline}
          </h2>

          {detail ? (
            <p className="mt-3 max-w-[60ch] text-300 leading-relaxed text-grad-ink-soft sm:text-400">{detail}.</p>
          ) : null}

          <div className="mt-6 flex flex-wrap gap-3">
            {showReviewCta ? (
              <Link
                to="/review"
                className="inline-flex h-11 items-center gap-2 rounded-xl bg-grad-highlight px-5 text-200 font-extrabold text-grad-from no-underline shadow-[0_8px_24px_-8px_var(--grad-highlight)] transition-transform duration-[var(--dur-fast)] hover:-translate-y-px"
              >
                <ListChecks aria-hidden className="size-4" />
                Open the review queue
                <ArrowRight aria-hidden className="size-4" />
              </Link>
            ) : null}
            <Link
              to="/rankings"
              className="inline-flex h-11 items-center gap-2 rounded-xl px-5 text-200 font-bold text-grad-ink no-underline ring-1 ring-inset ring-grad-ink/25 transition-colors duration-[var(--dur-fast)] hover:bg-grad-ink/10"
            >
              See the board
              {showReviewCta ? null : <ArrowRight aria-hidden className="size-4" />}
            </Link>
          </div>
        </div>

        <dl className="m-0 grid grid-cols-2 gap-3">
          <HeroStat
            label="On the board"
            value={String(board?.run.cohortSize ?? ranked)}
            note={
              topScores.length >= 2
                // The chart is the top score's trend, not the count above it — so the
                // caption names the figure it charts ("Top score, last 3 runs" under
                // "On the board: 8" read as a mislabel).
                ? `Top score ${(topScores[topScores.length - 1] ?? 0).toFixed(1)} · trend over ${topScores.length} runs`
                : leader
                  ? `Top score ${leader.compositeScore.toFixed(1)}`
                  : "No ranking run yet"
            }
            series={topScores.length >= 2 ? topScores : undefined}
            seriesLabel={`Top score across the last ${topScores.length} ranking runs, from ${topScores[0]?.toFixed(1) ?? "—"} to ${topScores[topScores.length - 1]?.toFixed(1) ?? "—"}.`}
          />
          {thisMonth ? (
            <HeroStat
              label="Submitted this month"
              value={String(thisMonth.count)}
              note="Per month, last 12 months"
              series={months.map((m) => m.count)}
              seriesLabel={`Submissions per month for the last 12 months: ${months.map((m) => m.count).join(", ")}.`}
            />
          ) : (
            <HeroStat label="New ideas" value={String(fresh)} note="Submitted, not yet analysed" />
          )}
          {firstScore ? (
            <HeroStat
              label="Median time to first score"
              value={formatDays(firstScore.medianDays)}
              note={
                firstScore.sampleSize === 0
                  ? "Nothing scored yet"
                  : `Across ${firstScore.sampleSize} scored idea${firstScore.sampleSize === 1 ? "" : "s"}`
              }
            />
          ) : (
            <HeroStat label="Being analysed" value={String(evaluating)} note="AI analysis in progress" />
          )}
          <HeroStat
            label="In prototype or pilot"
            value={String(inDelivery)}
            note={`${count(data, "implemented")} implemented so far`}
          />
        </dl>
      </div>
    </div>
  );
}

/** "< 1 day" rather than "0.3 days" — a median this small is a speed, not a figure. */
function formatDays(days: number | null): string {
  if (days === null) return "—";
  if (days < 1) return "< 1 day";
  const d = Math.round(days * 10) / 10;
  return `${Number.isInteger(d) ? d.toFixed(0) : d.toFixed(1)} day${d === 1 ? "" : "s"}`;
}

function HeroStat({
  label,
  value,
  note,
  series,
  seriesLabel = "",
}: {
  label: string;
  value: string;
  note: string;
  /** A real stored series only — a stat with no history simply has no line. */
  series?: readonly number[] | undefined;
  seriesLabel?: string;
}) {
  return (
    <div className="hero-panel flex min-w-0 flex-col rounded-2xl p-4 sm:p-4.5">
      <dt className="text-100 font-semibold text-grad-ink-soft">{label}</dt>
      <dd className="m-0 mt-1.5 text-600 font-extrabold leading-none tracking-tight tabular-nums text-grad-ink sm:text-700">
        {value}
      </dd>
      {series ? (
        <dd className="m-0">
          <Sparkline values={series} label={seriesLabel} />
        </dd>
      ) : null}
      <dd className="m-0 mt-auto pt-2 text-100 text-grad-ink-soft">{note}</dd>
    </div>
  );
}

/**
 * A sparkline of a real series (the ranking-run history, the monthly submissions).
 *
 * A perfectly flat series is real information ("nothing changed") and is drawn level and
 * centred, not pinned to the floor by a zero range.
 */
function Sparkline({ values, label }: { values: readonly number[]; label: string }) {
  const w = 120;
  const h = 26;
  const pad = 2.5;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const flat = max === min;
  const range = max - min || 1;
  const coords = values.map((v, i) => ({
    x: pad + (values.length === 1 ? 0.5 : i / (values.length - 1)) * (w - pad * 2),
    y: flat ? h / 2 : pad + (1 - (v - min) / range) * (h - pad * 2),
  }));

  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="mt-2 h-6.5 w-full" role="img" aria-label={label}>
      <polyline
        points={coords.map((c) => `${c.x},${c.y}`).join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        className="text-grad-highlight"
      />
    </svg>
  );
}

/**
 * A score as a filled ring (Idea Platform Redesign — the spotlight and the idea cards).
 *
 * The ramp, never a verdict palette: a 42 and a 91 differ in how much of the ring is
 * drawn, not in hue (P-1). Exported because the idea cards use the same dial, and two
 * screens drawing the same figure two ways is how a product stops looking like one.
 *
 * The number inside is the same `toFixed(1)` composite shown everywhere else, so nobody
 * has to wonder whether the dial rounds differently from the column.
 */
export function ScoreRing({
  value,
  size = "md",
  onBrand = false,
}: {
  value: number;
  size?: "sm" | "md";
  /** On the gradient panel the indigo ramp disappears; amber-on-rule replaces it. */
  onBrand?: boolean;
}) {
  const outer = size === "md" ? "size-24" : "size-16";
  const inner = size === "md" ? "size-[4.625rem]" : "size-13";

  /**
   * The ring used to render straight to its final `--ring-turn` on the very first paint —
   * correct arithmetic, but a number that never arrives, it is just already there, which
   * reads as inert next to `ScoreDisplay`'s own tally and `ContributionBar`'s bar fill
   * (both of which animate in). Starting at 0 and letting an effect move it to `value`
   * right after mount is what gives `.score-ring`'s registered-property transition
   * (index.css) something to animate — and because this re-runs on every `value` change,
   * not once, a re-rank after a recompute redraws the SAME idea's ring from its old
   * fraction to its new one instead of snapping, which is the other half of what was
   * missing: nothing on this board visibly moved when a recompute actually changed it.
   */
  const [display, setDisplay] = React.useState(0);
  React.useEffect(() => {
    const id = requestAnimationFrame(() => setDisplay(Math.max(0, Math.min(100, value))));
    return () => cancelAnimationFrame(id);
  }, [value]);

  return (
    <span
      aria-hidden
      className={`score-ring${onBrand ? " score-ring--on-brand" : ""} relative grid ${outer} shrink-0 place-items-center rounded-full shadow-e1`}
      /* A fraction of a turn — the CSS does the arithmetic on the gradient stop. */
      style={{ "--ring-turn": `${display / 100}turn` } as React.CSSProperties}
    >
      <span
        className={`flex ${inner} flex-col items-center justify-center rounded-full bg-[color:var(--ink-000)]`}
      >
        {/*
          Dark-mode final-polish pass: was gradient-filled, fading toward `--grad-to` at
          one corner of the glyph — legible reading top-to-bottom on the larger dashboard
          leader, but on the small "sm" ring every idea card uses, that dark corner landed
          inside the digits themselves, exactly where "the number should have stronger
          contrast than secondary metadata" (design review) said it needed the MOST
          contrast, not the least. A solid `--accent-700` — the one token this file
          already reserves for readable accent text on a card — reads at ~5.4:1 on the
          card surface everywhere this ring is drawn, evenly across every digit, and still
          answers "score = primary accent." The ring itself carries the gradient; the
          number no longer has to.

          Aurora pass: this circle is only that solid backdrop if it's actually opaque —
          `bg-card` used to be, so the ring's own bright fill never showed through behind
          the digits. Once `--surface` became Aurora's translucent glass, the ring's colour
          bled straight through the "solid" disc, and the numeral (still `--accent-700`,
          itself a blue) landed on a bright blue backdrop instead of a neutral one.
          `--ink-000` is deliberately opaque in both themes (read directly since P9 made
          `--primary-foreground` white in dark mode for contrast on blue fills) — in
          light mode it's the same white `bg-card` already was, so nothing changes there;
          in dark mode it's Aurora's solid near-black on-accent ink, which is exactly the
          occluding disc this ring's contrast math already assumed it had.
        */}
        <b
          className={`font-serif text-accent-700 ${size === "md" ? "text-600" : "text-400"} font-bold leading-none tabular-nums`}
        >
          {value.toFixed(1)}
        </b>
        {size === "md" ? (
          <span className="text-100 uppercase tracking-[0.1em] text-muted-foreground">
            of 100
          </span>
        ) : null}
      </span>
    </span>
  );
}

/**
 * Movement since the last run, as a chip.
 *
 * `RankBadge` in @iep/ui renders the rank AND the delta together, which is right where the
 * rank is not otherwise on screen. The redesign puts the rank in its own numeral — on the
 * podium, in the row's rank tile, in the spotlight's byline — so a second "#4 of 8" beside
 * it is the same fact twice. This is the delta half on its own.
 *
 * One implementation, used by all three, because the sign convention is the easiest thing
 * in this product to get backwards: a LOWER rank number is better, so a decrease is an
 * improvement. `previousRank` is null on a first appearance — a new entrant has not moved,
 * and rendering "up 4" for one is a lie about a board that had never been computed.
 */
export function RankDelta({
  rank,
  previousRank,
  onBrand = false,
}: {
  rank: number;
  previousRank: number | null;
  /** On the gradient panel the light tints vanish; a translucent ground replaces them. */
  onBrand?: boolean;
}) {
  if (previousRank === null) return null;
  const delta = previousRank - rank;

  if (delta === 0) {
    return (
      // "Held" (dark-mode final-polish pass, item 4): not obviously readable to a
      // first-time visitor as "same rank as last time" rather than, say, a state action
      // ("this rank is on hold"). "No change" says what actually happened; the `title`
      // carries the rest, same wording as the sr-only text on the up/down chip below.
      <span
        title="Same rank as the last board update"
        className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-100 font-bold ${
          onBrand ? "bg-grad-ink/15 text-grad-ink-soft" : "bg-muted text-muted-foreground"
        }`}
      >
        No change
      </span>
    );
  }

  const up = delta > 0;
  const tone = onBrand
    ? "bg-grad-ink/15 text-grad-ink ring-1 ring-grad-rule"
    : up
      ? "bg-factor-up-bg text-factor-up"
      : "bg-factor-down-bg text-factor-down";

  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-100 font-bold ${tone}`}>
      {up ? (
        <TrendingUp aria-hidden className="size-3" />
      ) : (
        <TrendingDown aria-hidden className="size-3" />
      )}
      {up ? "up" : "down"} {Math.abs(delta)}
      <span className="sr-only">{Math.abs(delta) === 1 ? "place" : "places"} since the last run</span>
    </span>
  );
}

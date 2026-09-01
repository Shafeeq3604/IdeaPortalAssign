import type * as React from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ListChecks, TrendingDown, TrendingUp, Trophy } from "lucide-react";
import type { DashboardResponse, ExplanationItem, ListRankingsResponse } from "@iep/contracts";
import { useSession } from "../../app/use-session";

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

/** "31 min ago" — the canvas's pulsing freshness chip, from the real timestamp. */
function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

const count = (data: DashboardResponse, key: string): number =>
  data.tiles.find((t) => t.key === key)?.count ?? 0;

export function DashboardHero({
  data,
  board,
}: {
  data: DashboardResponse;
  /** Undefined while the board is still loading — the hero renders without it. */
  board: ListRankingsResponse | undefined;
}) {
  const session = useSession();
  const firstName = (session.data?.user.displayName ?? "").split(/\s+/)[0] ?? "";

  const toReview = count(data, "requiring_review");
  const evaluating = count(data, "under_evaluation");
  const fresh = count(data, "new");
  const ranked = count(data, "top_ranked");

  /**
   * "Three ideas moved overnight", computed rather than asserted.
   *
   * `previousRank` is null on an idea's first appearance, which is a new entrant rather
   * than a move — counting it as movement would report a busy night on a board that had
   * simply never been computed before.
   */
  const moved = (board?.items ?? []).filter(
    (e) => e.previousRank !== null && e.previousRank !== e.rank,
  ).length;
  const leader = board?.items.find((e) => e.rank === 1);

  const headline =
    moved > 0
      ? `${moved === 1 ? "One idea" : `${moved} ideas`} moved on the last run.`
      : "The board is settled since the last run.";

  const detail = [
    toReview > 0
      ? `${toReview === 1 ? "One idea needs" : `${toReview} ideas need`} a reviewer`
      : null,
    leader ? `“${leader.title}” leads on ${leader.compositeScore.toFixed(1)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="dash-hero relative overflow-hidden rounded-2xl p-7 text-grad-ink shadow-e4 sm:p-8">
      <div className="relative flex flex-wrap items-start justify-between gap-8">
        <div className="max-w-[52ch]">
          <span className="inline-flex items-center gap-2 rounded-full bg-grad-ink/10 px-3 py-1 text-100 uppercase tracking-[0.06em] text-grad-ink-soft ring-1 ring-grad-rule">
            <span className="dash-pulse size-1.5 rounded-full bg-grad-highlight" />
            Board recomputed {ago(data.generatedAt)}
          </span>

          <h2 className="mt-3.5 font-serif text-600 font-semibold leading-tight tracking-tight sm:text-700">
            {greeting()}
            {firstName ? `, ${firstName}` : ""}.
            <br />
            {headline}
          </h2>

          {detail ? (
            <p className="mt-2.5 text-300 leading-relaxed text-grad-ink-soft">{detail}.</p>
          ) : null}

          <div className="mt-5 flex flex-wrap gap-2.5">
            {toReview > 0 ? (
              <Link
                to="/review"
                className="inline-flex h-9 items-center gap-2 rounded-full bg-grad-highlight px-4 text-100 font-bold text-grad-from no-underline shadow-e2 transition-transform duration-[var(--dur-fast)] hover:-translate-y-px"
              >
                <ListChecks aria-hidden className="size-4" />
                Review {toReview} idea{toReview === 1 ? "" : "s"}
              </Link>
            ) : null}
            <Link
              to="/rankings"
              className="inline-flex h-9 items-center gap-2 rounded-full bg-grad-ink/10 px-4 text-100 font-semibold text-grad-ink no-underline ring-1 ring-grad-rule transition-colors duration-[var(--dur-fast)] hover:bg-grad-ink/20"
            >
              See the board
              <ArrowRight aria-hidden className="size-4" />
            </Link>
          </div>
        </div>

        {/* ── pipeline flow ── */}
        <div className="w-full max-w-[16rem] rounded-2xl bg-grad-ink/8 p-4 ring-1 ring-grad-rule">
          <p className="text-100 font-bold uppercase tracking-[0.14em] text-grad-ink-soft">
            Pipeline flow
          </p>

          <div className="mt-3.5 flex items-center">
            {[fresh, evaluating, ranked].map((n, i) => (
              <Stage key={i} value={n} last={i === 2} delay={i} />
            ))}
          </div>
          <p className="mt-2 text-100 tracking-wide text-grad-ink-soft">
            new → evaluating → ranked
          </p>

          {/*
            Two figures the engine actually knows. The canvas had "4.2d idea → score" and
            "92% explained"; nothing measures either, and inventing them here would be the
            one thing this product is built not to do.
          */}
          <div className="mt-4 flex gap-5 border-t border-grad-rule pt-3.5">
            <Stat value={String(board?.run.cohortSize ?? ranked)} label="on the board" />
            <Stat
              value={leader ? leader.compositeScore.toFixed(1) : "—"}
              label="top score"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function Stage({ value, last, delay }: { value: number; last: boolean; delay: number }) {
  return (
    <>
      <span
        className={
          last
            ? "grid size-9 shrink-0 place-items-center rounded-xl bg-grad-highlight/20 text-200 font-bold tabular-nums text-grad-highlight ring-1 ring-grad-highlight/45"
            : "grid size-9 shrink-0 place-items-center rounded-xl bg-grad-ink/10 text-200 font-bold tabular-nums ring-1 ring-grad-rule"
        }
      >
        {value}
      </span>
      {last ? null : (
        <span className="relative mx-1.5 h-0.5 flex-1 overflow-hidden rounded-full bg-grad-ink/20">
          <span
            className="dash-flow absolute inset-y-0 w-2/5"
            style={{ animationDelay: `${delay * 0.7}s` }}
          />
        </span>
      )}
    </>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <span>
      <b className="block font-serif text-500 font-semibold leading-none tabular-nums text-grad-highlight">
        {value}
      </b>
      <span className="mt-1 block text-100 text-grad-ink-soft">{label}</span>
    </span>
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

  return (
    <span
      aria-hidden
      className={`score-ring${onBrand ? " score-ring--on-brand" : ""} relative grid ${outer} shrink-0 place-items-center rounded-full shadow-e1`}
      /* A fraction of a turn — the CSS does the arithmetic on the gradient stop. */
      style={{ "--ring-turn": `${Math.max(0, Math.min(100, value)) / 100}turn` } as React.CSSProperties}
    >
      <span
        className={`flex ${inner} flex-col items-center justify-center rounded-full bg-card`}
      >
        <b
          className={`font-serif ${size === "md" ? "text-600" : "text-400"} font-bold leading-none tabular-nums text-accent-700`}
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
 * One factor as a labelled bar.
 *
 * The canvas shows three bars per idea. The board's contract carries two — the top
 * strength and the top constraint — and inventing a third from the criteria we happen to
 * know about would be a bar whose length nothing computed. Two real bars beat three, one
 * of which is a drawing.
 *
 * A strength is measured by what it CONTRIBUTED; a constraint by the headroom it left.
 * They are different quantities, so they are labelled differently and drawn in different
 * tones — teal for direction up, clay for direction down, neither of them green or red
 * (P-1).
 */
function FactorBar({ item, kind }: { item: ExplanationItem; kind: "up" | "down" }) {
  const up = kind === "up";

  /*
   * The bar's length is `normalized`, the criterion's own 0–100 score — the one figure
   * here that IS a proportion of something. `contribution` is in composite points and
   * depends on the profile's weight, so drawing it against a 100-wide track would make a
   * heavily-weighted criterion look weak.
   *
   * A run computed before the engine recorded `normalized` has no length to draw; the
   * figure is shown without a bar rather than with a bar of a guessed width.
   */
  const width = item.normalized;

  return (
    <div>
      <div className="flex justify-between gap-3 text-100">
        <span className="font-semibold">{item.criterionLabel}</span>
        <span className={`font-bold tabular-nums ${up ? "text-factor-up" : "text-factor-down"}`}>
          {up
            ? `+${item.contribution.toFixed(1)} pts`
            : item.headroom === undefined
              ? "held it back"
              : `${item.headroom.toFixed(1)} pts available`}
        </span>
      </div>
      {width === undefined ? null : (
        <div
          aria-hidden
          className={`mt-1 h-1.5 overflow-hidden rounded-full ${up ? "bg-ramp-1" : "bg-factor-down-bg"}`}
        >
          <div
            className={`h-full rounded-full transition-[width] duration-[var(--dur-settle)] ease-[var(--ease-out-quint)] ${
              up ? "bg-gradient-to-r from-ramp-4 to-ramp-5" : "bg-factor-down"
            }`}
            style={{ width: `${Math.max(2, Math.min(100, width))}%` }}
          />
        </div>
      )}
      {/* The engine's own sentence, in full, for anyone not reading the bar. */}
      <span className="sr-only">{item.text}</span>
    </div>
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
      <span
        className={`inline-flex items-center rounded-full px-2.5 py-1 text-100 font-bold ${
          onBrand ? "bg-grad-ink/15 text-grad-ink-soft" : "bg-muted text-muted-foreground"
        }`}
      >
        — held
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
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-100 font-bold ${tone}`}>
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

/**
 * The leader, given a face (Idea Platform Redesign — "spotlight").
 *
 * The canvas calls this "Idea of the week" and pairs it with an "up 2 places" chip. It is
 * not the idea of the week — it is the idea at the top of the current run, and nothing
 * here knows about weeks. The chip is real and comes from `previousRank`, so it is kept
 * and only rendered when the idea actually moved.
 */
export function Spotlight({ board }: { board: ListRankingsResponse | undefined }) {
  const leader = board?.items.find((e) => e.rank === 1);
  if (!leader) return null;

  return (
    <section className="mt-8">
      <div className="relative overflow-hidden rounded-2xl bg-card p-5 shadow-e2 ring-1 ring-inset ring-border">
        {/* The amber-to-violet edge the canvas runs down the spotlight, and the only thing
            marking this card out from the ones below it. */}
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b from-grad-highlight to-grad-to"
        />

        <div className="flex flex-wrap items-center gap-2">
          <h2 className="inline-flex items-center gap-1.5 rounded-full bg-grad-highlight/20 px-2.5 py-1 text-100 font-extrabold uppercase tracking-[0.1em] text-state-warn">
            <Trophy aria-hidden className="size-3" />
            Leading the board
          </h2>
          <RankDelta rank={leader.rank} previousRank={leader.previousRank} />
        </div>

        <div className="mt-3.5 flex flex-wrap items-start gap-5">
          <ScoreRing value={leader.compositeScore} />

          <div className="min-w-[16rem] flex-1">
            <h3 className="text-400 font-semibold leading-snug">
              <Link to={`/ideas/${leader.ideaId}/evaluation`}>{leader.title}</Link>
            </h3>
            <p className="mt-1 text-200 text-muted-foreground">
              <Link to={`/people/${leader.submitter.id}`}>{leader.submitter.displayName}</Link>
              {leader.department ? ` · ${leader.department}` : ""} ·{" "}
              <span className="font-semibold text-primary">
                #{leader.rank} of {board?.run.cohortSize ?? leader.rank}
              </span>
            </p>

            {/* P-2 travels with the rank, here as much as on the board itself. */}
            <div className="mt-3.5 flex flex-col gap-2.5">
              {leader.topStrength ? <FactorBar item={leader.topStrength} kind="up" /> : null}
              {leader.topConstraint ? (
                <FactorBar item={leader.topConstraint} kind="down" />
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

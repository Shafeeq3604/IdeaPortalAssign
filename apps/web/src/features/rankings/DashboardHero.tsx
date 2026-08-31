import { Link } from "react-router-dom";
import { ArrowRight, ListChecks, Trophy } from "lucide-react";
import type { DashboardResponse, ListRankingsResponse } from "@iep/contracts";
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

          <h2 className="mt-3.5 text-600 font-semibold leading-tight tracking-tight sm:text-700">
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
      <b className="block text-500 font-semibold leading-none tabular-nums text-grad-highlight">
        {value}
      </b>
      <span className="mt-1 block text-100 text-grad-ink-soft">{label}</span>
    </span>
  );
}

/** The leader, given a face. Rendered only when the board has one. */
export function Spotlight({ board }: { board: ListRankingsResponse | undefined }) {
  const leader = board?.items.find((e) => e.rank === 1);
  if (!leader) return null;

  return (
    <section className="mt-8">
      <h2 className="text-100 font-medium uppercase tracking-widest text-muted-foreground">
        Leading the board
      </h2>

      <div className="mt-3 overflow-hidden rounded-xl border border-border bg-card shadow-e1">
        <div className="flex flex-wrap items-center gap-4 p-5">
          <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground">
            <Trophy aria-hidden className="size-5" />
          </span>

          <div className="min-w-0 flex-1">
            <Link
              to={`/ideas/${leader.ideaId}/evaluation`}
              className="text-400 font-semibold"
            >
              {leader.title}
            </Link>
            <p className="text-100 text-muted-foreground">
              {leader.submitter.displayName}
              {leader.department ? ` · ${leader.department}` : ""}
            </p>
          </div>

          <div className="text-right">
            <span className="block text-600 font-bold tabular-nums text-primary">
              {leader.compositeScore.toFixed(1)}
            </span>
            <span className="text-100 text-muted-foreground">of 100</span>
          </div>
        </div>

        {/* P-2 travels with the rank, here as much as on the board itself. */}
        {leader.topStrength ? (
          <p className="border-t border-border bg-muted/40 px-5 py-3 text-200">
            <span className="font-medium text-factor-up">Strongest</span>{" "}
            <span className="font-medium">{leader.topStrength.criterionLabel}</span>{" "}
            <span className="text-muted-foreground">
              — {leader.topStrength.contribution.toFixed(1)} of its points
            </span>
          </p>
        ) : null}
      </div>
    </section>
  );
}

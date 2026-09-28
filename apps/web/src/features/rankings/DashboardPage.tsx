import * as React from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, BarChart3, CheckCircle2, FlaskConical, Flag, Sparkles,
} from "lucide-react";
import { ErrorState, Skeleton, StatusPill } from "@iep/ui";
import type { AnalyticsResponse, DashboardResponse, DashboardTile, ListRankingsResponse } from "@iep/contracts";
import { useDashboard, useRankings } from "./api";
import { DashboardHero, RankDelta } from "./DashboardHero";
import { useCountUp } from "../../app/use-count-up";
import { ago } from "../../app/relative-time";
import { STATUS_LABEL, useIdeaList } from "../ideas/api";
import { FEASIBILITY_LABEL } from "../analysis/api";
import { useAnalytics } from "../analytics/api";

/** A KPI card's own count, ticking up to its value — reserved for the four headline
 * figures, not every number on the page (that reads as a demo, not a product). */
function TileCount({ value }: { value: number }) {
  return <>{Math.round(useCountUp(value))}</>;
}

const link = ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
  <Link to={to} className={className}>{children}</Link>
);

/** The one card surface every dashboard panel shares, so they read as one set. */
const PANEL = "rounded-2xl border border-border bg-card shadow-e2";

/**
 * Management dashboard (P7 — FR-26, SPEC §9.9), recomposed in P9 (usability round 1:
 * "a richer, enterprise-grade look").
 *
 * Two rules survive every layout change here:
 *  - Every count is a link, and the destination comes from the API rather than being
 *    assembled here (SPEC §6.2 row 40) — a count whose "see them" link is built client-side
 *    drifts from the filter the count was computed with.
 *  - Every number is real. The mockup this layout came from showed week-on-week deltas and
 *    per-KPI trend lines nothing in this product measures; those are left out rather than
 *    drawn. What IS drawn is a stored series (ranking runs, monthly submissions) or plain
 *    arithmetic over counts already on the page.
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
      <Dashboard />
    </main>
  );
}

function Dashboard() {
  const query = useDashboard();

  /*
   * One board query for the whole page: the hero, the table and the attention list all
   * describe the same run, and two fetches could describe two runs a second apart.
   * Declared ABOVE the early returns — hooks run in the same order on every render.
   */
  const board = useRankings({ page: 1, rankBand: "all" });

  /*
   * P14 analytics feeds three secondary figures (monthly submissions, time to first score,
   * ideas by department). Same `dashboard:read` access as this page. If it fails, those
   * figures fall back to counts the dashboard already has, or their panel is omitted —
   * never replaced by a guess.
   */
  const analytics = useAnalytics({});

  if (query.isPending) {
    return (
      <div className="mt-6 grid gap-4" aria-busy="true">
        <Skeleton className="h-64 w-full rounded-2xl" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-2xl" />
          ))}
        </div>
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

  const tiles = query.data.tiles;
  const ana = analytics.data;

  return (
    <div className="mt-6 flex flex-col gap-5 sm:gap-6">
      <DashboardHero data={query.data} board={board.data} analytics={ana} />

      <KpiRow tiles={tiles} />

      <section className="grid gap-5 sm:gap-6 2xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <TopOpportunities board={board.data} pending={board.isPending} />
        <div className="grid min-w-0 content-start gap-5 sm:gap-6 lg:grid-cols-2 2xl:grid-cols-1">
          <Pipeline tiles={tiles} />
          <Attention tiles={tiles} board={board.data} />
        </div>
      </section>

      <section className="grid gap-5 sm:gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <RecentActivity />
        {ana ? <ByDepartment rows={ana.byDepartment} /> : null}
      </section>

      <p className="text-100 text-muted-foreground">
        As of {new Date(query.data.generatedAt).toLocaleString()}. Every count leads to the
        list it counted.
      </p>
    </div>
  );
}

const byKey = (tiles: readonly DashboardTile[]) => new Map(tiles.map((t) => [t.key, t]));

/* ══════════════════════════════════════════════════════════════════
 * KPI row — the four stages someone acts on
 * ══════════════════════════════════════════════════════════════════ */

/**
 * The four figures a manager scans first. Short names of the dashboard's own tiles; the
 * API's label is still on each card, and the whole card is still that tile's link.
 *
 * The bar is this count's share of ALL ideas (`total`) — a real proportion, since every
 * one of these four is a subset of it. Tone comes from the tokens' semantic pairs, never a
 * verdict palette: info for arrivals, warn for waiting on a person, accent for the
 * delivery stages, ok for done.
 */
const KPIS: readonly {
  key: string;
  title: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  chip: string;
  bar: string;
}[] = [
  { key: "new", title: "New ideas", icon: Sparkles, chip: "bg-state-info-bg text-state-info", bar: "bg-state-info" },
  { key: "requiring_review", title: "Waiting on review", icon: Flag, chip: "bg-state-warn-bg text-state-warn", bar: "bg-state-warn" },
  { key: "prototype", title: "Prototype candidates", icon: FlaskConical, chip: "bg-accent-100 text-accent-700", bar: "bg-accent-600" },
  { key: "implemented", title: "Implemented", icon: CheckCircle2, chip: "bg-state-ok-bg text-state-ok", bar: "bg-state-ok" },
];

function KpiRow({ tiles }: { tiles: DashboardResponse["tiles"] }) {
  const map = byKey(tiles);
  const total = map.get("total")?.count ?? 0;

  return (
    <section aria-label="Key figures" className="motion-reveal grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      {KPIS.map((k) => {
        const tile = map.get(k.key);
        if (!tile) return null;
        const share = total > 0 ? tile.count / total : 0;
        return (
          <Link
            key={k.key}
            to={tile.href}
            aria-label={`${k.title}: ${tile.count}. ${Math.round(share * 100)}% of all ideas.`}
            className={`motion-reveal flex flex-col gap-3 p-4 no-underline transition-all duration-[var(--dur-base)] hover:-translate-y-0.5 hover:shadow-e3 sm:p-5 ${PANEL}`}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="text-200 font-semibold text-muted-foreground">{k.title}</span>
              <span aria-hidden className={`grid size-8 shrink-0 place-items-center rounded-lg ${k.chip}`}>
                <k.icon aria-hidden className="size-4" />
              </span>
            </span>
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span className={`text-700 font-extrabold leading-none tracking-tight tabular-nums ${tile.count > 0 ? "text-foreground" : "text-muted-foreground"}`}>
                <TileCount value={tile.count} />
              </span>
              <span className="text-100 text-muted-foreground">
                {total > 0 ? `${Math.round(share * 100)}% of all ideas` : "No ideas yet"}
              </span>
            </span>
            <span aria-hidden className="block h-1.5 overflow-hidden rounded-full bg-muted">
              <span
                className={`block h-full rounded-full ${k.bar}`}
                style={{ width: `${tile.count > 0 ? Math.max(3, share * 100) : 0}%` }}
              />
            </span>
          </Link>
        );
      })}
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════
 * Top opportunities — the head of the board, each row with its reason
 * ══════════════════════════════════════════════════════════════════ */

const TOP_N = 5;
const COLS = "grid-cols-[2.5rem_minmax(0,1fr)_auto] md:grid-cols-[2.5rem_minmax(0,1fr)_13.5rem_6rem_6.5rem]";

function TopOpportunities({ board, pending }: { board: ListRankingsResponse | undefined; pending: boolean }) {
  const rows = (board?.items ?? []).filter((e) => e.rank <= TOP_N).sort((a, b) => a.rank - b.rank);

  return (
    <section className={`min-w-0 overflow-hidden ${PANEL}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-3 pt-4.5">
        <div>
          <h2 className="text-400 font-extrabold">Top opportunities</h2>
          <p className="mt-0.5 text-100 text-muted-foreground">
            {board ? `${board.run.profileName} profile · ` : ""}every row shows why it ranks where it does
          </p>
        </div>
        <Link to="/rankings" className="inline-flex items-center gap-1 text-200 font-bold">
          Full board <ArrowRight aria-hidden className="size-3.5" />
        </Link>
      </div>

      {pending ? (
        <div className="space-y-2 px-5 pb-5" aria-busy="true">
          {Array.from({ length: TOP_N }, (_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : rows.length === 0 ? (
        <p className="border-t border-border px-5 py-6 text-200 text-muted-foreground">
          Nothing is ranked yet. Ideas join the board once their analysis is scored.
        </p>
      ) : (
        <>
          <div
            aria-hidden
            className={`grid ${COLS} gap-3 border-y border-border bg-muted/60 px-5 py-2 text-100 font-bold uppercase tracking-[0.06em] text-muted-foreground`}
          >
            <span>Rank</span>
            <span>Idea · why it ranks here</span>
            <span className="hidden md:block">Feasibility</span>
            <span className="text-right md:text-left">Score</span>
            <span className="hidden md:block">Since last run</span>
          </div>
          <ol className="m-0 list-none p-0">
            {rows.map((r) => (
              <li key={r.ideaId} className="border-b border-border last:border-b-0">
                <Link
                  to={`/ideas/${r.ideaId}/evaluation`}
                  className={`grid ${COLS} items-center gap-3 px-5 py-3 text-foreground no-underline transition-colors duration-[var(--dur-fast)] hover:bg-muted/50`}
                >
                  <span
                    className={`grid size-8 place-items-center rounded-lg text-200 font-extrabold tabular-nums ${
                      r.rank === 1
                        ? "bg-accent-600 text-grad-ink shadow-e1"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    <span className="sr-only">Rank </span>
                    {r.rank}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-200 font-bold">{r.title}</span>
                    <span className="mt-0.5 block truncate text-100 text-muted-foreground">
                      {r.department ?? "No department"}
                      {r.topStrength ? (
                        <>
                          {" · "}
                          <span className="font-semibold text-factor-up">▲ {r.topStrength.criterionLabel}</span>
                        </>
                      ) : null}
                    </span>
                  </span>
                  <span className="hidden whitespace-nowrap md:block">
                    {r.feasibilityStatus ? (
                      <StatusPill
                        kind="FEASIBILITY"
                        feasibility={r.feasibilityStatus as never}
                        label={FEASIBILITY_LABEL[r.feasibilityStatus as keyof typeof FEASIBILITY_LABEL] ?? r.feasibilityStatus}
                      />
                    ) : (
                      <span className="text-100 text-muted-foreground">Not assessed</span>
                    )}
                  </span>
                  <span className="flex items-center justify-end gap-2 md:justify-start">
                    <MiniRing value={r.compositeScore} />
                    <span className="text-300 font-extrabold tabular-nums">{r.compositeScore.toFixed(1)}</span>
                    <span className="sr-only"> out of 100</span>
                  </span>
                  <span className="hidden md:block">
                    {r.previousRank === null ? (
                      <span className="text-100 font-semibold text-muted-foreground">New entry</span>
                    ) : (
                      <RankDelta rank={r.rank} previousRank={r.previousRank} />
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

/** A score as a thin dial beside its number — the ramp, never a verdict colour (P-1). */
function MiniRing({ value }: { value: number }) {
  const c = 2 * Math.PI * 15;
  const filled = (Math.max(0, Math.min(100, value)) / 100) * c;
  return (
    <svg aria-hidden viewBox="0 0 36 36" className="size-8 shrink-0 -rotate-90">
      <circle cx="18" cy="18" r="15" fill="none" strokeWidth="4" className="stroke-muted" />
      <circle
        cx="18" cy="18" r="15" fill="none" strokeWidth="4" strokeLinecap="round"
        strokeDasharray={`${filled} ${c}`}
        className="stroke-accent-600"
      />
    </svg>
  );
}

/* ══════════════════════════════════════════════════════════════════
 * Pipeline — all nine counts, each a link
 * ══════════════════════════════════════════════════════════════════ */

/**
 * The nine counts of requirements.md §29, as one funnel. All nine stay here and stay
 * links — the requirement is the count, not the layout. Each bar is that count against
 * `total`; the counts overlap (an idea can be top-ranked AND waiting on review), so the
 * bars are read one at a time, never as slices of a whole.
 *
 * Keyed by the API's tile key: a tile added to the API without an entry here does not
 * render, which is a visible omission rather than a silently mis-coloured count.
 */
const PIPELINE: readonly { key: string; fill: string }[] = [
  { key: "total", fill: "bg-state-neutral" },
  { key: "new", fill: "bg-state-info" },
  { key: "under_evaluation", fill: "bg-ramp-4" },
  { key: "requiring_review", fill: "bg-state-warn" },
  { key: "top_ranked", fill: "bg-accent-600" },
  { key: "prototype", fill: "bg-ramp-5" },
  { key: "pilot", fill: "bg-ramp-5" },
  { key: "implemented", fill: "bg-state-ok" },
  { key: "parked", fill: "bg-state-neutral" },
];

function Pipeline({ tiles }: { tiles: DashboardResponse["tiles"] }) {
  const map = byKey(tiles);
  const total = Math.max(1, map.get("total")?.count ?? 0);

  return (
    <section className={`p-5 ${PANEL}`}>
      <h2 className="text-400 font-extrabold">Pipeline</h2>
      <p className="mt-0.5 text-100 text-muted-foreground">Where every idea is right now</p>
      <ul className="mt-4 flex list-none flex-col gap-1 p-0">
        {PIPELINE.map((s) => {
          const tile = map.get(s.key);
          if (!tile) return null;
          return (
            <li key={s.key}>
              <Link
                to={tile.href}
                className="grid grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)_2.25rem] items-center gap-3 rounded-lg px-1.5 py-1.5 text-100 text-foreground no-underline transition-colors duration-[var(--dur-fast)] hover:bg-muted/60"
              >
                <span className="truncate font-semibold text-muted-foreground">{tile.label}</span>
                <span aria-hidden className="block h-2.5 overflow-hidden rounded-full bg-muted">
                  <span
                    className={`block h-full rounded-full ${s.fill}`}
                    style={{ width: `${tile.count > 0 ? Math.min(100, Math.max(3, (tile.count / total) * 100)) : 0}%` }}
                  />
                </span>
                <span className={`text-right text-200 font-extrabold tabular-nums ${tile.count > 0 ? "" : "text-muted-foreground"}`}>
                  {tile.count}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════
 * Needs your attention — only what the data actually says
 * ══════════════════════════════════════════════════════════════════ */

interface AttentionItem {
  id: string;
  title: string;
  note: string;
  href: string;
  dot: string;
}

/**
 * The mockup's attention list had items nothing computes ("pilot has no KPI measured",
 * "2 similar ideas in Finance") — those are not aggregated anywhere and are left out. What
 * is here is derived from the tiles and the board already on the page, and each item links
 * to the same list its number came from.
 */
function Attention({ tiles, board }: { tiles: DashboardResponse["tiles"]; board: ListRankingsResponse | undefined }) {
  const map = byKey(tiles);
  const items: AttentionItem[] = [];
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

  const review = map.get("requiring_review");
  if (review && review.count > 0) {
    items.push({
      id: "review",
      title: `${review.count} ${plural(review.count, "idea is", "ideas are")} waiting for a reviewer`,
      note: "Scored by the engine; a person has not validated them yet",
      href: review.href,
      dot: "bg-state-warn",
    });
  }
  const fresh = map.get("new");
  if (fresh && fresh.count > 0) {
    items.push({
      id: "new",
      title: `${fresh.count} new ${plural(fresh.count, "idea", "ideas")} not yet analysed`,
      note: "Analysis starts automatically after submission",
      href: fresh.href,
      dot: "bg-state-info",
    });
  }
  const pilot = map.get("pilot");
  if (pilot && pilot.count > 0) {
    items.push({
      id: "pilot",
      title: `${pilot.count} ${plural(pilot.count, "pilot is", "pilots are")} running`,
      note: "Record KPI measurements on each idea's Delivery tab",
      href: pilot.href,
      dot: "bg-ramp-5",
    });
  }
  const fallers = (board?.items ?? []).filter(
    (e) => e.rank <= 10 && e.previousRank !== null && e.previousRank < e.rank,
  ).length;
  if (fallers > 0) {
    items.push({
      id: "fallers",
      title: `${fallers} top-ten ${plural(fallers, "idea", "ideas")} lost ground on the last run`,
      note: "Open the board to see what changed",
      href: "/rankings?rankBand=top10",
      dot: "bg-factor-down",
    });
  }

  return (
    <section className={`p-5 ${PANEL}`}>
      <h2 className="text-400 font-extrabold">Needs your attention</h2>
      {items.length === 0 ? (
        <p className="mt-3 text-200 text-muted-foreground">Nothing is waiting on anyone right now.</p>
      ) : (
        <ul className="mt-3.5 flex list-none flex-col gap-2.5 p-0">
          {items.map((a) => (
            <li key={a.id}>
              <Link
                to={a.href}
                className="flex items-start gap-3 rounded-xl border border-border bg-muted/50 p-3 text-foreground no-underline transition-colors duration-[var(--dur-fast)] hover:bg-muted"
              >
                <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${a.dot}`} />
                <span className="min-w-0">
                  <span className="block text-200 font-bold">{a.title}</span>
                  <span className="mt-0.5 block text-100 text-muted-foreground">{a.note}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════
 * Recent activity — what moved most recently
 * ══════════════════════════════════════════════════════════════════ */

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();

/**
 * The six most recently touched ideas (`/ideas?sort=recent`, the same endpoint and sort
 * Explore offers). `updatedAt` is a real field; this does not claim to know WHO made the
 * last change — the list row carries the submitter, so that is who is named, as the
 * idea's owner. Titled "Recently updated", not "Recent activity": it is one line per idea,
 * not a feed of what people did, and the old title promised the latter.
 */
function RecentActivity() {
  const recent = useIdeaList({ sort: "recent", perPage: 6 });

  return (
    <section className={`min-w-0 p-5 ${PANEL}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-400 font-extrabold">Recently updated</h2>
        <Link to="/ideas?sort=recent" className="inline-flex items-center gap-1 text-200 font-bold">
          See everything <ArrowRight aria-hidden className="size-3.5" />
        </Link>
      </div>

      {recent.isPending ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2" aria-busy="true">
          {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : recent.isError || recent.data.items.length === 0 ? (
        <p className="mt-3 text-200 text-muted-foreground">No recent activity to show.</p>
      ) : (
        <ul className="mt-4 grid list-none gap-x-6 gap-y-3.5 p-0 sm:grid-cols-2">
          {recent.data.items.map((idea) => (
            <li key={idea.id} className="flex min-w-0 items-start gap-3">
              <span
                aria-hidden
                className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-100 text-100 font-extrabold text-accent-700"
              >
                {initials(idea.submitter.displayName)}
              </span>
              <span className="min-w-0 text-200 leading-snug">
                <Link to={`/ideas/${idea.id}/overview`} className="block truncate font-bold">
                  {idea.title}
                </Link>
                <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-100 text-muted-foreground">
                  <StatusPill kind="LIFECYCLE" status={idea.status} label={STATUS_LABEL[idea.status]} />
                  <span>
                    {idea.submitter.displayName}&rsquo;s idea · updated {ago(idea.updatedAt)}
                  </span>
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════
 * Ideas by department (P14 analytics)
 * ══════════════════════════════════════════════════════════════════ */

function ByDepartment({ rows }: { rows: AnalyticsResponse["byDepartment"] }) {
  const top = [...rows].sort((a, b) => b.ideas - a.ideas).slice(0, 6);
  if (top.length === 0) return null;
  const max = Math.max(1, ...top.map((r) => r.ideas));

  return (
    <section className={`min-w-0 p-5 ${PANEL}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-400 font-extrabold">Ideas by department</h2>
        <Link to="/analytics" className="inline-flex items-center gap-1 text-200 font-bold">
          Analytics <ArrowRight aria-hidden className="size-3.5" />
        </Link>
      </div>
      <ul className="mt-4 flex h-40 list-none items-end gap-3 p-0">
        {top.map((r) => {
          const bar = (
            <>
              <span className="text-100 font-extrabold tabular-nums">{r.ideas}</span>
              <span
                aria-hidden
                className="block w-full max-w-10 rounded-t-lg rounded-b-sm border border-accent-600/45 bg-accent-600/20"
                style={{ height: `${Math.max(6, (r.ideas / max) * 70)}%` }}
              />
              <span className="w-full truncate text-center text-100 text-muted-foreground" title={r.name}>
                {r.name}
              </span>
            </>
          );
          const cls = "flex h-full flex-col items-center justify-end gap-1.5 text-foreground no-underline";
          return (
            <li key={r.departmentId ?? "none"} className="h-full min-w-0 flex-1">
              {r.href ? (
                <Link to={r.href} className={cls} aria-label={`${r.name}: ${r.ideas} idea${r.ideas === 1 ? "" : "s"}`}>
                  {bar}
                </Link>
              ) : (
                <span className={cls}>{bar}</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

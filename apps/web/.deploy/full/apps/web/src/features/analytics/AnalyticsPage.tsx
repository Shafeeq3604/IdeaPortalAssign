import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { BarChart3, Download } from "lucide-react";
import {
  Button, Card, CardContent, CardHeader, CardTitle, ErrorState, Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@iep/ui";
import type { AnalyticsResponse, IdeaStatus } from "@iep/contracts";
import { PageHeading } from "../../app/PageHero";
import { STATUS_LABEL } from "../ideas/api";
import { DECISION_LABEL } from "../review/api";
import { useAnalytics } from "./api";
import { analyticsCsv } from "./csv";

const link = ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
  <Link to={to} className={className}>{children}</Link>
);

const ALL = "__all__";

/**
 * Organisational analytics (P14 — FR-27).
 *
 * One page, a handful of figures, each traceable to data an earlier phase already stores
 * (see `packages/contracts/src/schemas/analytics.ts` for the derivation of every one).
 * REQUIREMENTS §32 lists "large numbers of dashboard charts" among the things not to
 * build, so this deliberately stops at what a manager would act on: where ideas are, who
 * is contributing, how long the pipeline takes, and what the humans reviewing it did.
 *
 * Filters live in the URL (SPEC §7.8), so Back and a shared link restore the same view.
 * Every idea count links to the list it counted — the links come from the API, not built
 * here, for the same reason the dashboard's tiles do.
 */
export function AnalyticsPage() {
  const [params, setParams] = useSearchParams();
  const departmentId = params.get("department") ?? undefined;
  const categoryId = params.get("category") ?? undefined;

  const query = useAnalytics({ departmentId, categoryId });
  // The unfiltered view supplies the filter options: department and category names come
  // from the same aggregate, so an option never appears for a department with no ideas.
  const options = useAnalytics({});

  const setFilter = (key: "department" | "category", value: string) => {
    const next = new URLSearchParams(params);
    if (value === ALL) next.delete(key);
    else next.set(key, value);
    setParams(next);
  };

  const download = () => {
    if (!query.data) return;
    const blob = new Blob([analyticsCsv(query.data)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `iep-analytics-${query.data.generatedAt.slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="page">
      <nav aria-label="Breadcrumb" className="crumbs">
        <Link to="/">Home</Link>  ›  <Link to="/dashboard">Dashboard</Link>  ›  Analytics
      </nav>
      <PageHeading
        icon={BarChart3}
        heading="Analytics"
        description="Where ideas are, who is contributing, how long the pipeline takes, and what reviewers decided. Every count opens the list it counted."
        actions={
          <Button variant="outline" onClick={download} disabled={!query.data}>
            <Download aria-hidden className="size-4" />
            Download CSV
          </Button>
        }
      />

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Select value={departmentId ?? ALL} onValueChange={(v) => setFilter("department", v)}>
          <SelectTrigger aria-label="Filter by department" className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All departments</SelectItem>
            {(options.data?.byDepartment ?? [])
              .flatMap((d) => (d.departmentId ? [{ id: d.departmentId, name: d.name }] : []))
              .map((d) => (
                <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
              ))}
          </SelectContent>
        </Select>
        <Select value={categoryId ?? ALL} onValueChange={(v) => setFilter("category", v)}>
          <SelectTrigger aria-label="Filter by category" className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All categories</SelectItem>
            {(options.data?.byCategory ?? [])
              .flatMap((c) => (c.categoryId ? [{ id: c.categoryId, label: c.label }] : []))
              .map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>
              ))}
          </SelectContent>
        </Select>
        {departmentId || categoryId ? (
          <Link to="/analytics" className="text-200 font-medium text-accent-700 hover:underline">
            Clear filters
          </Link>
        ) : null}
      </div>

      <Body query={query} />
    </main>
  );
}

function Body({ query }: { query: ReturnType<typeof useAnalytics> }) {
  if (query.isPending) {
    return (
      <div className="mt-6 grid gap-4 lg:grid-cols-2" aria-busy="true">
        {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-64 w-full" />)}
      </div>
    );
  }
  if (query.isError) {
    return (
      <ErrorState
        title="Could not load analytics"
        description="The ideas themselves are unaffected — this is the summary failing to load."
        onRetry={() => void query.refetch()}
        escapeTo={{ label: "Back to the dashboard", to: "/dashboard" }}
        renderLink={link}
      />
    );
  }
  const data = query.data;

  if (data.totalIdeas === 0) {
    return (
      <p className="mt-8 text-300 text-muted-foreground">
        No submitted ideas match these filters yet.
      </p>
    );
  }

  return (
    <>
      <div className="mt-6 grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <StatusBreakdown data={data} />
        <Submissions data={data} />
      </div>
      <div className="mt-4">
        <ImpactVsEffort data={data} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Departments data={data} />
        <CycleTimes data={data} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <ReviewActivity data={data} />
        <Revisions data={data} />
      </div>
      {data.byCategory.some((c) => c.categoryId !== null) ? (
        <div className="mt-4">
          <Categories data={data} />
        </div>
      ) : null}
      <p className="mt-6 text-100 text-muted-foreground">
        As of {new Date(data.generatedAt).toLocaleString()}. Drafts are not counted.
      </p>
    </>
  );
}

/* ── Where ideas are (REQUIREMENTS §18) ── */

/**
 * The lifecycle grouped into the five phases a reader actually thinks in, with EVERY phase
 * shown — an empty phase is information ("nothing has reached a reviewer yet"), and a card
 * that only drew the one non-empty bar left a reader to guess at the rest. The summary
 * sentence is plain arithmetic over the same counts. Counts link to the API's own href;
 * a status with nothing in it has nothing to link to.
 */
const PHASES: readonly {
  key: string;
  label: string;
  sentence: string;
  statuses: readonly IdeaStatus[];
  dot: string;
  bar: string;
}[] = [
  { key: "in", label: "Coming in", sentence: "still coming in", statuses: ["SUBMITTED", "AI_ANALYSIS"], dot: "bg-state-info", bar: "bg-state-info" },
  { key: "scored", label: "Ranked", sentence: "scored and ranked, waiting for a person", statuses: ["EVALUATED", "RANKED"], dot: "bg-accent-600", bar: "bg-accent-600" },
  { key: "review", label: "In review", sentence: "with a reviewer", statuses: ["UNDER_REVIEW"], dot: "bg-state-warn", bar: "bg-state-warn" },
  { key: "build", label: "Being built", sentence: "being built", statuses: ["PROTOTYPE_CANDIDATE", "PILOT", "PRODUCTION_CANDIDATE"], dot: "bg-ramp-5", bar: "bg-ramp-5" },
  { key: "done", label: "Done", sentence: "implemented", statuses: ["IMPLEMENTED"], dot: "bg-state-ok", bar: "bg-state-ok" },
];

const PAUSED: readonly IdeaStatus[] = ["NEEDS_CLARIFICATION", "PARKED", "BLOCKED", "REJECTED"];

function StatusBreakdown({ data }: { data: AnalyticsResponse }) {
  const byStatus = new Map(data.statusBreakdown.map((s) => [s.status, s]));
  const countOf = (statuses: readonly IdeaStatus[]) =>
    statuses.reduce((sum, st) => sum + (byStatus.get(st)?.count ?? 0), 0);
  const phases = PHASES.map((p) => ({ ...p, count: countOf(p.statuses) }));
  const paused = PAUSED.map((st) => byStatus.get(st)).filter((s): s is NonNullable<typeof s> => Boolean(s && s.count > 0));
  const pausedCount = paused.reduce((sum, s) => sum + s.count, 0);
  const total = data.totalIdeas;
  const biggest = phases.reduce((a, b) => (b.count > a.count ? b : a));
  const movedOn = phases.slice(2).reduce((sum, p) => sum + p.count, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Where ideas are</CardTitle>
        <p className="text-300 font-semibold text-foreground">
          {biggest.count === total
            ? `All ${total} ideas are ${biggest.sentence}.`
            : `${biggest.count} of ${total} ideas are ${biggest.sentence}.`}
        </p>
        <p className="text-200 text-muted-foreground">
          {movedOn === 0
            ? "None has reached a reviewer yet."
            : `${movedOn} ${movedOn === 1 ? "has" : "have"} moved on to a reviewer or beyond.`}
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Share of all ideas by phase — one bar, five colours, the same phases as below. */}
        <div className="flex h-3 overflow-hidden rounded-full bg-muted" aria-hidden>
          {phases.map((p) =>
            p.count > 0 ? (
              <span key={p.key} className={p.bar} style={{ width: `${(p.count / Math.max(1, total)) * 100}%` }} />
            ) : null,
          )}
        </div>

        <ol className="grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-5">
          {phases.map((p) => {
            const statuses = p.statuses.map((st) => byStatus.get(st)).filter((s): s is NonNullable<typeof s> => Boolean(s && s.count > 0));
            const only = statuses.length === 1 ? statuses[0] : undefined;
            const body = (
              <>
                <span className="flex items-center gap-1.5 whitespace-nowrap text-100 font-semibold leading-tight text-muted-foreground">
                  <span aria-hidden className={`size-2 rounded-full ${p.count > 0 ? p.dot : "bg-border"}`} />
                  {p.label}
                </span>
                <span className={`mt-1.5 block font-serif text-600 font-extrabold leading-none tabular-nums ${p.count > 0 ? "text-foreground" : "text-muted-foreground/60"}`}>
                  {p.count}
                </span>
              </>
            );
            return (
              <li
                key={p.key}
                className={`min-w-0 rounded-xl border px-2.5 py-3 ${p.count > 0 ? "border-border bg-card" : "border-dashed border-border bg-muted/40"}`}
              >
                {only ? (
                  <Link to={only.href} className="block text-foreground no-underline hover:underline" aria-label={`${p.label}: ${p.count}`}>
                    {body}
                  </Link>
                ) : (
                  body
                )}
                {statuses.length > 1 ? (
                  <ul className="mt-2 list-none space-y-0.5 p-0 text-100">
                    {statuses.map((s) => (
                      <li key={s.status}>
                        <Link to={s.href} className="text-muted-foreground hover:underline">
                          {STATUS_LABEL[s.status]} <span className="font-semibold tabular-nums text-foreground">{s.count}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ol>

        <p className="text-200 text-muted-foreground">
          {pausedCount === 0 ? (
            "Nothing is paused, blocked or turned down."
          ) : (
            <>
              Paused or stopped:{" "}
              {paused.map((s, i) => (
                <React.Fragment key={s.status}>
                  {i > 0 ? " · " : ""}
                  <Link to={s.href} className="hover:underline">
                    {STATUS_LABEL[s.status]} <span className="font-semibold tabular-nums text-foreground">{s.count}</span>
                  </Link>
                </React.Fragment>
              ))}
            </>
          )}
        </p>
      </CardContent>
    </Card>
  );
}

/* ── Submissions over the last 12 months ── */

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, 1)).toLocaleString(undefined, { month: "short", timeZone: "UTC" });
}

function Submissions({ data }: { data: AnalyticsResponse }) {
  const months = data.submissionsByMonth;
  const max = Math.max(1, ...months.map((m) => m.count));
  const total = months.reduce((s, m) => s + m.count, 0);
  const w = 360;
  const h = 150;
  const base = 128;
  const slot = w / months.length;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Submissions, last 12 months</CardTitle>
        <p className="text-200 text-muted-foreground">{total} submitted in this period</p>
      </CardHeader>
      <CardContent>
        <svg
          viewBox={`0 0 ${w} ${h}`}
          className="w-full"
          role="img"
          aria-label={`Submissions per month: ${months.map((m) => `${monthLabel(m.month)} ${m.count}`).join(", ")}.`}
        >
          <line x1="0" x2={w} y1={base} y2={base} className="stroke-border" strokeWidth="1" />
          {months.map((m, i) => {
            const barH = (m.count / max) * (base - 16);
            const x = i * slot + slot * 0.2;
            return (
              <g key={m.month}>
                <rect x={x} y={base - barH} width={slot * 0.6} height={barH} rx="2" className="fill-accent-600" />
                {m.count > 0 ? (
                  <text x={x + slot * 0.3} y={base - barH - 4} textAnchor="middle" className="fill-foreground text-[0.6rem] font-semibold">
                    {m.count}
                  </text>
                ) : null}
                <text x={x + slot * 0.3} y={h - 6} textAnchor="middle" className="fill-muted-foreground text-[0.6rem]">
                  {monthLabel(m.month)}
                </text>
              </g>
            );
          })}
        </svg>
      </CardContent>
    </Card>
  );
}

/* ── Portfolio map: impact vs effort (REQUIREMENTS §19; P20) ── */

type Quarter = "hi-easy" | "hi-hard" | "lo-easy" | "lo-hard";

/**
 * A 2×2, not a scatter (owner feedback: the scatter was hard to read). Every ranked idea
 * sits in one box, named in plain words, and the box lists them — no reading positions off
 * an axis. The split is at 50, the middle of the 0–100 scale: the box names describe where
 * an idea sits and nothing more — not a target, not a threshold anyone signed off.
 * "Ease" is the engine's effort average inverted, so higher means less effort.
 */
const QUARTERS: readonly {
  key: Quarter;
  title: string;
  hint: string;
  /** Desktop placement: impact up the rows, ease across the columns. */
  place: string;
  test: (p: { impact: number; ease: number }) => boolean;
}[] = [
  { key: "hi-easy", title: "Bigger payoff, lighter lift", hint: "Impact 50+ · ease 50+", place: "sm:col-start-2 sm:row-start-1", test: (p) => p.impact >= 50 && p.ease >= 50 },
  { key: "hi-hard", title: "Bigger payoff, heavier lift", hint: "Impact 50+ · ease under 50", place: "sm:col-start-1 sm:row-start-1", test: (p) => p.impact >= 50 && p.ease < 50 },
  { key: "lo-easy", title: "Smaller payoff, lighter lift", hint: "Impact under 50 · ease 50+", place: "sm:col-start-2 sm:row-start-2", test: (p) => p.impact < 50 && p.ease >= 50 },
  { key: "lo-hard", title: "Smaller payoff, heavier lift", hint: "Impact under 50 · ease under 50", place: "sm:col-start-1 sm:row-start-2", test: (p) => p.impact < 50 && p.ease < 50 },
];

const SHOWN_PER_BOX = 4;

function ImpactVsEffort({ data }: { data: AnalyticsResponse }) {
  const { points, profileName, computedAt } = data.impactVsEffort;
  const [expanded, setExpanded] = React.useState<Quarter | null>(null);
  const cardRef = React.useRef<HTMLDivElement>(null);

  // Home's "Portfolio map" link lands here. The card only exists once the data has
  // arrived, which is after the browser's own hash jump has already given up.
  React.useEffect(() => {
    if (window.location.hash === "#portfolio-map") cardRef.current?.scrollIntoView({ block: "start" });
  }, []);

  return (
    <Card id="portfolio-map" ref={cardRef} className="scroll-mt-20">
      <CardHeader>
        <CardTitle>Portfolio map</CardTitle>
        <p className="text-200 text-muted-foreground">
          {points.length > 0 && computedAt
            ? `Every ranked idea, sorted by how much it would deliver and how much work it takes — from the ${new Date(computedAt).toLocaleDateString()} ranking run (${profileName ?? "default"} profile).`
            : "No ranking run covers these ideas yet."}
        </p>
      </CardHeader>
      {points.length > 0 ? (
        <CardContent className="space-y-3">
          <div className="flex items-stretch gap-3">
            {/* The one axis a reader needs named: up means more payoff. */}
            <div aria-hidden className="hidden flex-col items-center justify-between py-2 text-100 font-semibold uppercase tracking-wide text-muted-foreground sm:flex">
              <span>More</span>
              <span className="[writing-mode:vertical-rl] rotate-180">Impact</span>
              <span>Less</span>
            </div>
            <div className="min-w-0 flex-1">
              <ul className="grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2">
                {QUARTERS.map((q) => {
                  const ideas = points.filter(q.test);
                  const open = expanded === q.key;
                  const shown = open ? ideas : ideas.slice(0, SHOWN_PER_BOX);
                  const lead = q.key === "hi-easy";
                  return (
                    <li
                      key={q.key}
                      className={`${q.place} flex flex-col rounded-2xl p-4 ring-1 ring-inset ${
                        lead ? "bg-accent-100 ring-accent-600/30" : "bg-muted/50 ring-border"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className={`text-300 font-bold ${lead ? "text-accent-700" : "text-foreground"}`}>{q.title}</h3>
                          <p className="text-100 text-muted-foreground">{q.hint}</p>
                        </div>
                        <span
                          className={`font-serif text-600 font-extrabold leading-none tabular-nums ${
                            lead ? "text-accent-700" : ideas.length === 0 ? "text-muted-foreground/60" : "text-foreground"
                          }`}
                        >
                          {ideas.length}
                        </span>
                      </div>
                      {ideas.length === 0 ? (
                        <p className="mt-3 text-200 text-muted-foreground">No ideas here.</p>
                      ) : (
                        <ol className="mt-3 flex list-none flex-col gap-1.5 p-0">
                          {shown.map((p) => (
                            <li key={p.ideaId} className="flex items-baseline gap-2 text-200">
                              <span className="w-7 shrink-0 text-100 font-semibold tabular-nums text-muted-foreground">#{p.rank}</span>
                              <Link
                                to={p.href}
                                title={`Impact ${p.impact.toFixed(0)} · ease ${p.ease.toFixed(0)}`}
                                className="min-w-0 truncate font-medium text-foreground hover:underline"
                              >
                                {p.title}
                              </Link>
                            </li>
                          ))}
                        </ol>
                      )}
                      {ideas.length > SHOWN_PER_BOX ? (
                        <Button
                          type="button"
                          variant="link"
                          size="sm"
                          className="mt-1 h-auto self-start px-0"
                          onClick={() => setExpanded(open ? null : q.key)}
                          aria-expanded={open}
                        >
                          {open ? "Show fewer" : `Show all ${ideas.length}`}
                        </Button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              <div aria-hidden className="mt-2 hidden grid-cols-2 text-center text-100 font-semibold uppercase tracking-wide text-muted-foreground sm:grid">
                <span>← More effort</span>
                <span>Less effort →</span>
              </div>
            </div>
          </div>
          <p className="text-100 text-muted-foreground">
            Impact is the average of an idea&rsquo;s value scores; ease is the average of its effort
            scores, where higher means less work. Boxes split at 50, the middle of the 0–100 scale —
            a position, not a target. Hover an idea to see its two figures.
          </p>
        </CardContent>
      ) : null}
    </Card>
  );
}

/* ── Participation by department ── */

function Departments({ data }: { data: AnalyticsResponse }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Participation by department</CardTitle>
        <p className="text-200 text-muted-foreground">
          &ldquo;Advanced&rdquo; means a person moved the idea to prototype, pilot, production or implemented.
        </p>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Department</TableHead>
              <TableHead className="text-right">Ideas</TableHead>
              <TableHead className="text-right">Contributors</TableHead>
              <TableHead className="text-right">Reviewed</TableHead>
              <TableHead className="text-right">Advanced</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.byDepartment.map((d) => (
              <TableRow key={d.departmentId ?? "none"}>
                <TableCell className="whitespace-normal">
                  {d.href ? <Link to={d.href} className="hover:underline">{d.name}</Link> : d.name}
                </TableCell>
                <TableCell className="text-right tabular-nums">{d.ideas}</TableCell>
                <TableCell className="text-right tabular-nums">{d.contributors}</TableCell>
                <TableCell className="text-right tabular-nums">{d.reviewed}</TableCell>
                <TableCell className="text-right tabular-nums">{d.advanced}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function Categories({ data }: { data: AnalyticsResponse }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Ideas by category</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Ideas</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.byCategory.map((c) => (
              <TableRow key={c.categoryId ?? "none"}>
                <TableCell className="whitespace-normal">
                  {c.href ? <Link to={c.href} className="hover:underline">{c.label}</Link> : c.label}
                </TableCell>
                <TableCell className="text-right tabular-nums">{c.ideas}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/* ── Cycle times ── */

function days(n: number): string {
  if (n < 1) return "under a day";
  return `${n.toFixed(n < 10 ? 1 : 0)} days`;
}

function CycleTimes({ data }: { data: AnalyticsResponse }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>How long the pipeline takes</CardTitle>
        <p className="text-200 text-muted-foreground">Median across the ideas that reached each step.</p>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-4">
          {data.cycleTimes.map((c) => (
            <div key={c.key} className="flex items-baseline justify-between gap-4 border-b border-border pb-3 last:border-none last:pb-0">
              <dt className="text-200">{c.label}</dt>
              <dd className="text-right">
                <span className="block text-400 font-semibold tabular-nums">
                  {c.medianDays === null ? "—" : days(c.medianDays)}
                </span>
                <span className="text-100 text-muted-foreground">
                  {c.sampleSize === 0 ? "No ideas have reached this step" : `${c.sampleSize} ${c.sampleSize === 1 ? "idea" : "ideas"}`}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

/* ── Review activity (P6) and re-evaluation outcomes (P8) ── */

function Figure({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div>
      <p className="text-500 font-semibold leading-none tabular-nums">{value}</p>
      <p className="mt-1.5 text-100 text-muted-foreground">{label}</p>
    </div>
  );
}

function ReviewActivity({ data }: { data: AnalyticsResponse }) {
  const r = data.reviewActivity;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Human review</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-5">
        <div className="grid grid-cols-3 gap-4">
          <Figure value={r.reviews} label="Reviews recorded" />
          <Figure value={r.scoreOverrides} label="Scores adjusted" />
          <Figure value={r.leadershipDecisions} label="Leadership decisions" />
        </div>
        {r.byDecision.length > 0 ? (
          <ul className="grid gap-1.5 text-200">
            {r.byDecision.map((d) => (
              <li key={d.decision} className="flex justify-between">
                <span>{DECISION_LABEL[d.decision]}</span>
                <span className="font-semibold tabular-nums">{d.count}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-200 text-muted-foreground">No reviews recorded yet.</p>
        )}
      </CardContent>
    </Card>
  );
}

function Revisions({ data }: { data: AnalyticsResponse }) {
  const r = data.revisions;
  const delta = r.medianCompositeDelta;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Revised ideas</CardTitle>
        <p className="text-200 text-muted-foreground">
          Ideas re-scored after a new version, first version against latest
          {r.profileName ? `, ${r.profileName} profile` : ""}.
        </p>
      </CardHeader>
      <CardContent className="grid gap-5">
        {r.revisedIdeas === 0 ? (
          <p className="text-200 text-muted-foreground">No idea has been revised and re-scored yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Figure value={r.revisedIdeas} label="Revised" />
            <Figure value={r.improved} label="Scored higher" />
            <Figure value={r.declined} label="Scored lower" />
            <Figure
              value={delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta.toFixed(1)}`}
              label="Median change"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

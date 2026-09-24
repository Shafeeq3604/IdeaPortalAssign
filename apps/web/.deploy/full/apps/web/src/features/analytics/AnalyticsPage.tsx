import * as React from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { BarChart3, Download } from "lucide-react";
import {
  Button, Card, CardContent, CardHeader, CardTitle, ErrorState, Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@iep/ui";
import type { AnalyticsResponse } from "@iep/contracts";
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

/* ── Ideas by status (REQUIREMENTS §18) ── */

function StatusBreakdown({ data }: { data: AnalyticsResponse }) {
  const max = Math.max(1, ...data.statusBreakdown.map((s) => s.count));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Ideas by status</CardTitle>
        <p className="text-200 text-muted-foreground">{data.totalIdeas} submitted ideas</p>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-2.5">
          {data.statusBreakdown.map((s) => (
            <li key={s.status}>
              <Link to={s.href} className="group grid grid-cols-[9rem_1fr_2.5rem] items-center gap-3 rounded-md">
                <span className="truncate text-200 group-hover:underline">{STATUS_LABEL[s.status]}</span>
                <span className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <span
                    className="block h-full rounded-full bg-accent-600"
                    style={{ width: `${(s.count / max) * 100}%` }}
                  />
                </span>
                <span className="text-right text-200 font-semibold tabular-nums">{s.count}</span>
              </Link>
            </li>
          ))}
        </ul>
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

/* ── Impact vs effort (REQUIREMENTS §19) ── */

function ImpactVsEffort({ data }: { data: AnalyticsResponse }) {
  const navigate = useNavigate();
  const { points, profileName, computedAt } = data.impactVsEffort;
  // Plot area inset: room on the left for impact ticks + label, below for ease ticks + label.
  const size = 320;
  const pad = 36;
  const top = 12;
  const plot = size - pad - top;
  const x = (ease: number) => pad + (ease / 100) * plot;
  const y = (impact: number) => top + (1 - impact / 100) * plot;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Impact vs effort</CardTitle>
        <p className="text-200 text-muted-foreground">
          {points.length > 0 && computedAt
            ? `${points.length} ranked ideas, from the ${new Date(computedAt).toLocaleDateString()} ranking run (${profileName ?? "default"} profile). Impact is the average of each idea's value-criteria scores; ease is the average of its effort-criteria scores, where higher means less effort. Dashed lines mark the middle of the 0–100 scale, not a target.`
            : "No ranking run covers these ideas yet."}
        </p>
      </CardHeader>
      {points.length > 0 ? (
        <CardContent className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_1fr] [&>*]:min-w-0">
          <svg
            viewBox={`0 0 ${size} ${size}`}
            className="w-full max-w-md"
            role="img"
            aria-label="Scatter of ranked ideas by ease (horizontal) and impact (vertical). The table beside it lists the same ideas."
          >
            <rect x={pad} y={top} width={plot} height={plot} className="fill-muted" rx="4" />
            <line x1={x(50)} x2={x(50)} y1={top} y2={top + plot} className="stroke-border" strokeDasharray="4 4" />
            <line x1={pad} x2={pad + plot} y1={y(50)} y2={y(50)} className="stroke-border" strokeDasharray="4 4" />
            {[0, 50, 100].map((t) => (
              <g key={t}>
                <text x={x(t)} y={top + plot + 12} textAnchor="middle" className="fill-muted-foreground text-[0.6rem]">{t}</text>
                <text x={pad - 6} y={y(t) + 3} textAnchor="end" className="fill-muted-foreground text-[0.6rem]">{t}</text>
              </g>
            ))}
            <text x={pad + plot / 2} y={size - 4} textAnchor="middle" className="fill-muted-foreground text-[0.6rem]">
              Ease → (less effort)
            </text>
            <text
              transform={`translate(10 ${top + plot / 2}) rotate(-90)`}
              textAnchor="middle"
              className="fill-muted-foreground text-[0.6rem]"
            >
              Impact →
            </text>
            {points.map((p) => (
              <a
                key={p.ideaId}
                href={p.href}
                aria-label={`#${p.rank} ${p.title}`}
                // In-app navigation, not a full reload; the real href keeps open-in-new-tab working.
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                  e.preventDefault();
                  void navigate(p.href);
                }}
              >
                <title>{`#${p.rank} ${p.title} — impact ${p.impact}, ease ${p.ease}`}</title>
                <circle cx={x(p.ease)} cy={y(p.impact)} r="5" className="fill-accent-600 stroke-card" strokeWidth="1.5" />
              </a>
            ))}
          </svg>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">Rank</TableHead>
                <TableHead>Idea</TableHead>
                <TableHead className="text-right">Impact</TableHead>
                <TableHead className="text-right">Ease</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {points.slice(0, 10).map((p) => (
                <TableRow key={p.ideaId}>
                  <TableCell className="tabular-nums">#{p.rank}</TableCell>
                  <TableCell className="whitespace-normal">
                    <Link to={p.href} className="hover:underline">{p.title}</Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{p.impact.toFixed(1)}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.ease.toFixed(1)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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

import * as React from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { MoreHorizontal, ScrollText, Search, Users, X } from "lucide-react";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger, Badge, Button, Card, CardContent,
  EmptyState, ErrorState, Input, Label, Skeleton, Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow,
} from "@iep/ui";
import { Role } from "@iep/contracts";
import type { AdminUser, AdminUsersResponse, AuditResponse } from "@iep/contracts";
import { AddUserDialog, EditUserDialog, RoleBadges, RoleLegend } from "./UserForms";
import { api } from "../../app/api-client";
import { queryKeys } from "../../app/query-keys";
import { InlineStat, PageHeading } from "../../app/PageHero";
import { useProfiles, useRecompute } from "../rankings/api";

const link = ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
  <Link to={to} className={className}>{children}</Link>
);

/** Header-row treatment shared by every table on this page — a token-safe stand-in for
 *  the "slate-50 / uppercase / tracking-wider" header look. */
const HEAD = "text-100 font-semibold uppercase tracking-wider text-muted-foreground";

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();

/**
 * Admin read surfaces (P9 — FR-29).
 *
 * The audit page is the one that matters. It is where "who changed this score, and why"
 * is answered, and every row links to its subject — a log you cannot navigate out of is
 * a log nobody uses.
 */

/**
 * The two ADMIN_ONLY destinations, cross-linked to each other.
 *
 * REQUIREMENTS §20 is explicit — "keep the main navigation small… do not put every
 * feature in the main navigation" — so Audit log does not get its own sidebar entry.
 * What it needs instead is a way OUT of the one admin entry the sidebar does have:
 * before this, reaching it required already knowing `/admin/audit`. This is the
 * "Administration" hub the sidebar's single link was always meant to open onto.
 */
const ADMIN_PAGES = [
  { to: "/admin/users", label: "People & access", icon: Users },
  { to: "/admin/audit", label: "Audit log", icon: ScrollText },
] as const;

/**
 * An eyebrow marking these two pages as one hub, and a real "at a glance" figure per
 * page (people counted / entries logged) — Administration was the one section of the
 * product with no summary layer at all, straight sub-nav into a raw table, while every
 * other major section now opens with some framing (visual-richness pass).
 */
function AdminSubNav({ stat }: { stat?: { value: string; label: string } }) {
  const { pathname } = useLocation();
  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <span className="text-100 font-semibold uppercase tracking-widest text-muted-foreground">
          Administration
        </span>
        {stat ? <InlineStat value={stat.value} label={stat.label} /> : null}
      </div>
      <nav aria-label="Administration" className="mt-2 flex flex-wrap gap-2">
        {ADMIN_PAGES.map((page) => {
          const active = pathname === page.to;
          return (
            <Link
              key={page.to}
              to={page.to}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "brand-pill inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-100 font-semibold text-grad-ink no-underline"
                  : "inline-flex items-center gap-1.5 rounded-full bg-card px-3 py-1.5 text-100 font-medium text-muted-foreground no-underline ring-1 ring-inset ring-border transition-colors duration-[var(--dur-fast)] hover:text-foreground"
              }
            >
              <page.icon aria-hidden className="size-3.5" />
              {page.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

const ACTION_LABEL: Record<string, string> = {
  "idea.transition": "Status changed",
  "idea.review": "Review recorded",
  "score.override": "Score adjusted",
  "ranking.recompute": "Rankings recomputed",
};

/** "Today" / "Yesterday" / a real date — the log's own timestamps stay exact in the row
 * itself (just the time, once the date is the group's own heading); this is what makes a
 * page of otherwise-identical rows scannable as "what happened, and when, at a glance"
 * (visual-richness pass — Audit log was a dense undifferentiated table). */
function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, today)) return "Today";
  if (sameDay(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

/** Consecutive entries sharing a day label, grouped without re-sorting — the API already
 * returns these newest-first, and grouping must not silently reorder what it grouped. */
function groupByDay<T extends { at: string }>(items: readonly T[]): [string, T[]][] {
  const groups: [string, T[]][] = [];
  for (const item of items) {
    const label = dayLabel(item.at);
    const last = groups.at(-1);
    if (last && last[0] === label) last[1].push(item);
    else groups.push([label, [item]]);
  }
  return groups;
}

/**
 * Recompute (FR-13, ADR-008).
 *
 * Moved here from the Dashboard (production UX review): this creates a new ranking
 * snapshot rather than summarizing one, which makes it an administrative action, not a
 * dashboard reading — and it sits beside the very audit log that records every recompute
 * it produces ("Rankings recomputed" in `ACTION_LABEL` above). Collapsed by default: an
 * action taken rarely does not need to stand open at full height next to a log people
 * check daily.
 */
function RecomputePanel() {
  const profiles = useProfiles();
  const recompute = useRecompute();
  const [profileKey, setProfileKey] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [touched, setTouched] = React.useState(false);

  /*
   * Design-audit finding: recompute moved here from the Dashboard (a form doesn't
   * belong on a summary page), but that left it reachable only by knowing it lives on
   * this specific tab, behind a collapsed panel nobody would think to open on spec.
   * `?recompute=open` — now also a "Recompute the rankings" entry in the command
   * palette — makes it a single link away from anywhere in the app instead of a thing
   * you have to already know about.
   */
  const [params, setParams] = useSearchParams();
  const wantsOpen = params.get("recompute") === "open";

  const options = profiles.data?.items ?? [];
  const active = profileKey || options.find((p) => p.isDefault)?.key || options[0]?.key || "";
  const reasonMissing = reason.trim().length === 0;

  if (options.length === 0) return null;

  return (
    <Card className="mb-6 py-0">
      <Accordion
        type="single"
        collapsible
        value={wantsOpen ? "recompute" : ""}
        onValueChange={(value) => {
          setParams((next) => {
            if (value === "recompute") next.set("recompute", "open");
            else next.delete("recompute");
            return next;
          }, { replace: true });
        }}
      >
        <AccordionItem value="recompute" className="border-none">
          <AccordionTrigger className="px-6 py-5 hover:no-underline [&>svg]:size-5">
            <span className="flex flex-col items-start text-left">
              <span className="font-medium">Recompute the rankings</span>
              <span className="text-100 font-normal text-muted-foreground">
                Creates a new snapshot from the scores as they stand now
              </span>
            </span>
          </AccordionTrigger>
          <AccordionContent className="px-6">
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                setTouched(true);
                if (reasonMissing) return;
                recompute.mutate({ profileKey: active, reason: reason.trim() });
              }}
            >
              <p className="text-200 text-muted-foreground">
                The previous run stays readable, so you can always show what the board
                said before.
              </p>

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
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </Card>
  );
}

export function AuditPage() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get("page") ?? 1));
  const entityType = params.get("entityType") ?? undefined;

  const query = useQuery({
    queryKey: queryKeys.admin.audit({ page, entityType }),
    queryFn: () => {
      const s = new URLSearchParams();
      s.set("page", String(page));
      if (entityType) s.set("entityType", entityType);
      return api<AuditResponse>(`/admin/audit?${s.toString()}`);
    },
  });

  return (
    <main className="page">
      <nav aria-label="Breadcrumb" className="crumbs">
        <Link to="/">Home</Link>  ›  Audit log
      </nav>
      <PageHeading
        icon={ScrollText}
        heading="Audit log"
        description="Append-only. Every decision a person made, in the same transaction as the change itself — the database refuses updates and deletes on this table."
      />
      <AdminSubNav
        stat={query.data ? { value: String(query.data.meta.total), label: "entries logged" } : undefined}
      />

      <RecomputePanel />

      {query.isPending ? (
        <Skeleton className="mt-6 h-96 w-full" aria-busy="true" />
      ) : query.isError ? (
        <ErrorState
          title="Could not load the audit log"
          description="The records are intact — this is the view failing to load."
          onRetry={() => void query.refetch()}
          escapeTo={{ label: "Back to ideas", to: "/ideas" }}
          renderLink={link}
        />
      ) : query.data.items.length === 0 ? (
        <EmptyState
          title="Nothing recorded yet"
          description="Status changes, reviews, score adjustments and recomputes all appear here as they happen."
          action={{ label: "Back to ideas", to: "/ideas" }}
          renderLink={link}
        />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {[undefined, "idea", "evaluation", "ranking_run"].map((type) => (
              <Link
                key={type ?? "all"}
                to={type ? `/admin/audit?entityType=${type}` : "/admin/audit"}
                onClick={(event) => {
                  event.preventDefault();
                  const next = new URLSearchParams();
                  if (type) next.set("entityType", type);
                  setParams(next);
                }}
                aria-current={entityType === type ? "true" : undefined}
                className={
                  entityType === type
                    ? "brand-pill rounded-full px-3 py-1.5 text-100 font-semibold text-grad-ink no-underline"
                    : "rounded-full bg-card px-3 py-1.5 text-100 font-medium text-muted-foreground no-underline ring-1 ring-inset ring-border transition-colors duration-[var(--dur-fast)] hover:text-foreground"
                }
              >
                {type ? type.replace("_", " ") : "Everything"}
              </Link>
            ))}
          </div>

          <Card className="overflow-hidden py-0">
            <CardContent className="overflow-x-auto p-0">
              <Table>
                <TableHeader className="bg-muted">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className={HEAD}>When</TableHead>
                    <TableHead className={HEAD}>Who</TableHead>
                    <TableHead className={HEAD}>What</TableHead>
                    <TableHead className={HEAD}>Subject</TableHead>
                    <TableHead className={HEAD}>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groupByDay(query.data.items).map(([day, entries]) => (
                    <React.Fragment key={day}>
                      {/* A day divider, not a repeated full timestamp on every row — the
                          date only has to be said once per group; the row itself only
                          needs to add the time (visual-richness pass). */}
                      <TableRow className="hover:bg-transparent">
                        <TableCell
                          colSpan={5}
                          className="border-t-0 bg-muted/60 py-2 text-100 font-semibold uppercase tracking-wide text-muted-foreground"
                        >
                          {day}
                        </TableCell>
                      </TableRow>
                      {entries.map((entry) => (
                        <TableRow key={entry.id} className="relative">
                          <TableCell className="whitespace-nowrap text-100">
                            {/* A small timeline dot, the same rail idea `Timeline` uses
                                for version history, rather than a new visual language. */}
                            <span className="inline-flex items-center gap-2">
                              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-accent-600" />
                              {new Date(entry.at).toLocaleTimeString(undefined, {
                                hour: "numeric",
                                minute: "2-digit",
                              })}
                            </span>
                          </TableCell>
                          <TableCell>
                            {entry.actor ? (
                              <Link to={`/people/${entry.actor.id}`}>{entry.actor.displayName}</Link>
                            ) : (
                              <span className="text-muted-foreground">the system</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {ACTION_LABEL[entry.action] ?? entry.action}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {/* §6.2 row 44: every row links to what it is about. */}
                            {entry.entityHref ? (
                              <Link to={entry.entityHref}>{entry.entityType}</Link>
                            ) : (
                              <span className="text-muted-foreground">{entry.entityType}</span>
                            )}
                          </TableCell>
                          <TableCell className="max-w-xs text-200">
                            {entry.reason ?? <span className="text-muted-foreground">—</span>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </React.Fragment>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <p className="mt-4 text-200 text-muted-foreground">
            Page {query.data.meta.page} of {query.data.meta.totalPages} ·{" "}
            {query.data.meta.total} entries
            {page > 1 ? (
              <>
                {" · "}
                <Link to={`/admin/audit?page=${page - 1}`}>Previous</Link>
              </>
            ) : null}
            {page < query.data.meta.totalPages ? (
              <>
                {" · "}
                <Link to={`/admin/audit?page=${page + 1}`}>Next</Link>
              </>
            ) : null}
          </p>
        </>
      )}
    </main>
  );
}

/** "REVIEWER" → "Reviewer" — the same humanising `UserForms.tsx`'s own role chips use. */
const roleLabel = (role: (typeof Role.options)[number]): string =>
  role.charAt(0) + role.slice(1).toLowerCase();

export function UsersPage() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get("page") ?? 1));
  const search = params.get("q") ?? "";
  const role = params.get("role") ?? undefined;
  const [editing, setEditing] = React.useState<AdminUser | null>(null);

  const query = useQuery({
    queryKey: queryKeys.admin.users({ page, q: search || undefined, role }),
    queryFn: () => {
      const s = new URLSearchParams();
      s.set("page", String(page));
      if (search) s.set("q", search);
      if (role) s.set("role", role);
      return api<AdminUsersResponse>(`/admin/users?${s.toString()}`);
    },
  });

  const update = (mutate: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(params);
    mutate(next);
    next.delete("page");
    setParams(next);
  };

  return (
    <main className="page">
      <nav aria-label="Breadcrumb" className="crumbs">
        <Link to="/">Home</Link>  ›  People &amp; access
      </nav>
      <PageHeading
        icon={Users}
        heading="People & access"
        description="Every person who can reach this platform, and exactly what you have trusted them to do inside it."
      />
      <AdminSubNav
        stat={query.data ? { value: String(query.data.meta.total), label: "people" } : undefined}
      />

      {/*
        Search and a role filter — the API (`AdminUsersQuery`) has carried `q`/`role`
        since P9, but nothing on this page rendered a control for either (enterprise-
        polish pass §18: "provide search, filters"). Same URL-is-the-source-of-truth
        pattern as every other filtered list (§7.8).
      */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form
          className="relative"
          onSubmit={(event) => {
            event.preventDefault();
            const value = new FormData(event.currentTarget).get("q");
            update((next) => (value ? next.set("q", String(value)) : next.delete("q")));
          }}
        >
          <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            key={search}
            name="q"
            type="search"
            defaultValue={search}
            placeholder="Search people"
            aria-label="Search people"
            className="h-9 w-56 pl-9"
          />
        </form>

        {Role.options.map((value) => (
          <Button
            key={value}
            variant="ghost"
            size="sm"
            aria-pressed={role === value}
            onClick={() => update((next) => (role === value ? next.delete("role") : next.set("role", value)))}
            className={
              role === value
                ? "brand-pill rounded-full font-semibold text-grad-ink hover:text-grad-ink"
                : "rounded-full font-medium text-muted-foreground"
            }
          >
            {roleLabel(value)}
          </Button>
        ))}

        {search || role ? (
          <Button
            variant="ghost"
            size="sm"
            className="rounded-full"
            onClick={() => setParams(new URLSearchParams())}
          >
            <X aria-hidden className="size-4" />
            Clear
          </Button>
        ) : null}

        <div className="ml-auto">
          <AddUserDialog />
        </div>
      </div>

      {query.isPending ? (
        <Skeleton className="mt-6 h-96 w-full" aria-busy="true" />
      ) : query.isError ? (
        <ErrorState
          title="Could not load the users"
          description="Accounts are unaffected — this is the list failing to load."
          onRetry={() => void query.refetch()}
          escapeTo={{ label: "Back to ideas", to: "/ideas" }}
          renderLink={link}
        />
      ) : (
        // `overflow-hidden` on the CARD, not just the scroll wrapper inside it: without
        // it the header row's square `bg-muted` corners sit flush against the card's
        // rounded ones and poke past the curve — the "gap" the corners had before.
        <Card className="mt-6 overflow-hidden py-0">
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader className="bg-muted">
                <TableRow className="hover:bg-transparent">
                  <TableHead className={HEAD}>Name &amp; email</TableHead>
                  <TableHead className={HEAD}>Roles</TableHead>
                  <TableHead className={HEAD}>Department</TableHead>
                  <TableHead className={`${HEAD} text-right`}>Submitted ideas</TableHead>
                  <TableHead className={`${HEAD} text-right`}>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.items.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <span
                          aria-hidden
                          className="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-100 font-extrabold text-accent-foreground"
                        >
                          {initials(user.displayName)}
                        </span>
                        <div className="min-w-0">
                          <span>
                            <Link to={`/people/${user.id}`} className="font-semibold">
                              {user.displayName}
                            </Link>
                            {!user.isActive ? (
                              <Badge variant="outline" className="ml-2 align-middle">Inactive</Badge>
                            ) : null}
                          </span>
                          <span className="block text-200 text-muted-foreground">{user.email}</span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell><RoleBadges roles={user.roles} /></TableCell>
                    <TableCell>
                      {user.department ? (
                        <Link to={`/departments/${user.department.id}`}>{user.department.name}</Link>
                      ) : (
                        <span className="text-muted-foreground">Not set</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {user.ideaCount}
                    </TableCell>
                    <TableCell className="text-right">
                      {/*
                        An icon trigger rather than a repeated "Manage" button down the
                        column — the label was the same word eight times, which is the
                        exact repetition an icon-only control is for. It still opens the
                        same dialog and still needs a real accessible name: an icon with
                        no name is a button a screen reader announces as nothing.
                      */}
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setEditing(user)}
                        aria-label={`Manage ${user.displayName}`}
                        className="rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <MoreHorizontal aria-hidden className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <RoleLegend />

      <EditUserDialog user={editing} onClose={() => setEditing(null)} />
    </main>
  );
}

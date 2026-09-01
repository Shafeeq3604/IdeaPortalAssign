import * as React from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { MoreHorizontal, ScrollText, Users } from "lucide-react";
import {
  Badge, Button, Card, CardContent, EmptyState, ErrorState, Skeleton, Table, TableBody,
  TableCell, TableHead, TableHeader, TableRow,
} from "@iep/ui";
import type { AdminUser, AdminUsersResponse, AuditResponse } from "@iep/contracts";
import { AddUserDialog, EditUserDialog, RoleBadges, RoleLegend } from "./UserForms";
import { api } from "../../app/api-client";
import { queryKeys } from "../../app/query-keys";

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

function AdminSubNav() {
  const { pathname } = useLocation();
  return (
    <nav aria-label="Administration" className="mb-6 flex flex-wrap gap-2">
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
  );
}

const ACTION_LABEL: Record<string, string> = {
  "idea.transition": "Status changed",
  "idea.review": "Review recorded",
  "score.override": "Score adjusted",
  "ranking.recompute": "Rankings recomputed",
};

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
        <Link to="/ideas">Ideas</Link>  ›  Audit log
      </nav>
      <AdminSubNav />
      <h1>Audit log</h1>
      <p className="muted">
        Append-only. Every decision a person made, in the same transaction as the change
        itself — the database refuses updates and deletes on this table.
      </p>

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
          <div className="mb-4 flex flex-wrap items-center gap-3">
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
                className={entityType === type ? "text-200 font-medium" : "text-200 text-muted-foreground"}
              >
                {type ? type.replace("_", " ") : "Everything"}
              </Link>
            ))}
          </div>

          <Card>
            <CardContent className="overflow-x-auto p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Who</TableHead>
                    <TableHead>What</TableHead>
                    <TableHead>Subject</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {query.data.items.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="whitespace-nowrap text-100">
                        {new Date(entry.at).toLocaleString()}
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

export function UsersPage() {
  const [params] = useSearchParams();
  const page = Math.max(1, Number(params.get("page") ?? 1));
  const [editing, setEditing] = React.useState<AdminUser | null>(null);

  const query = useQuery({
    queryKey: queryKeys.admin.users({ page }),
    queryFn: () => api<AdminUsersResponse>(`/admin/users?page=${page}`),
  });

  return (
    <main className="page">
      <nav aria-label="Breadcrumb" className="crumbs">
        <Link to="/ideas">Ideas</Link>  ›  People &amp; access
      </nav>
      <AdminSubNav />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3">
            <span
              aria-hidden
              className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"
            >
              <Users className="size-4.5" />
            </span>
            People &amp; access
          </h1>
          <p className="muted">
            Every person who can reach this platform, and exactly what you have trusted
            them to do inside it.
          </p>
        </div>
        <AddUserDialog />
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
                          <span className="block text-100 text-muted-foreground">{user.email}</span>
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

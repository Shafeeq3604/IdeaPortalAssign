import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Badge, Card, CardContent, EmptyState, ErrorState, Skeleton, Table, TableBody, TableCell,
  TableHead, TableHeader, TableRow,
} from "@iep/ui";
import type { AdminUsersResponse, AuditResponse } from "@iep/contracts";
import { api } from "../../app/api-client";
import { queryKeys } from "../../app/query-keys";

const link = ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
  <Link to={to} className={className}>{children}</Link>
);

/**
 * Admin read surfaces (P9 — FR-29).
 *
 * The audit page is the one that matters. It is where "who changed this score, and why"
 * is answered, and every row links to its subject — a log you cannot navigate out of is
 * a log nobody uses.
 */

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

  const query = useQuery({
    queryKey: queryKeys.admin.users({ page }),
    queryFn: () => api<AdminUsersResponse>(`/admin/users?page=${page}`),
  });

  return (
    <main className="page">
      <nav aria-label="Breadcrumb" className="crumbs">
        <Link to="/ideas">Ideas</Link>  ›  Users &amp; roles
      </nav>
      <h1>Users &amp; roles</h1>
      <p className="muted">
        Read-only in this milestone. Roles decide what each person can see and do.
      </p>

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
        <Card className="mt-6">
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Roles</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead className="text-right">Ideas</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.items.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <Link to={`/people/${user.id}`}>{user.displayName}</Link>
                      {!user.isActive ? (
                        <Badge variant="outline" className="ml-2">Inactive</Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-200">{user.roles.join(" · ")}</TableCell>
                    <TableCell>
                      {user.department ? (
                        <Link to={`/departments/${user.department.id}`}>{user.department.name}</Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{user.ideaCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </main>
  );
}

import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, EmptyState, ErrorState, Skeleton } from "@iep/ui";
import type { AdminUsersResponse, ListIdeasResponse } from "@iep/contracts";
import { api } from "../../app/api-client";
import { queryKeys } from "../../app/query-keys";
import { STATUS_LABEL } from "../ideas/api";

const link = ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
  <Link to={to} className={className}>{children}</Link>
);

/**
 * Person and department pages (P9 — SPEC §6.2 rows 3 and 4).
 *
 * These close the last orphans: the idea header renders its submitter and department as
 * links, and until now both landed on a placeholder. A foreign key shown as a link that
 * goes nowhere is worse than showing it as text.
 *
 * There is no `/people/{id}` endpoint in the frozen contract and inventing one would be
 * a contract change (SPEC §14.1). There does not need to be: `listIdeas` already filters
 * by submitter and by department, which is the only question either page has to answer.
 */

function ScopedList({
  title, crumb, filterKey, filterValue, emptyDescription,
}: {
  title: string;
  crumb: string;
  filterKey: "submitterId" | "departmentId";
  filterValue: string;
  emptyDescription: string;
}) {
  const filters = { [filterKey]: filterValue, sort: "recent" as const };
  const query = useQuery({
    queryKey: queryKeys.ideas.list(filters),
    queryFn: () => api<ListIdeasResponse>(`/ideas?${filterKey}=${filterValue}&sort=recent`),
    enabled: Boolean(filterValue),
  });

  return (
    <main className="page">
      <nav aria-label="Breadcrumb" className="crumbs">
        <Link to="/ideas">Ideas</Link>  ›  {crumb}
      </nav>
      <h1>{title}</h1>

      {query.isPending ? (
        <Skeleton className="mt-6 h-64 w-full" aria-busy="true" />
      ) : query.isError ? (
        <ErrorState
          title="Could not load these ideas"
          description="Nothing is lost — this is the list failing to load."
          onRetry={() => void query.refetch()}
          escapeTo={{ label: "Back to ideas", to: "/ideas" }}
          renderLink={link}
        />
      ) : query.data.items.length === 0 ? (
        <EmptyState
          title="No ideas yet"
          description={emptyDescription}
          action={{ label: "Browse all ideas", to: "/ideas" }}
          renderLink={link}
        />
      ) : (
        <>
          <p className="mb-4 text-200 text-muted-foreground">
            {query.data.meta.total} idea{query.data.meta.total === 1 ? "" : "s"}
          </p>
          <ul className="space-y-3">
            {query.data.items.map((idea) => (
              <li key={idea.id}>
                <Card>
                  <CardContent className="pt-6">
                    <h2 className="text-300 font-medium">
                      <Link to={`/ideas/${idea.id}/overview`}>{idea.title}</Link>
                    </h2>
                    <p className="text-100 text-muted-foreground">
                      {STATUS_LABEL[idea.status]}
                      {" · "}
                      <Link to={`/people/${idea.submitter.id}`}>{idea.submitter.displayName}</Link>
                      {idea.department ? (
                        <>
                          {" · "}
                          <Link to={`/departments/${idea.department.id}`}>{idea.department.name}</Link>
                        </>
                      ) : null}
                    </p>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}

export function PersonPage() {
  const { userId = "" } = useParams();

  /**
   * The name comes from the admin user list, which every signed-in role can read.
   *
   * It is a heavier query than a name lookup deserves, and the honest fix is a
   * `/people/{id}` endpoint — an additive amendment for a later phase. Until then the
   * page works and the header degrades to "This person" rather than breaking.
   */
  const people = useQuery({
    queryKey: queryKeys.admin.users({ scope: "lookup" }),
    queryFn: () => api<AdminUsersResponse>("/admin/users?perPage=100"),
    staleTime: 5 * 60_000,
    retry: false,
  });

  const person = people.data?.items.find((u) => u.id === userId);

  return (
    <ScopedList
      title={person?.displayName ?? "This person"}
      crumb={person?.displayName ?? "Person"}
      filterKey="submitterId"
      filterValue={userId}
      emptyDescription="This person has not submitted an idea yet."
    />
  );
}

export function DepartmentPage() {
  const { departmentId = "" } = useParams();

  return (
    <ScopedList
      title="Department"
      crumb="Department"
      filterKey="departmentId"
      filterValue={departmentId}
      emptyDescription="No idea has been filed against this department yet."
    />
  );
}

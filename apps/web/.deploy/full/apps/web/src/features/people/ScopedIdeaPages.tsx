import type * as React from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Building2, User } from "lucide-react";
import { Card, CardContent, EmptyState, ErrorState, Skeleton, StatusPill } from "@iep/ui";
import type { AdminUsersResponse, ListIdeasResponse } from "@iep/contracts";
import { api } from "../../app/api-client";
import { queryKeys } from "../../app/query-keys";
import { InlineStat, PageHeading } from "../../app/PageHero";
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
  title, crumb, icon, filterKey, filterValue, emptyDescription, resolveTitle,
}: {
  title: string;
  crumb: string;
  icon: React.ComponentType<{ className?: string }>;
  filterKey: "submitterId" | "departmentId";
  filterValue: string;
  emptyDescription: string;
  /**
   * Once the list loads, a better title read off its own data — the only way to name a
   * department without a `/departments/{id}` endpoint (same reasoning as `PersonPage`'s
   * admin-user lookup, §"There is no ... endpoint" above). Falls back to `title`/`crumb`
   * while the query is pending, has failed, or genuinely found nothing to read a name
   * from — never a blank heading.
   */
  resolveTitle?: (items: ListIdeasResponse["items"]) => string | undefined;
}) {
  const filters = { [filterKey]: filterValue, sort: "recent" as const };
  const query = useQuery({
    queryKey: queryKeys.ideas.list(filters),
    queryFn: () => api<ListIdeasResponse>(`/ideas?${filterKey}=${filterValue}&sort=recent`),
    enabled: Boolean(filterValue),
  });

  const resolved = query.data ? resolveTitle?.(query.data.items) : undefined;
  const heading = resolved ?? title;

  return (
    <main className="page">
      <nav aria-label="Breadcrumb" className="crumbs">
        <Link to="/ideas">Ideas</Link>  ›  {resolved ?? crumb}
      </nav>
      <PageHeading
        icon={icon}
        heading={heading}
        stats={query.data ? <InlineStat value={String(query.data.meta.total)} label="ideas" /> : undefined}
      />

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
        <ul className="space-y-3">
          {query.data.items.map((idea) => (
            <li key={idea.id}>
              <Card>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
                  <div className="min-w-0">
                    <h2 className="text-300 font-medium">
                      <Link to={`/ideas/${idea.id}/overview`}>{idea.title}</Link>
                    </h2>
                    <p className="mt-0.5 text-200 text-muted-foreground">
                      <Link to={`/people/${idea.submitter.id}`}>{idea.submitter.displayName}</Link>
                      {idea.department ? (
                        <>
                          {" · "}
                          <Link to={`/departments/${idea.department.id}`}>{idea.department.name}</Link>
                        </>
                      ) : null}
                    </p>
                  </div>
                  <StatusPill kind="LIFECYCLE" status={idea.status} label={STATUS_LABEL[idea.status]} />
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
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
      icon={User}
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
      icon={Building2}
      filterKey="departmentId"
      filterValue={departmentId}
      emptyDescription="No idea has been filed against this department yet."
      // Every idea in the list already carries its own department's name (it's how the
      // idea header links here in the first place) — reading it off the first result
      // is a real name at no extra request, not a second lookup.
      resolveTitle={(items) => items.find((i) => i.department?.id === departmentId)?.department?.name}
    />
  );
}

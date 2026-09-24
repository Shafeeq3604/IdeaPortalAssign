import type * as React from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Building2, Lightbulb, User } from "lucide-react";
import { EmptyState, ErrorState, Skeleton } from "@iep/ui";
import type { AdminUsersResponse, ListIdeasResponse } from "@iep/contracts";
import { api } from "../../app/api-client";
import { queryKeys } from "../../app/query-keys";
import { HeadingStat, PageHeading } from "../../app/PageHero";
import { IdeaCard } from "../ideas/IdeaCard";
import { PersonActivity } from "./PersonActivity";

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
  title, crumb, icon, description, filterKey, filterValue, emptyDescription, resolveTitle,
  belowHeading, showIdeaCount = true,
}: {
  title: string;
  crumb: string;
  icon: React.ComponentType<{ className?: string }>;
  /**
   * A real sentence for `PageHeading`'s left column — every other page built on
   * `PageHeading` passes one (Rankings, Explore Ideas, the review queue…), and without
   * it the row's only content is `stats` pushed hard right by `justify-between` with
   * nothing on the left to balance it, which is exactly what reads as "stray in the
   * corner" rather than "a stat beside its heading" (design-review finding).
   */
  description: string;
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
  /** Content between the heading and the ideas list — `PersonPage`'s activity summary
   *  and contribution timeline. `DepartmentPage` has none of this yet, hence optional. */
  belowHeading?: React.ReactNode;
  /**
   * False on `PersonPage`: its own Activity card, right below, already has an "Ideas
   * submitted" tile for this exact number — showing it twice in two different visual
   * languages a few pixels apart reads as a mistake, not confirmation. `DepartmentPage`
   * has no Activity card, so this is the only place its count appears.
   */
  showIdeaCount?: boolean;
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
        description={description}
        stats={
          showIdeaCount && query.data ? (
            <HeadingStat
              icon={Lightbulb}
              value={String(query.data.meta.total)}
              label={query.data.meta.total === 1 ? "idea" : "ideas"}
            />
          ) : undefined
        }
      />

      {belowHeading}

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
        // The same card every other idea in the product is shown as (`IdeaCard`,
        // `IdeaListPage.tsx`) — a hand-rolled plain-`Card` row here used to be the one
        // place an idea looked like a different, plainer product (design-review
        // finding: rich Activity tiles above, a flat list below, on the same page).
        // `ListIdeasResponse.items` IS `IdeaSummary[]`, the exact type `IdeaCard` takes
        // — no second request, no reshaping.
        <ul className="grid list-none gap-4 p-0 lg:grid-cols-2 xl:grid-cols-3">
          {query.data.items.map((idea) => (
            <li key={idea.id}>
              <IdeaCard idea={idea} />
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
      description={
        person?.department
          ? `${person.department.name} — what they've submitted, and what they've contributed elsewhere on the platform.`
          : "What they've submitted, and what they've contributed elsewhere on the platform."
      }
      filterKey="submitterId"
      filterValue={userId}
      emptyDescription="This person has not submitted an idea yet."
      belowHeading={<PersonActivity userId={userId} />}
      showIdeaCount={false}
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
      description="Every idea filed against this department, newest first."
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

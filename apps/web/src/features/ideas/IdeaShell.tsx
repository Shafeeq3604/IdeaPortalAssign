import * as React from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { Badge, Button, ErrorState, Skeleton } from "@iep/ui";
import { ROUTES } from "@iep/contracts";
import { STATUS_LABEL, useIdea, useTransition } from "./api";
import type { IdeaDetail } from "@iep/contracts";

const link = ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
  <Link to={to} className={className}>{children}</Link>
);

/** Tab order matches the nav map, so the two cannot drift (SPEC §6.2 row 6). */
const TABS = [
  { id: "idea.overview", label: "Overview", seg: "overview" },
  { id: "idea.analysis", label: "Analysis", seg: "analysis" },
  { id: "idea.evaluation", label: "Evaluation", seg: "evaluation" },
  { id: "idea.improve", label: "Improve", seg: "improve" },
  { id: "idea.history", label: "History", seg: "history" },
  { id: "idea.review", label: "Review", seg: "review" },
] as const;

/**
 * Shared header + tab bar for every idea route.
 *
 * The header renders the submitter and department as LINKS (§6.2 rows 3, 4) — a foreign
 * key shown as plain text is an orphan, and the nav test asserts against this map.
 */
export function IdeaShell({ children }: { children: (idea: IdeaDetail) => React.ReactNode }) {
  const { ideaId = "" } = useParams();
  const { pathname } = useLocation();
  const query = useIdea(ideaId);
  const transition = useTransition(ideaId);

  if (query.isPending) {
    return (
      <main className="page" aria-busy="true">
        <Skeleton className="h-8 w-2/3" />
        <div className="mt-4 space-y-3">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-40 w-full" />
        </div>
      </main>
    );
  }

  if (query.isError) {
    return (
      <main className="page">
        <ErrorState
          title="Could not open this idea"
          description="It may have been removed, or you may not have access to it."
          onRetry={() => void query.refetch()}
          escapeTo={{ label: "Back to ideas", to: "/ideas" }}
          renderLink={link}
        />
      </main>
    );
  }

  const idea = query.data;
  const canSee = (id: string): boolean => {
    const route = ROUTES.find((r) => r.id === id);
    if (!route) return false;
    // Review is privileged; the rest follow the idea itself.
    return id !== "idea.review" || idea.permissions.canReview;
  };

  return (
    <main className="page">
      <nav aria-label="Breadcrumb" className="crumbs">
        <Link to="/ideas">Ideas</Link>  ›  {idea.title}
      </nav>

      <h1>{idea.title}</h1>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Badge variant={idea.status === "DRAFT" ? "outline" : "secondary"}>
          {STATUS_LABEL[idea.status]}
        </Badge>
        <span className="text-200 text-muted-foreground tabular">
          Version {idea.currentVersionNo} of {idea.versionCount}
        </span>
        <Link to={`/people/${idea.submitter.id}`} className="text-200">
          {idea.submitter.displayName}
        </Link>
        {idea.department ? (
          <Link to={`/departments/${idea.department.id}`} className="text-200">
            {idea.department.name}
          </Link>
        ) : null}
      </div>

      <div className="mb-6 flex flex-wrap gap-2 border-b border-border pb-3">
        {TABS.filter((t) => canSee(t.id)).map((tab) => {
          const to = `/ideas/${ideaId}/${tab.seg}`;
          const active = pathname === to;
          return (
            <Link
              key={tab.id}
              to={to}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "rounded-md bg-accent px-3 py-2 text-200 font-medium text-accent-foreground"
                  : "rounded-md px-3 py-2 text-200 text-muted-foreground hover:bg-muted"
              }
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      {/* Actions the API confirmed THIS actor may take — never guessed client-side. */}
      <div className="mb-8 flex flex-wrap gap-3">
        {idea.permissions.canEdit ? (
          <Button asChild variant="outline">
            {link({ to: `/ideas/${ideaId}/revise`, children: "Edit" })}
          </Button>
        ) : null}
        {idea.permissions.canRevise ? (
          <Button asChild>
            {link({ to: `/ideas/${ideaId}/revise`, children: "Create a new version" })}
          </Button>
        ) : null}
        {idea.permissions.allowedTransitions.includes("SUBMITTED") ? (
          <Button
            disabled={transition.isPending}
            onClick={() => transition.mutate({ to: "SUBMITTED" })}
          >
            {transition.isPending ? "Submitting…" : "Submit for analysis"}
          </Button>
        ) : null}
      </div>

      {children(idea)}
    </main>
  );
}

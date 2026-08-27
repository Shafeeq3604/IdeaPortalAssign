import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Card, CardContent, CardHeader, CardTitle, DiffView, ErrorState, Skeleton,
} from "@iep/ui";
import type { IdeaVersionDetail } from "@iep/contracts";
import { api } from "../../app/api-client";
import { queryKeys } from "../../app/query-keys";

const link = ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
  <Link to={to} className={className}>{children}</Link>
);

/**
 * One frozen version, and what changed to produce it (P8 — FR-24).
 *
 * The diff is against the version BEFORE this one, not against the current version. A
 * reader on v2 wants to know what v2 changed; comparing it to v4 would answer a question
 * nobody asked.
 */

const FIELD_LABELS: Record<string, string> = {
  title: "Title",
  problemStatement: "The problem",
  description: "The idea",
  expectedUsers: "Who would use it",
  expectedOutcome: "What would change",
  existingProcess: "How it's done today",
  existingSolutions: "Existing tools",
  suggestedTechnology: "Suggested approach",
  expectedBenefits: "Expected benefits",
  estimatedCostNote: "Cost thoughts",
  references: "References",
};

function useVersion(ideaId: string, versionNo: number) {
  return useQuery({
    queryKey: queryKeys.ideas.version(ideaId, versionNo),
    queryFn: () => api<IdeaVersionDetail>(`/ideas/${ideaId}/versions/${versionNo}`),
    enabled: Boolean(ideaId) && versionNo > 0,
    // A frozen snapshot cannot change, so there is nothing to refetch.
    staleTime: Infinity,
  });
}

const contentOf = (v: IdeaVersionDetail | undefined): Record<string, string | null> =>
  v
    ? {
        title: v.title, problemStatement: v.problemStatement, description: v.description,
        expectedUsers: v.expectedUsers, expectedOutcome: v.expectedOutcome,
        existingProcess: v.existingProcess, existingSolutions: v.existingSolutions,
        suggestedTechnology: v.suggestedTechnology, expectedBenefits: v.expectedBenefits,
        estimatedCostNote: v.estimatedCostNote, references: v.references,
      }
    : {};

export function VersionPage() {
  const { ideaId = "", versionNo = "1" } = useParams();
  const n = Math.max(1, Number(versionNo));

  const current = useVersion(ideaId, n);
  // Version 1 has no predecessor; the hook stays disabled rather than 404ing.
  const previous = useVersion(ideaId, n > 1 ? n - 1 : 0);

  return (
    <main className="page">
      <nav aria-label="Breadcrumb" className="crumbs">
        <Link to="/ideas">Ideas</Link>  ›{" "}
        <Link to={`/ideas/${ideaId}/history`}>History</Link>  ›  Version {n}
      </nav>

      {current.isPending ? (
        <Skeleton className="mt-6 h-96 w-full" aria-busy="true" />
      ) : current.isError ? (
        <ErrorState
          title="Could not load this version"
          description="It may not exist. Versions are numbered from 1 upwards."
          onRetry={() => void current.refetch()}
          escapeTo={{ label: "Back to the history", to: `/ideas/${ideaId}/history` }}
          renderLink={link}
        />
      ) : (
        <>
          <h1>{current.data.title}</h1>
          <p className="mb-6 text-200 text-muted-foreground">
            Version {n} · {current.data.author.displayName} ·{" "}
            {new Date(current.data.createdAt).toLocaleString()}
            {n > 1 ? (
              <>
                {" · "}
                <Link to={`/ideas/${ideaId}/versions/${n - 1}`}>See version {n - 1}</Link>
              </>
            ) : null}
          </p>

          {current.data.changeSummary ? (
            <Card className="mb-6">
              <CardHeader><CardTitle>What the author said they changed</CardTitle></CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap">{current.data.changeSummary}</p>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>
                {n > 1 ? `What changed from version ${n - 1}` : "The submission as written"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {n > 1 && previous.isPending ? (
                <Skeleton className="h-64 w-full" />
              ) : (
                <DiffView
                  // For v1 the "before" is empty, so every filled field reads as added —
                  // which is exactly what a first version is.
                  before={n > 1 ? contentOf(previous.data) : {}}
                  after={contentOf(current.data)}
                  fieldLabels={FIELD_LABELS}
                />
              )}
            </CardContent>
          </Card>

          <p className="mt-6 text-100 text-muted-foreground">
            This snapshot is frozen. The idea as it stands now is on{" "}
            <Link to={`/ideas/${ideaId}/overview`}>its overview</Link>.
          </p>
        </>
      )}
    </main>
  );
}

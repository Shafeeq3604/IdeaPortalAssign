import { Link, useParams } from "react-router-dom";
import {
  Card, CardContent, CardHeader, CardTitle, ErrorState, Skeleton, Timeline,
} from "@iep/ui";
import { IdeaShell } from "./IdeaShell";
import { STATUS_LABEL, useIdeaHistory } from "./api";

const link = ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
  <Link to={to} className={className}>{children}</Link>
);

/**
 * History (P8 — FR-24): versions with their real deltas, and the status lane.
 *
 * The deltas are the point. P2 shipped this tab with `compositeScore: null` hardcoded
 * because P4's results did not exist yet, which made it a list of dates. Each version now
 * shows what it scored and what the version before it scored, so "my idea improved" is
 * something the screen demonstrates rather than asserts.
 */
export function HistoryTab() {
  const { ideaId = "" } = useParams();
  const history = useIdeaHistory(ideaId);

  return (
    <IdeaShell>
      {() => {
        if (history.isPending) return <Skeleton className="h-96 w-full" aria-busy="true" />;

        if (history.isError) {
          return (
            <ErrorState
              title="Could not load the history"
              description="The idea is fine — this is the history view failing to load."
              onRetry={() => void history.refetch()}
              escapeTo={{ label: "Back to the idea", to: `/ideas/${ideaId}/overview` }}
              renderLink={link}
            />
          );
        }

        /**
         * Newest first, and each entry compared with the one BELOW it.
         *
         * `listVersions` returns them in whatever order the repo chose, so the sort is
         * explicit here rather than inherited — a timeline that is subtly out of order
         * reverses every delta on the page.
         */
        const versions = [...history.data.versions].sort((a, b) => b.versionNo - a.versionNo);

        const entries = versions.map((v, i) => {
          const older = versions[i + 1];
          return {
            versionNo: v.versionNo,
            at: v.createdAt,
            author: v.author.displayName,
            changeSummary: v.changeSummary,
            compositeBefore: older?.compositeScore ?? null,
            compositeAfter: v.compositeScore,
            rankBefore: older?.rank ?? null,
            rankAfter: v.rank,
            maturity: (v.maturityLevel ?? 1) as 1 | 2 | 3 | 4 | 5,
          };
        });

        const anyEvaluated = versions.some((v) => v.compositeScore !== null);

        return (
          <div className="space-y-6">
            <Card>
              <CardHeader><CardTitle>Versions</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {!anyEvaluated ? (
                  <p className="text-200 text-muted-foreground">
                    No version has been scored yet. Scores and ranks appear here as each
                    version's analysis finishes.
                  </p>
                ) : null}

                <Timeline entries={entries} />

                <p className="text-100 text-muted-foreground">
                  Open a version to see exactly what changed:{" "}
                  {versions.map((v, i) => (
                    <span key={v.versionNo}>
                      {i > 0 ? ", " : ""}
                      <Link to={`/ideas/${ideaId}/versions/${v.versionNo}`}>
                        Version {v.versionNo}
                      </Link>
                    </span>
                  ))}
                  .
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Status changes</CardTitle></CardHeader>
              <CardContent>
                {history.data.statusHistory.length === 0 ? (
                  <p className="text-200 text-muted-foreground">
                    No status change has been recorded yet.
                  </p>
                ) : (
                  <ol className="space-y-3">
                    {history.data.statusHistory.map((entry) => (
                      <li key={entry.id} className="border-l-2 border-border pl-4">
                        <p className="text-200">
                          {entry.fromStatus ? `${STATUS_LABEL[entry.fromStatus]} → ` : ""}
                          <span className="font-medium">{STATUS_LABEL[entry.toStatus]}</span>
                        </p>
                        <p className="text-100 text-muted-foreground">
                          <Link to={`/people/${entry.actor.id}`}>{entry.actor.displayName}</Link>
                          {" · "}
                          {new Date(entry.at).toLocaleString()}
                        </p>
                        {entry.reason ? (
                          <p className="mt-1 text-200">{entry.reason}</p>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                )}
              </CardContent>
            </Card>
          </div>
        );
      }}
    </IdeaShell>
  );
}

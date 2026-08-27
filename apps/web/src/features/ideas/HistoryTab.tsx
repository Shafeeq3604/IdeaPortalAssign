import { Link, useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@iep/ui";
import { IdeaShell } from "./IdeaShell";
import { STATUS_LABEL, useIdeaHistory } from "./api";

/** History: versions and the status lane (FR-24). Evaluation deltas arrive with P8. */
export function HistoryTab() {
  const { ideaId = "" } = useParams();
  const history = useIdeaHistory(ideaId);

  return (
    <IdeaShell>
      {() => (
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Versions</CardTitle></CardHeader>
            <CardContent>
              {history.isPending ? (
                <p className="text-200 text-muted-foreground">Loading…</p>
              ) : history.isError ? (
                <p className="text-200 text-destructive">Could not load the history.</p>
              ) : (
                <ol className="space-y-4">
                  {history.data.versions.map((v) => (
                    <li key={v.id} className="border-l-2 border-border pl-4">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <Link to={`/ideas/${ideaId}/versions/${v.versionNo}`} className="font-medium">
                          Version {v.versionNo}
                        </Link>
                        <span className="text-100 text-muted-foreground">
                          {v.author.displayName} · {new Date(v.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      <p className="text-200 text-muted-foreground">
                        {v.changeSummary ?? "First version."}
                      </p>
                      {v.rank === null ? (
                        <p className="text-100 text-muted-foreground">
                          Not yet evaluated — rank and score appear once analysis runs.
                        </p>
                      ) : (
                        <p className="text-100 tabular">Rank #{v.rank} · score {v.compositeScore}</p>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Status changes</CardTitle></CardHeader>
            <CardContent>
              {history.data?.statusHistory.length ? (
                <ol className="space-y-3">
                  {history.data.statusHistory.map((h) => (
                    <li key={h.id} className="text-200">
                      <span className="font-medium">
                        {h.fromStatus ? `${STATUS_LABEL[h.fromStatus]} → ` : ""}
                        {STATUS_LABEL[h.toStatus]}
                      </span>
                      <span className="text-muted-foreground">
                        {" "}· {h.actor.displayName} · {new Date(h.at).toLocaleString()}
                      </span>
                      {h.reason ? (
                        <p className="text-muted-foreground">Reason: {h.reason}</p>
                      ) : null}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-200 text-muted-foreground">No status changes yet.</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </IdeaShell>
  );
}

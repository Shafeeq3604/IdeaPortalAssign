import { Link, useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@iep/ui";
import { IdeaShell } from "./IdeaShell";

/** Overview: the submitted content as written, before any AI touches it. */
export function OverviewTab() {
  const { ideaId = "" } = useParams();

  return (
    <IdeaShell>
      {(idea) => {
        const v = idea.currentVersion;
        const optional: readonly { label: string; value: string | null }[] = [
          { label: "How it's done today", value: v.existingProcess },
          { label: "Existing tools", value: v.existingSolutions },
          { label: "Suggested approach", value: v.suggestedTechnology },
          { label: "Expected benefits", value: v.expectedBenefits },
          { label: "Cost thoughts", value: v.estimatedCostNote },
          { label: "References", value: v.references },
        ];
        const provided = optional.filter((o) => o.value);

        return (
          <div className="space-y-6">
            <Card>
              <CardHeader><CardTitle>The problem</CardTitle></CardHeader>
              <CardContent><p className="whitespace-pre-wrap">{v.problemStatement}</p></CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>The idea</CardTitle></CardHeader>
              <CardContent><p className="whitespace-pre-wrap">{v.description}</p></CardContent>
            </Card>

            <div className="grid gap-6 md:grid-cols-2">
              <Card>
                <CardHeader><CardTitle>Who would use it</CardTitle></CardHeader>
                <CardContent><p className="whitespace-pre-wrap">{v.expectedUsers}</p></CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>What would change</CardTitle></CardHeader>
                <CardContent><p className="whitespace-pre-wrap">{v.expectedOutcome}</p></CardContent>
              </Card>
            </div>

            {provided.length > 0 ? (
              <Card>
                <CardHeader><CardTitle>Additional detail</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  {provided.map((o) => (
                    <div key={o.label}>
                      <h3 className="text-200 font-medium text-muted-foreground">{o.label}</h3>
                      <p className="whitespace-pre-wrap">{o.value}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader><CardTitle>Additional detail</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-200 text-muted-foreground">
                    None of the optional fields were filled in. That is fine — it does not
                    make this a weaker idea, but filling some in gives the analysis more to
                    work with and raises the maturity level.
                  </p>
                  {idea.permissions.canEdit || idea.permissions.canRevise ? (
                    <Link to={`/ideas/${ideaId}/revise`}>Add more detail</Link>
                  ) : null}
                </CardContent>
              </Card>
            )}
          </div>
        );
      }}
    </IdeaShell>
  );
}

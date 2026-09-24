import * as React from "react";
import { Link, useParams } from "react-router-dom";
import {
  Badge, Button, Card, CardContent, CardHeader, CardTitle, ErrorState, Input, Label,
  Skeleton, Textarea,
} from "@iep/ui";
import type { IdeaDetail, LeadershipDecisionStatus } from "@iep/contracts";
import { IdeaShell } from "../ideas/IdeaShell";
import { RECOMMENDATION_ACTION_LABEL, useAnalysis } from "../analysis/api";
import { useSession } from "../../app/use-session";
import {
  DECISION_STATUS_HELP, DECISION_STATUS_LABEL, LEADERSHIP_DECISION_STATUSES,
  useCreateLeadershipDecision, useLeadershipDecisions,
} from "./api";

const link = ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
  <Link to={to} className={className}>{children}</Link>
);

/**
 * Leadership decision tab (ADR-026).
 *
 * The final organisational decision, kept deliberately separate from the AI's own
 * Implementation Recommendation (features/analysis — the "AI Recommendation" card on the
 * Analysis tab). This page is where a human takes responsibility for what happens next;
 * that card is where the AI's advisory content is read. Neither page renders the other's
 * content — the boundary is physical, not just a label.
 *
 * Same discipline as ReviewTab: the decision is audited, so it is never applied
 * optimistically, and recording one never moves the idea's own status (P-3) — that stays
 * the separate, explicit lifecycle action it already is.
 */
export function LeadershipDecisionTab() {
  const { ideaId = "" } = useParams();
  const analysis = useAnalysis(ideaId);
  const decisions = useLeadershipDecisions(ideaId);

  return (
    <IdeaShell>
      {(idea) => {
        if (analysis.isPending || decisions.isPending) {
          return <Skeleton className="h-80 w-full" aria-busy="true" />;
        }

        if (analysis.isError || decisions.isError) {
          return (
            <ErrorState
              title="Could not load the leadership decision"
              description="The idea is fine — this view failed to load."
              onRetry={() => {
                void analysis.refetch();
                void decisions.refetch();
              }}
              escapeTo={{ label: "Back to the idea", to: `/ideas/${ideaId}/overview` }}
              renderLink={link}
            />
          );
        }

        const recommendation = analysis.data.recommendation;

        return (
          <div className="space-y-6">
            {!recommendation ? (
              <Card>
                <CardHeader><CardTitle className="font-serif">Leadership decision</CardTitle></CardHeader>
                <CardContent>
                  <p className="text-200 text-muted-foreground">
                    There is no AI implementation recommendation yet to decide on. It
                    appears on the{" "}
                    <Link to={`/ideas/${ideaId}/analysis`}>Analysis tab</Link> once the
                    analysis has run.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <>
                {/*
                  What is being decided on, restated here — not linked away — so leadership
                  reads the recommendation and its evidence in the same place they decide,
                  per ADR-026. This is a summary of the SAME AI-authored content the
                  Analysis tab's "AI Recommendation" card shows, not new content.
                */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex flex-wrap items-center gap-2 font-serif">
                      Recommendation under review
                      <Badge variant="outline">AI Recommendation</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-300 font-semibold">
                      {RECOMMENDATION_ACTION_LABEL[recommendation.recommendation]}
                    </p>
                    <p className="text-200">{recommendation.rationale}</p>
                    {recommendation.supportingEvidence.length > 0 ? (
                      <ul className="list-disc space-y-1 pl-5 text-200 text-muted-foreground">
                        {recommendation.supportingEvidence.map((e, i) => (
                          <li key={`${i}-${e.slice(0, 24)}`}>{e}</li>
                        ))}
                      </ul>
                    ) : null}
                    <p className="text-100 text-muted-foreground">
                      Full risks, assumptions and validation needs are on the{" "}
                      <Link to={`/ideas/${ideaId}/analysis`}>Analysis tab</Link>.
                    </p>
                  </CardContent>
                </Card>

                {idea.permissions.canDecideLeadership ? (
                  <DecisionForm ideaId={ideaId} recommendationId={recommendation.id} />
                ) : (
                  <SelfSubmittedNotice idea={idea} />
                )}
              </>
            )}

            <Card>
              <CardHeader><CardTitle className="font-serif">Decision history</CardTitle></CardHeader>
              <CardContent>
                {decisions.data.items.length === 0 ? (
                  <p className="text-200 text-muted-foreground">
                    No final decision has been recorded yet.
                  </p>
                ) : (
                  <ul className="space-y-4">
                    {decisions.data.items.map((d) => (
                      <li key={d.id} className="border-b border-border pb-3 last:border-b-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={d.status === "REJECTED" ? "outline" : "secondary"}>
                            {DECISION_STATUS_LABEL[d.status]}
                          </Badge>
                          <Link to={`/people/${d.decidedBy.id}`} className="text-200">
                            {d.decidedBy.displayName}
                          </Link>
                          <span className="text-100 text-muted-foreground">
                            {new Date(d.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <p className="mt-1 whitespace-pre-wrap text-200">{d.rationale}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <p className="text-100 text-muted-foreground">
              This decision is recorded in the audit trail, with who made it and why. It
              does not, by itself, change the idea's status — moving the idea forward is a
              separate, explicit action.
            </p>
          </div>
        );
      }}
    </IdeaShell>
  );
}

function SelfSubmittedNotice({ idea }: { idea: IdeaDetail }) {
  const session = useSession();
  const isOwnIdea = session.data?.user.id === idea.submitter.id;

  return (
    <Card>
      <CardHeader><CardTitle className="font-serif">Record the final decision</CardTitle></CardHeader>
      <CardContent>
        <p className="text-200 text-muted-foreground">
          {isOwnIdea
            ? "You submitted this idea, so you cannot record the final decision on it yourself — someone else in leadership needs to make this call."
            : "You do not have permission to record a leadership decision on this idea."}
        </p>
      </CardContent>
    </Card>
  );
}

function DecisionForm({
  ideaId, recommendationId,
}: {
  ideaId: string;
  recommendationId: string;
}) {
  const [status, setStatus] = React.useState<LeadershipDecisionStatus>("APPROVED");
  const [rationale, setRationale] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const create = useCreateLeadershipDecision(ideaId);

  // A final organisational decision always states why — required for every status, not
  // just one (unlike a review's rejection-only requirement).
  const reasonMissing = rationale.trim().length === 0;

  return (
    <Card>
      <CardHeader><CardTitle className="font-serif">Record the final decision</CardTitle></CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            setTouched(true);
            if (reasonMissing) return;
            create.mutate({ recommendationId, status, rationale: rationale.trim() });
          }}
        >
          <fieldset className="space-y-2">
            <legend className="text-200 font-medium">Your decision</legend>
            {LEADERSHIP_DECISION_STATUSES.map((s) => (
              <label key={s} className="flex items-start gap-3 rounded-md border border-border p-3">
                <Input
                  type="radio"
                  name="leadershipDecisionStatus"
                  value={s}
                  checked={status === s}
                  onChange={() => setStatus(s)}
                  className="mt-1 size-4"
                />
                <span>
                  <span className="block text-200 font-medium">{DECISION_STATUS_LABEL[s]}</span>
                  <span className="block text-100 text-muted-foreground">
                    {DECISION_STATUS_HELP[s]}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>

          <div>
            <Label htmlFor="field-leadershipRationale">Rationale (required)</Label>
            <Textarea
              id="field-leadershipRationale"
              value={rationale}
              onChange={(event) => setRationale(event.target.value)}
              rows={4}
              aria-invalid={touched && reasonMissing}
              aria-describedby={touched && reasonMissing ? "error-leadershipRationale" : undefined}
            />
            {touched && reasonMissing ? (
              <p id="error-leadershipRationale" role="alert" className="mt-1 text-100 text-destructive">
                A final decision always states why.
              </p>
            ) : null}
          </div>

          {create.isError ? (
            <p role="alert" className="text-100 text-destructive">
              The decision was not recorded. Nothing has changed — try again.
            </p>
          ) : null}
          {create.isSuccess ? (
            <p role="status" className="text-100 text-factor-up">
              Recorded. It appears in the history below and in the audit trail. The
              idea's status has not changed — that is a separate, explicit action.
            </p>
          ) : null}

          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? "Recording…" : "Record the final decision"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

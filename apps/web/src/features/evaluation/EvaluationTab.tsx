import { Link, useParams } from "react-router-dom";
import {
  Card, CardContent, CardHeader, CardTitle, ContributionBar, EmptyState, ErrorState,
  ExplanationPanel, RankBadge, ScoreDisplay, Skeleton,
} from "@iep/ui";
import type { CriterionGroup, CriterionScore, MaturityLevel } from "@iep/contracts";
import { ApiError } from "../../app/api-client";
import { IdeaShell } from "../ideas/IdeaShell";
import { GROUP_LABEL, MATURITY_LABEL, useEvaluation } from "./api";

const link = ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
  <Link to={to} className={className}>{children}</Link>
);

/**
 * Evaluation tab (P5 — FR-12, FR-14, FR-17).
 *
 * The screen the whole product is arguing for: a number, and immediately underneath it,
 * every part of how it was reached. The explanation is rendered INLINE — P-2 is not
 * satisfied by a "why?" link, and there is deliberately no way to render the score
 * without it here.
 */

const GROUP_ORDER: readonly CriterionGroup[] = [
  "VALUE", "FEASIBILITY", "EFFORT", "STRATEGIC", "RISK", "DEMAND",
];

export function EvaluationTab() {
  const { ideaId = "" } = useParams();
  const query = useEvaluation(ideaId);

  return (
    <IdeaShell>
      {(idea) => {
        if (query.isPending) {
          return (
            <div className="space-y-6" aria-busy="true">
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-96 w-full" />
            </div>
          );
        }

        if (query.isError) {
          /**
           * A 404 here means "not scored yet", which is a normal state for a freshly
           * submitted idea — not a failure. Showing an error page for it would make the
           * product look broken during the two minutes it is working hardest.
           */
          const notYet = query.error instanceof ApiError && query.error.status === 404;
          return notYet ? (
            <EmptyState
              title="Not evaluated yet"
              description={
                idea.status === "DRAFT"
                  ? "Submitting this idea starts the analysis, and the score follows it."
                  : "The analysis has to finish before the engine can score this idea. The Analysis tab shows how far it has got."
              }
              action={{ label: "See the analysis", to: `/ideas/${ideaId}/analysis` }}
              renderLink={link}
            />
          ) : (
            <ErrorState
              title="Could not load the evaluation"
              description="The idea is fine — this is the evaluation view failing to load."
              onRetry={() => void query.refetch()}
              escapeTo={{ label: "Back to the idea", to: `/ideas/${ideaId}/overview` }}
              renderLink={link}
            />
          );
        }

        const e = query.data;
        const byGroup = new Map<CriterionGroup, CriterionScore[]>();
        for (const score of e.criterionScores) {
          byGroup.set(score.group, [...(byGroup.get(score.group) ?? []), score]);
        }

        return (
          <div className="space-y-6">
            {/* ── the headline numbers ── */}
            <Card>
              <CardHeader><CardTitle>Score</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
                  <div>
                    <p className="text-100 text-muted-foreground">Composite</p>
                    <ScoreDisplay value={e.compositeScore} size="lg" />
                  </div>

                  {e.ranking ? (
                    <div>
                      <p className="text-100 text-muted-foreground">Position</p>
                      <RankBadge
                        rank={e.ranking.rank}
                        previousRank={e.ranking.previousRank}
                        total={e.ranking.cohortSize}
                      />
                    </div>
                  ) : null}

                  <div>
                    <p className="text-100 text-muted-foreground">Maturity</p>
                    <p className="text-300 font-medium">
                      {MATURITY_LABEL[e.maturityLevel as MaturityLevel]}
                    </p>
                  </div>
                </div>

                {/*
                  P-5: maturity is not a quality grade and is never an input to the score.
                  Saying so here is cheaper than the misreading it prevents.
                */}
                <p className="text-100 text-muted-foreground">
                  Maturity describes how completely the idea is described, not how good it
                  is. It never affects the score.
                </p>

                <p className="text-100 text-muted-foreground">
                  Scored under the{" "}
                  <Link to="/config/profiles">{e.profile.name}</Link> profile, engine{" "}
                  {e.engineVersion}, on {new Date(e.computedAt).toLocaleString()}.
                </p>
              </CardContent>
            </Card>

            {/* ── the explanation, inline (P-2) ── */}
            {e.ranking ? (
              <Card>
                <CardHeader><CardTitle>Why it ranks here</CardTitle></CardHeader>
                <CardContent>
                  <ExplanationPanel
                    strengths={e.ranking.explanation.strengths}
                    constraints={e.ranking.explanation.constraints}
                    peerComparisons={e.ranking.explanation.peerComparisons}
                    generatedBy={e.ranking.explanation.generatedBy}
                    tieBreakNote={e.ranking.explanation.tieBreakNote}
                  />
                  <p className="mt-4 text-100 text-muted-foreground">
                    From{" "}
                    <Link to={`/rankings/runs/${e.ranking.runId}`}>
                      the ranking run of {new Date(e.ranking.computedAt).toLocaleString()}
                    </Link>
                    .
                  </p>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader><CardTitle>Why it ranks here</CardTitle></CardHeader>
                <CardContent>
                  <p className="text-200 text-muted-foreground">
                    This idea has a score but has not been included in a ranking run yet.
                    The scores below already explain how that number was reached.
                  </p>
                </CardContent>
              </Card>
            )}

            {/* ── every criterion, grouped, each with its evidence ── */}
            <Card>
              <CardHeader><CardTitle>Every criterion</CardTitle></CardHeader>
              <CardContent className="space-y-6">
                <p className="text-100 text-muted-foreground">
                  Each row shows the score, the weight it carries in this profile, and what
                  the two multiply to. The contribution is what actually moved the total.
                </p>

                {GROUP_ORDER.filter((g) => byGroup.has(g)).map((group) => (
                  <section key={group}>
                    <h3 className="text-300 font-medium">{GROUP_LABEL[group]}</h3>
                    <div className="mt-1">
                      {(byGroup.get(group) ?? []).map((score) => (
                        <ContributionBar
                          key={score.criterionKey}
                          criterionKey={score.criterionKey}
                          criterionLabel={score.criterionLabel}
                          normalized={score.normalized}
                          weight={score.weight}
                          contribution={score.contribution}
                          rawBand={score.rawBand}
                          source={score.source}
                          confidence={score.confidence}
                          rationale={score.rationale}
                          evidence={score.evidence}
                          overriddenBy={
                            score.override
                              ? {
                                  name: score.override.reviewer.displayName,
                                  reason: score.override.reason,
                                }
                              : undefined
                          }
                        />
                      ))}
                    </div>
                  </section>
                ))}

                <p className="text-100 text-muted-foreground">
                  Weights come from the{" "}
                  <Link to="/config/profiles">{e.profile.name}</Link> profile. The criteria
                  themselves are listed on{" "}
                  <Link to="/config/criteria">the criteria page</Link>.
                </p>
              </CardContent>
            </Card>
          </div>
        );
      }}
    </IdeaShell>
  );
}

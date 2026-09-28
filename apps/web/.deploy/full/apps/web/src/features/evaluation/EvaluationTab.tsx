import { Link, useParams } from "react-router-dom";
import {
  Badge, Card, CardContent, CardHeader, CardTitle, ContributionBar, EmptyState, ErrorState,
  ExplanationPanel, RankBadge, ScoreDisplay, Skeleton,
} from "@iep/ui";
import type { CriterionGroup, CriterionScore, ExistingSolutionAssessmentRef, MaturityLevel } from "@iep/contracts";
import { ApiError } from "../../app/api-client";
import { IdeaShell } from "../ideas/IdeaShell";
import { haltedBeforeAnalysisNote } from "../ideas/api";
import { GROUP_LABEL, MATURITY_HELP, MATURITY_LABEL, useEvaluation } from "./api";

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

const RECOMMENDATION_LABEL: Record<
  NonNullable<ExistingSolutionAssessmentRef["recommendation"]>, string
> = {
  BUILD: "Build — nothing in the catalogue meaningfully overlaps.",
  BUY: "Buy — an approved vendor already solves this.",
  EXTEND: "Extend — an internal system already does most of this.",
  INTEGRATE: "Integrate — reuse an existing platform capability instead of duplicating it.",
};

/**
 * A mid-scale criterion is legitimately both a top contributor and a top gap (50/100 adds
 * points AND leaves as many on the table), so the engine can list it under "What lifted
 * this idea" and "What held it back" at once — which read as the page contradicting
 * itself. It stays where it is listed first (lifted); the held-back list shows the rest.
 * If every constraint is also a strength, the list is left as the engine wrote it rather
 * than emptied (FR-14: a rank is never shown without what limits it).
 */
function withoutRepeats<T extends { criterionKey: string }>(constraints: readonly T[], strengths: readonly T[]): T[] {
  const lifted = new Set(strengths.map((s) => s.criterionKey));
  const rest = constraints.filter((c) => !lifted.has(c.criterionKey));
  return rest.length > 0 ? rest : [...constraints];
}

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
          const halted = haltedBeforeAnalysisNote(idea.status);
          return notYet ? (
            <EmptyState
              title={halted ? "Not scored" : "Not evaluated yet"}
              description={
                halted ??
                (idea.status === "DRAFT"
                  ? "Submitting this idea starts the analysis, and the score follows it."
                  : "The analysis has to finish before the engine can score this idea. The Analysis tab shows how far it has got.")
              }
              action={
                halted
                  ? { label: "Back to the idea", to: `/ideas/${ideaId}/overview` }
                  : { label: "See the analysis", to: `/ideas/${ideaId}/analysis` }
              }
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
              <CardHeader><CardTitle className="font-serif">Score</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
                  {/*
                    The composite is the single most-looked-at figure on this tab — the
                    thing every other section on the page explains — so it gets a frame,
                    not just larger type: the same ring-on-tint language the Dashboard's
                    Spotlight card uses for its own headline number (visual-richness pass).
                  */}
                  <div className="text-center">
                    <p className="text-100 text-muted-foreground">Composite</p>
                    <div className="mt-1 flex size-28 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent-050 to-accent-100 ring-4 ring-accent-050/60">
                      <ScoreDisplay value={e.compositeScore} size="lg" />
                    </div>
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
                    <p className="text-100 text-muted-foreground">
                      {MATURITY_HELP[e.maturityLevel as MaturityLevel]}
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

                {/* No raw engine version here — same reasoning as the Rankings board's
                    footnote (docs/adr/CONTRACT-LOG.md): a version string like "1.0.0"
                    reads as a leaked internal detail to anyone who isn't debugging it. */}
                <p className="text-100 text-muted-foreground">
                  Scored under the{" "}
                  <Link to="/config/profiles">{e.profile.name}</Link> profile on{" "}
                  {new Date(e.computedAt).toLocaleString()}.
                </p>

                {/*
                  Analysis links forward to this tab ("the numbers are on the Evaluation
                  tab") but nothing pointed back — someone landing here first (from the
                  Dashboard or Rankings board) had no way to reach the AI's own read of the
                  idea, only the evidence quotes each criterion cites from it. This is the
                  other half of that one pointer.
                */}
                <p className="text-100 text-muted-foreground">
                  This score is computed from the idea's{" "}
                  <Link to={`/ideas/${ideaId}/analysis`}>AI analysis</Link> — the value,
                  feasibility, and risk findings each criterion below cites.
                </p>
              </CardContent>
            </Card>

            {/*
              FR-21 (P12, AI-11) — internal build/buy/extend/integrate decision support,
              never employee-facing (REQUIREMENTS §15 draws the same line for FR-20's raw
              score) — gated on `canSeeMatchDetail`, same flag the Overview tab's plain
              similar-idea banner checks the inverse of.
            */}
            {idea.permissions.canSeeMatchDetail && idea.existingSolutionAssessment ? (
              <Card>
                <CardHeader><CardTitle className="font-serif">Existing-solution check</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {idea.existingSolutionAssessment.recommendation ? (
                    <p className="text-200">
                      <span className="font-semibold">
                        {RECOMMENDATION_LABEL[idea.existingSolutionAssessment.recommendation]}
                      </span>
                      {idea.existingSolutionAssessment.rationale
                        ? ` — ${idea.existingSolutionAssessment.rationale}`
                        : null}
                    </p>
                  ) : (
                    <p className="text-200 text-muted-foreground">
                      No model-reasoned recommendation yet — the catalogue matches below are
                      surfaced for manual review.
                    </p>
                  )}
                  {idea.existingSolutionAssessment.matches.length > 0 ? (
                    <ul className="space-y-1 text-100 text-muted-foreground">
                      {idea.existingSolutionAssessment.matches.map((m) => (
                        <li key={m.name}>
                          {m.name} <Badge variant="outline">{m.kind}</Badge>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-100 text-muted-foreground">
                      No catalogue entry matched above the configured threshold.
                    </p>
                  )}
                  <p className="text-100">
                    <Link to="/config/existing-solutions">See the full catalogue</Link>
                  </p>
                </CardContent>
              </Card>
            ) : null}

            {/*
              ── the explanation, inline (P-2) ──

              Not another `<Card>`. Score and Every-criterion either side of this ARE
              cards, deliberately, and the sameness was the problem: the one section
              that's actually this product's argument for why anyone should trust a rank
              looked exactly as important as a page footnote. A left rule in the brand
              accent and a serif heading — the same face `PageHero` uses for a page's own
              name — mark it as the section that gets read first, not last.
            */}
            {e.ranking ? (
              <section className="rounded-xl border-l-4 border-accent-600 bg-accent-050/50 p-6">
                <h2 className="font-serif text-500 font-extrabold">Why it ranks here</h2>
                <div className="mt-4">
                  <ExplanationPanel
                    strengths={e.ranking.explanation.strengths}
                    constraints={withoutRepeats(e.ranking.explanation.constraints, e.ranking.explanation.strengths)}
                    peerComparisons={e.ranking.explanation.peerComparisons}
                    generatedBy={e.ranking.explanation.generatedBy}
                    tieBreakNote={e.ranking.explanation.tieBreakNote}
                  />
                  <p className="mt-4 text-100 text-muted-foreground">
                    From{" "}
                    <Link to={`/rankings/${e.ranking.runId}`}>
                      the ranking run of {new Date(e.ranking.computedAt).toLocaleString()}
                    </Link>
                    .
                  </p>
                </div>
              </section>
            ) : (
              <section className="rounded-xl border-l-4 border-border bg-muted/40 p-6">
                <h2 className="font-serif text-500 font-extrabold">Why it ranks here</h2>
                <p className="mt-2 text-200 text-muted-foreground">
                  This idea has a score but has not been included in a ranking run yet.
                  The scores below already explain how that number was reached.
                </p>
              </section>
            )}

            {/*
              ── Evaluation profile (visual-composition pass) ──

              The "shape" of the assessment at a glance, before the itemised list below.
              Each bar is a real, already-known quantity — that group's criteria summed to
              their own `contribution` figures, the same numbers "Every criterion" shows
              per row — not a second computation and not a fabricated percentage. Sized
              against the loudest group on THIS idea, same magnitude-bar convention the
              Dashboard's pipeline tiles and board-composition panel already use, so the
              same visual language means "relative size" everywhere it appears.
            */}
            <Card>
              <CardHeader><CardTitle className="font-serif">Evaluation profile</CardTitle></CardHeader>
              <CardContent>
                <p className="text-100 text-muted-foreground">
                  How much each group of criteria contributed to the composite score.
                </p>
                <EvaluationProfile byGroup={byGroup} />
              </CardContent>
            </Card>

            {/* ── every criterion, grouped, each with its evidence ── */}
            <Card>
              <CardHeader><CardTitle className="font-serif">Every criterion</CardTitle></CardHeader>
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

/**
 * The evaluation-profile bars. `byGroup` is the exact map `EvaluationTab` already built
 * for "Every criterion" — one pass over already-fetched data, not a second fetch.
 */
function EvaluationProfile({ byGroup }: { byGroup: Map<CriterionGroup, CriterionScore[]> }) {
  const rows = GROUP_ORDER.filter((g) => byGroup.has(g)).map((group) => ({
    group,
    total: (byGroup.get(group) ?? []).reduce((sum, s) => sum + s.contribution, 0),
  }));
  const max = Math.max(1, ...rows.map((r) => r.total));

  return (
    <div className="mt-3.5 grid gap-3.5 sm:grid-cols-2">
      {rows.map(({ group, total }) => (
        <div key={group}>
          <div className="flex items-baseline justify-between gap-2 text-100">
            <span className="font-semibold text-foreground">{GROUP_LABEL[group]}</span>
            <span className="font-bold tabular-nums text-muted-foreground">
              {total.toFixed(1)} pts
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ramp-1">
            <div
              className="h-full rounded-full bg-gradient-to-r from-accent-600 to-grad-to"
              style={{ width: `${Math.max(4, (total / max) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

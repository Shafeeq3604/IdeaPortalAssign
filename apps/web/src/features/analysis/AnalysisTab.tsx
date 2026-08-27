import { Link, useParams } from "react-router-dom";
import {
  Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, ErrorState, EvidenceList,
  Provenance, Skeleton, StatusPill,
} from "@iep/ui";
import type { Band, ScoreSource, ValueDimension } from "@iep/contracts";
import { ValueDimension as ValueDimensionEnum } from "@iep/contracts";
import { IdeaShell } from "../ideas/IdeaShell";
import { AnalysisProgress } from "./AnalysisProgress";
import {
  BAND_LABEL, BAND_STEPS, DEPENDENCY_KIND_LABEL, EFFORT_LABEL, FEASIBILITY_DIMENSION_LABEL,
  FEASIBILITY_LABEL, HORIZON_LABEL, REQUIREMENT_KIND_LABEL, RISK_CATEGORY_LABEL,
  RISK_LEVEL_LABEL, TIMELINE_PHASE_LABEL, USER_COUNT_LABEL, USE_CASE_KIND_LABEL,
  VALUE_DIMENSION_LABEL, provenanceState, useAnalysis, validatedByOf,
} from "./api";

const link = ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
  <Link to={to} className={className}>{children}</Link>
);

/**
 * Analysis tab (P3 — F-03, FR-03..FR-11).
 *
 * Every AI-derived block on this page is inside `<Provenance>`. That is SPEC §7.4's
 * contract, and it is the reason this file imports the wrapper rather than styling the
 * cards itself: a block cannot be rendered here without declaring where it came from.
 *
 * Nothing on this page is a score. Bands are ordinal labels shown as filled steps, never
 * as a number or a percentage (ADR-005) — the numbers live on the Evaluation tab, where
 * the deterministic engine put them.
 */

/** Five steps, filled to the band. Ordinal, not quantitative — no number is shown. */
function BandMeter({ band }: { band: Band }) {
  const filled = BAND_STEPS[band];
  return (
    <span className="inline-flex items-center gap-2" title={BAND_LABEL[band]}>
      <span aria-hidden className="inline-flex gap-1">
        {[1, 2, 3, 4, 5].map((i) => (
          <span
            key={i}
            className={`inline-block size-2 rounded-full ${i <= filled ? "bg-primary" : "bg-muted"}`}
          />
        ))}
      </span>
      <span className="text-200 font-medium">{BAND_LABEL[band]}</span>
    </span>
  );
}

export function AnalysisTab() {
  const { ideaId = "" } = useParams();
  const query = useAnalysis(ideaId);

  return (
    <IdeaShell>
      {(idea) => {
        if (query.isPending) {
          return (
            <div className="space-y-6" aria-busy="true">
              <Skeleton className="h-64 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          );
        }

        if (query.isError) {
          return (
            <ErrorState
              title="Could not load the analysis"
              description="The idea is fine — this is the analysis view failing to load."
              onRetry={() => void query.refetch()}
              escapeTo={{ label: "Back to the idea", to: `/ideas/${ideaId}/overview` }}
              renderLink={link}
            />
          );
        }

        const a = query.data;
        const source: ScoreSource = a.run.steps.some((s) => s.usedFallback) ? "FALLBACK" : "AI";
        const hasAnything =
          a.proposal || a.useCases.length > 0 || a.valueFindings.length > 0 ||
          a.feasibility || a.risks.length > 0 || a.plan;

        if (!hasAnything) {
          return (
            <div className="space-y-6">
              <AnalysisProgress ideaId={ideaId} />
              <EmptyState
                title="No analysis yet"
                description={
                  idea.status === "DRAFT"
                    ? "This idea is still a draft. Submitting it starts the analysis."
                    : "The analysis has not produced results yet. This page updates on its own."
                }
                action={{ label: "Back to the idea", to: `/ideas/${ideaId}/overview` }}
                renderLink={link}
              />
            </div>
          );
        }

        const direct = a.useCases.filter((u) => u.kind === "DIRECT");
        const indirect = a.useCases.filter((u) => u.kind === "INDIRECT");
        const byDimension = new Map(a.valueFindings.map((v) => [v.dimension, v]));

        return (
          <div className="space-y-6">
            <AnalysisProgress ideaId={ideaId} />

            <p className="text-100 text-muted-foreground">
              Analysis of version {a.versionNo}. Everything below describes the idea — none
              of it scores or ranks it. The numbers are on the{" "}
              <Link to={`/ideas/${ideaId}/evaluation`}>Evaluation tab</Link>.
            </p>

            {/* ── Structured proposal (FR-03) ── */}
            {a.proposal ? (
              <Card>
                <CardHeader><CardTitle>The idea, restated</CardTitle></CardHeader>
                <CardContent>
                  <Provenance
                    state={provenanceState(a.proposal.provenance)}
                    validatedBy={validatedByOf(a.proposal.provenance)}
                  >
                    <div className="space-y-4">
                      <Field label="Problem" value={a.proposal.problemStatement} />
                      <Field label="Proposed solution" value={a.proposal.proposedSolution} />
                      <Field label="Who it is for" value={a.proposal.targetUsers} />
                      <Bullets label="Assumptions it rests on" items={a.proposal.assumptions} />
                      <Bullets
                        label="What is missing"
                        items={a.proposal.missingInformation}
                        // The most actionable part of the whole page (SPEC §12.3 AI-01).
                        footer={
                          idea.permissions.canEdit || idea.permissions.canRevise ? (
                            <Link to={`/ideas/${ideaId}/revise`} className="text-200">
                              Fill these in
                            </Link>
                          ) : null
                        }
                      />
                      <Bullets
                        label="Questions worth answering"
                        items={a.proposal.clarificationQuestions}
                      />
                    </div>
                  </Provenance>
                </CardContent>
              </Card>
            ) : null}

            {/* ── Use cases (FR-04) ── */}
            {a.useCases.length > 0 ? (
              <Card>
                <CardHeader><CardTitle>Where it applies</CardTitle></CardHeader>
                <CardContent>
                  <Provenance state="AI_UNVALIDATED">
                    <div className="space-y-6">
                      <UseCaseGroup
                        heading="Directly proposed"
                        blurb="What the idea explicitly asks for."
                        cases={direct}
                      />
                      <UseCaseGroup
                        heading="Also enabled"
                        blurb="What the same capability would make possible."
                        cases={indirect}
                      />
                    </div>
                  </Provenance>
                </CardContent>
              </Card>
            ) : null}

            {/* ── Value across all nine dimensions (FR-05) ── */}
            {a.valueFindings.length > 0 ? (
              <Card>
                <CardHeader><CardTitle>Business value</CardTitle></CardHeader>
                <CardContent>
                  <Provenance state="AI_UNVALIDATED">
                    <ul className="space-y-5">
                      {ValueDimensionEnum.options.map((dim: ValueDimension) => {
                        const f = byDimension.get(dim);
                        return (
                          <li key={dim}>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <h4 className="text-300 font-medium">
                                {VALUE_DIMENSION_LABEL[dim]}
                              </h4>
                              {f ? (
                                <BandMeter band={f.band} />
                              ) : (
                                <span className="text-100 text-muted-foreground">
                                  Not assessed
                                </span>
                              )}
                            </div>
                            {f ? (
                              <>
                                <p className="mt-1 text-200">{f.rationale}</p>
                                <EvidenceList evidence={f.evidence} source={source} />
                              </>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  </Provenance>
                </CardContent>
              </Card>
            ) : null}

            {/* ── Feasibility (FR-06) ── */}
            {a.feasibility ? (
              <Card>
                <CardHeader><CardTitle>Feasibility</CardTitle></CardHeader>
                <CardContent>
                  <Provenance
                    state={provenanceState(a.feasibility.provenance)}
                    validatedBy={validatedByOf(a.feasibility.provenance)}
                  >
                    <div className="space-y-4">
                      <StatusPill
                        kind="FEASIBILITY"
                        feasibility={a.feasibility.status}
                        label={FEASIBILITY_LABEL[a.feasibility.status]}
                      />
                      <p className="text-200">{a.feasibility.summary}</p>

                      {/* FR-06: a blocking verdict must show what blocks it. */}
                      {a.feasibility.constraintCitations.length > 0 ? (
                        <div>
                          <h4 className="text-200 font-medium">
                            The specific constraints cited
                          </h4>
                          <EvidenceList
                            evidence={a.feasibility.constraintCitations}
                            source={source}
                          />
                        </div>
                      ) : null}

                      <ul className="space-y-3">
                        {a.feasibility.findings.map((f) => (
                          <li key={f.dimension}>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <h4 className="text-300 font-medium">
                                {FEASIBILITY_DIMENSION_LABEL[f.dimension]}
                              </h4>
                              <BandMeter band={f.band} />
                            </div>
                            <p className="mt-1 text-200">{f.finding}</p>
                            {/* P-4: what would make it work beats what is wrong with it. */}
                            {f.condition ? (
                              <p className="mt-1 text-200 text-muted-foreground">
                                What would make this workable: {f.condition}
                              </p>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </Provenance>
                </CardContent>
              </Card>
            ) : null}

            {/* ── Risks and dependencies (FR-10) ── */}
            {a.risks.length > 0 || a.dependencies.length > 0 ? (
              <Card>
                <CardHeader><CardTitle>Risks and dependencies</CardTitle></CardHeader>
                <CardContent>
                  <Provenance state="AI_UNVALIDATED">
                    <div className="space-y-6">
                      {a.risks.length > 0 ? (
                        <ul className="space-y-4">
                          {a.risks.map((r) => (
                            <li key={r.id}>
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant="outline">{RISK_CATEGORY_LABEL[r.category]}</Badge>
                                <span className="text-100 text-muted-foreground">
                                  {RISK_LEVEL_LABEL[r.level]} risk
                                </span>
                              </div>
                              <p className="mt-1 text-200">{r.description}</p>
                              <p className="mt-1 text-200 text-muted-foreground">
                                If it happens: {r.potentialImpact}
                              </p>
                              {/* FR-10: never null — a risk without a mitigation is an
                                  obstacle, not analysis. */}
                              <p className="mt-1 text-200">
                                <span className="font-medium">What to do about it: </span>
                                {r.mitigation}
                              </p>
                            </li>
                          ))}
                        </ul>
                      ) : null}

                      {a.dependencies.length > 0 ? (
                        <div>
                          <h4 className="text-300 font-medium">Depends on</h4>
                          <ul className="mt-2 space-y-2">
                            {a.dependencies.map((d) => (
                              <li key={d.id} className="text-200">
                                <Badge variant="outline">{DEPENDENCY_KIND_LABEL[d.kind]}</Badge>{" "}
                                {d.description}
                                {d.blocking ? (
                                  <span className="text-muted-foreground"> · blocking</span>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  </Provenance>
                </CardContent>
              </Card>
            ) : null}

            {/* ── Effort, cost and timeline (FR-07, FR-08, FR-09) ── */}
            {a.plan ? (
              <Card>
                <CardHeader><CardTitle>What it would take</CardTitle></CardHeader>
                <CardContent>
                  <Provenance
                    state={provenanceState(a.plan.provenance)}
                    validatedBy={validatedByOf(a.plan.provenance)}
                  >
                    <div className="space-y-5">
                      <dl className="grid gap-4 sm:grid-cols-3">
                        <Stat label="Effort" value={EFFORT_LABEL[a.plan.effortClass]} />
                        <Stat label="Cost" value={EFFORT_LABEL[a.plan.costClass]} />
                        <Stat
                          label="Ongoing complexity"
                          value={EFFORT_LABEL[a.plan.operationalComplexity]}
                        />
                      </dl>

                      {a.plan.notes ? <p className="text-200">{a.plan.notes}</p> : null}

                      {a.plan.requirements.length > 0 ? (
                        <div>
                          <h4 className="text-300 font-medium">What is needed</h4>
                          <ul className="mt-2 space-y-2">
                            {a.plan.requirements.map((r) => (
                              <li key={r.id} className="text-200">
                                <Badge variant="outline">{REQUIREMENT_KIND_LABEL[r.kind]}</Badge>{" "}
                                {r.item}
                                {r.isMandatory ? (
                                  <span className="text-muted-foreground"> · required</span>
                                ) : null}
                                {r.detail ? (
                                  <span className="block text-muted-foreground">{r.detail}</span>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}

                      {a.plan.timeline.length > 0 ? (
                        <div>
                          <h4 className="text-300 font-medium">Rough timeline</h4>
                          {/* FR-08: the caveat is not decoration. `isPreliminary` is a
                              literal `true` in the contract precisely so this line cannot
                              be rendered without it. */}
                          <p className="text-100 text-muted-foreground">
                            Preliminary estimates, not commitments.
                          </p>
                          <ul className="mt-2 space-y-1">
                            {a.plan.timeline.map((t) => (
                              <li
                                key={t.phase}
                                className="flex items-baseline justify-between gap-3 text-200"
                              >
                                <span>{TIMELINE_PHASE_LABEL[t.phase]}</span>
                                <span className="tabular-nums text-muted-foreground">
                                  {t.minWeeks}–{t.maxWeeks} weeks
                                  {t.isPreliminary ? " (preliminary)" : ""}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  </Provenance>
                </CardContent>
              </Card>
            ) : null}
          </div>
        );
      }}
    </IdeaShell>
  );
}

/* ── Small presentational helpers, local to this page by design ── */

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <h4 className="text-100 font-medium text-muted-foreground">{label}</h4>
      <p className="whitespace-pre-wrap text-200">{value}</p>
    </div>
  );
}

function Bullets({
  label, items, footer,
}: {
  label: string;
  items: readonly string[];
  footer?: React.ReactNode;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <h4 className="text-100 font-medium text-muted-foreground">{label}</h4>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-200">
        {items.map((item, i) => (
          <li key={`${i}-${item.slice(0, 24)}`}>{item}</li>
        ))}
      </ul>
      {footer ? <div className="mt-2">{footer}</div> : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-100 text-muted-foreground">{label}</dt>
      <dd className="text-300 font-medium">{value}</dd>
    </div>
  );
}

function UseCaseGroup({
  heading, blurb, cases,
}: {
  heading: string;
  blurb: string;
  cases: readonly {
    id: string; title: string; description: string; horizon: keyof typeof HORIZON_LABEL;
    kind: keyof typeof USE_CASE_KIND_LABEL; estimatedUserCountBand: keyof typeof USER_COUNT_LABEL;
    departmentScope: readonly string[]; isSpeculative: boolean;
  }[];
}) {
  if (cases.length === 0) return null;
  return (
    <div>
      <h4 className="text-300 font-medium">{heading}</h4>
      <p className="text-100 text-muted-foreground">{blurb}</p>
      <ul className="mt-2 space-y-4">
        {cases.map((u) => (
          <li key={u.id}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-200 font-medium">{u.title}</span>
              {/* FR-04: realistic-now and potential-future must stay distinguishable. */}
              {u.isSpeculative ? <Badge variant="outline">Speculative</Badge> : null}
            </div>
            <p className="mt-1 text-200">{u.description}</p>
            <p className="mt-1 text-100 text-muted-foreground">
              {HORIZON_LABEL[u.horizon]} · {USER_COUNT_LABEL[u.estimatedUserCountBand]}
              {u.departmentScope.length > 0 ? ` · ${u.departmentScope.join(", ")}` : ""}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

import { Link, useParams } from "react-router-dom";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger, Badge, Card, CardContent,
  CardHeader, CardTitle, EmptyState, ErrorState, EvidenceList, Provenance, Skeleton, StatusPill,
} from "@iep/ui";
import type { Band, ScoreSource, ValueDimension, ValueFinding } from "@iep/contracts";
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
/**
 * Everything the nine value dimensions say identically, so it can be said once.
 *
 * A thin submission gives the model one sentence to reason from, so it returns the same
 * rationale and cites the same line for every dimension. Rendered per row that is nine
 * copies of one sentence and nine copies of one quotation — roughly two hundred words
 * carrying the information of twenty-five, on a page already accused of being a wall.
 *
 * Nothing is dropped. The comparison is exact equality across ALL findings, so a single
 * dimension with its own specific finding returns null and every row prints its own
 * again. Hoisting is the exception; per-row detail is the default.
 */
function allSame<Item, T>(items: readonly Item[], pick: (item: Item) => T): T | null {
  if (items.length < 2) return null;
  const first = JSON.stringify(pick(items[0]!));
  return items.every((item) => JSON.stringify(pick(item)) === first) ? pick(items[0]!) : null;
}

function sharedAcrossDimensions(findings: readonly ValueFinding[]): {
  rationale: string | null;
  evidence: readonly string[] | null;
} {
  const evidence = allSame(findings, (f) => f.evidence);
  return {
    rationale: allSame(findings, (f) => f.rationale),
    evidence: evidence && evidence.length > 0 ? evidence : null,
  };
}

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

        const shared = sharedAcrossDimensions(a.valueFindings);
        const sharedFinding = allSame(a.feasibility?.findings ?? [], (f) => f.finding);

        return (
          <div className="space-y-6">
            <AnalysisProgress ideaId={ideaId} />

            <p className="text-100 text-muted-foreground">
              Analysis of version {a.versionNo}. Everything below describes the idea — none
              of it scores or ranks it. The numbers are on the{" "}
              <Link to={`/ideas/${ideaId}/evaluation`}>Evaluation tab</Link>. Every AI-written
              block below is marked as such until a person checks it —{" "}
              <Link to="/help/data-and-ai">how this works</Link>.
            </p>

            {/*
              A real count the contract already carries (`IdeaDetail.openRecommendationCount`),
              not fabricated "how to improve" prose — there is no recommendation CONTENT
              anywhere in the API to render responsibly, only this count. Points at the one
              place a person can act on it (a new version) rather than asserting content
              that doesn't exist.
            */}
            {idea.openRecommendationCount > 0 ? (
              <p className="text-100 text-accent-700">
                {idea.openRecommendationCount} open recommendation
                {idea.openRecommendationCount === 1 ? "" : "s"} from past reviews, not yet
                addressed by a new version
                {idea.permissions.canRevise ? (
                  <>
                    {" — "}
                    <Link to={`/ideas/${ideaId}/revise`}>create one</Link>
                  </>
                ) : null}
                .
              </p>
            ) : null}

            {/*
              At a glance (enterprise-polish pass §12 — "understandable within 5 seconds").
              Four figures the engine already computed, surfaced before the detail cards
              rather than buried inside them — every value here is repeated, not invented,
              from the Feasibility/Use-cases/Risks/Plan cards below.
            */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {a.feasibility ? (
                <GlanceStat label="Feasibility" value={FEASIBILITY_LABEL[a.feasibility.status]} />
              ) : null}
              {a.plan ? (
                <GlanceStat label="Estimated effort" value={EFFORT_LABEL[a.plan.effortClass]} />
              ) : null}
              {a.useCases.length > 0 ? (
                <GlanceStat label="Potential use cases" value={String(a.useCases.length)} />
              ) : null}
              {a.risks.length > 0 ? (
                <GlanceStat label="Risks identified" value={String(a.risks.length)} />
              ) : null}
            </div>

            {/* ── Structured proposal (FR-03) ── */}
            {a.proposal ? (
              <Card>
                <CardHeader><CardTitle className="font-serif">The idea, restated</CardTitle></CardHeader>
                <CardContent>
                  <Provenance
                    state={provenanceState(a.proposal.provenance)}
                    validatedBy={validatedByOf(a.proposal.provenance)}
                  >
                    <div className="space-y-4">
                      {/* Problem and solution read as one pair — the situation and the fix —
                          so they sit side by side at md+ instead of each claiming a full-width
                          row before the other appears. */}
                      <div className="grid gap-4 md:grid-cols-2">
                        <Field label="Problem" value={a.proposal.problemStatement} />
                        <Field label="Proposed solution" value={a.proposal.proposedSolution} />
                      </div>
                      <Field label="Who it is for" value={a.proposal.targetUsers} />

                      {/* Three parallel, independent categories — not a narrative sequence —
                          so a wide screen shows them side by side rather than one long scroll
                          of stacked bullet lists. */}
                      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
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
                    </div>
                  </Provenance>
                </CardContent>
              </Card>
            ) : null}

            {/* ── Use cases (FR-04) ── */}
            {a.useCases.length > 0 ? (
              <Card>
                <CardHeader><CardTitle className="font-serif">Where it applies</CardTitle></CardHeader>
                <CardContent>
                  <Provenance state="AI_UNVALIDATED">
                    {/* Direct and indirect are mutually exclusive groups, not a sequence —
                        side by side at md+ for the same reason the dimension lists below are:
                        two parallel categories read faster next to each other than stacked. */}
                    <div className="grid gap-6 md:grid-cols-2">
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
                <CardHeader><CardTitle className="font-serif">Business value</CardTitle></CardHeader>
                <CardContent>
                  <Provenance state="AI_UNVALIDATED">
                    {/*
                      A composed 3×3 grid of tiles, not a divided two-column list
                      (enterprise-polish visual-richness pass — "meaningful data
                      visualization" over "a scroll of rows"). Every field that was in
                      the list is still here — this changes the composition, not the
                      information: label, meter, and whatever rationale/evidence is
                      specific to this one dimension once the shared reasoning below has
                      been hoisted out.
                    */}
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {ValueDimensionEnum.options.map((dim: ValueDimension) => {
                        const f = byDimension.get(dim);
                        return (
                          <div key={dim} className="rounded-xl border border-border bg-card p-3.5">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <h4 className="text-200 font-medium">
                                {VALUE_DIMENSION_LABEL[dim]}
                              </h4>
                              {!f ? (
                                <span className="text-100 text-muted-foreground">
                                  Not assessed
                                </span>
                              ) : null}
                            </div>
                            {f ? <div className="mt-1.5"><BandMeter band={f.band} /></div> : null}
                            {/*
                              Only what is SPECIFIC to this dimension. When the model
                              reasoned from the same sentence for all nine — which is
                              exactly what it does on a thin submission — the shared
                              reasoning is hoisted below instead of repeated nine times.
                            */}
                            {f && !shared.rationale ? (
                              <p className="mt-1.5 text-100 text-muted-foreground">{f.rationale}</p>
                            ) : null}
                            {f && !shared.evidence ? (
                              <EvidenceList evidence={f.evidence} source={source} />
                            ) : null}
                          </div>
                        );
                      })}
                    </div>

                    {shared.rationale ? (
                      <p className="mt-4 border-t border-border pt-3 text-200">
                        <span className="text-100 font-medium uppercase tracking-wider text-muted-foreground">
                          Reasoning for all nine{" "}
                        </span>
                        {shared.rationale}
                      </p>
                    ) : null}
                    {shared.evidence ? (
                      <EvidenceList evidence={shared.evidence} source={source} />
                    ) : null}
                  </Provenance>
                </CardContent>
              </Card>
            ) : null}

            {/* ── Feasibility (FR-06) ── */}
            {a.feasibility ? (
              <Card>
                <CardHeader><CardTitle className="font-serif">Feasibility</CardTitle></CardHeader>
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

                      <ul className="divide-y divide-border md:grid md:grid-cols-2 md:gap-x-8 md:divide-y-0">
                        {a.feasibility.findings.map((f) => (
                          <li
                            key={f.dimension}
                            className="border-border py-3 first:pt-0 last:pb-0 md:border-b md:py-3 md:first:pt-3 md:last:border-b-0 md:last:pb-3"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <h4 className="text-300 font-medium">
                                {FEASIBILITY_DIMENSION_LABEL[f.dimension]}
                              </h4>
                              <BandMeter band={f.band} />
                            </div>
                            {/* Same hoist as the value card: only what is specific here. */}
                            {sharedFinding === null ? (
                              <p className="mt-1 text-200">{f.finding}</p>
                            ) : null}
                            {/* P-4: what would make it work beats what is wrong with it. */}
                            {f.condition ? (
                              <p className="mt-1 text-200 text-muted-foreground">
                                What would make this workable: {f.condition}
                              </p>
                            ) : null}
                          </li>
                        ))}
                      </ul>

                      {sharedFinding === null ? null : (
                        <p className="border-t border-border pt-3 text-200">
                          <span className="text-100 font-medium uppercase tracking-wider text-muted-foreground">
                            For every dimension{" "}
                          </span>
                          {sharedFinding}
                        </p>
                      )}
                    </div>
                  </Provenance>
                </CardContent>
              </Card>
            ) : null}

            {/* ── Risks and dependencies (FR-10) ── */}
            {a.risks.length > 0 || a.dependencies.length > 0 ? (
              <Card className="py-0">
                <Provenance state="AI_UNVALIDATED">
                  {/*
                    Collapsed by default (enterprise-polish pass §12 — "do not present a
                    huge wall of AI-generated text"). Each risk carries its own mitigation
                    paragraph, which made this the single longest card on the tab; a
                    reviewer scanning the page needs to know a risk EXISTS before they
                    need the full mitigation write-up. The blocking-dependency count stays
                    in the trigger's own summary line so it is visible closed or open.
                  */}
                  <Accordion type="single" collapsible>
                    <AccordionItem value="risks" className="border-none">
                      <AccordionTrigger className="px-6 py-5 hover:no-underline [&>svg]:size-5">
                        <span className="flex flex-wrap items-baseline gap-x-2">
                          <CardTitle className="font-serif">Risks and dependencies</CardTitle>
                          <span className="text-100 font-normal text-muted-foreground">
                            {a.risks.length > 0
                              ? `${a.risks.length} risk${a.risks.length === 1 ? "" : "s"}`
                              : null}
                            {a.risks.length > 0 && a.dependencies.length > 0 ? " · " : null}
                            {a.dependencies.length > 0
                              ? `${a.dependencies.length} dependenc${a.dependencies.length === 1 ? "y" : "ies"}`
                              : null}
                          </span>
                        </span>
                      </AccordionTrigger>
                      <AccordionContent className="px-6">
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
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </Provenance>
              </Card>
            ) : null}

            {/* ── Effort, cost and timeline (FR-07, FR-08, FR-09) ── */}
            {a.plan ? (
              <Card className="pb-0">
                <CardHeader><CardTitle className="font-serif">What it would take</CardTitle></CardHeader>
                <CardContent>
                  <Provenance
                    state={provenanceState(a.plan.provenance)}
                    validatedBy={validatedByOf(a.plan.provenance)}
                  >
                    <div className="space-y-5">
                      {/* The three headline figures stay visible closed or open — they
                          are the one-glance answer to "how big a lift is this," which
                          §12 wants readable without a click. Only the itemised
                          requirements and timeline (the detail behind those figures)
                          collapse. */}
                      <dl className="grid gap-4 sm:grid-cols-3">
                        <Stat label="Effort" value={EFFORT_LABEL[a.plan.effortClass]} />
                        <Stat label="Cost" value={EFFORT_LABEL[a.plan.costClass]} />
                        <Stat
                          label="Ongoing complexity"
                          value={EFFORT_LABEL[a.plan.operationalComplexity]}
                        />
                      </dl>

                      {a.plan.notes ? <p className="text-200">{a.plan.notes}</p> : null}
                    </div>
                  </Provenance>
                </CardContent>

                {a.plan.requirements.length > 0 || a.plan.timeline.length > 0 ? (
                  <Accordion type="single" collapsible>
                    <AccordionItem value="plan-detail" className="border-none">
                      <AccordionTrigger className="px-6 py-4 text-200 font-medium text-muted-foreground hover:no-underline hover:text-foreground">
                        Requirements and timeline
                      </AccordionTrigger>
                      <AccordionContent className="px-6">
                        <Provenance
                          state={provenanceState(a.plan.provenance)}
                          validatedBy={validatedByOf(a.plan.provenance)}
                        >
                          <div className="space-y-5">
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
                                    literal `true` in the contract precisely so this line
                                    cannot be rendered without it. */}
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
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                ) : null}
              </Card>
            ) : null}
          </div>
        );
      }}
    </IdeaShell>
  );
}

/* ── Small presentational helpers, local to this page by design ── */

/** One "at a glance" tile — a quiet card, not a KPI dashboard; this page's whole argument
 * is the detail underneath, so these four figures stay understated. */
function GlanceStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3.5">
      <p className="text-100 text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-300 font-semibold text-foreground">{value}</p>
    </div>
  );
}

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
      {/* Each use case as its own small card (enterprise-polish pass §12), not a bullet in
          a shared list — "[Use case] [Use case] [Use case]" reads as distinct, scannable
          items rather than one run-on list two categories deep. */}
      <ul className="mt-2 space-y-2.5">
        {cases.map((u) => (
          <li key={u.id} className="rounded-lg border border-border bg-card p-3">
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

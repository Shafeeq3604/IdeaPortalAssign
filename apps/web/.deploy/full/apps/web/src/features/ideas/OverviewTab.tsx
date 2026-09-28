import * as React from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowRight, CircleAlert, Gavel, Lightbulb, ListChecks, TrendingUp, Users } from "lucide-react";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger, Badge, Button, Card, CardContent,
  CardHeader, CardTitle, Provenance,
} from "@iep/ui";
import type { EffortClass, FeasibilityStatus, SimilarIdeaRef } from "@iep/contracts";
import { IdeaShell } from "./IdeaShell";
import { STATUS_LABEL, useIdeaHistory } from "./api";
import {
  BAND_LABEL, BAND_STEPS, EFFORT_LABEL, FEASIBILITY_LABEL, VALUE_DIMENSION_LABEL, provenanceState,
  useAnalysis, useAnalysisStatus, validatedByOf,
} from "../analysis/api";
import { useEvaluation } from "../evaluation/api";
import { AnalysisProgress } from "../analysis/AnalysisProgress";
import { ImpactCard } from "../delivery/ImpactCard";
import { DELIVERY_STAGES } from "@iep/contracts";
import { AttachmentsPanel } from "./Attachments";
import { SignalsPanel } from "../feedback/SignalsPanel";
import { Discussion } from "../social/Discussion";
import { DECISION_HELP, DECISION_LABEL, useReviews } from "../review/api";

/**
 * FR-20 (P12, AI-10) — REQUIREMENTS §15's exact banner copy. Deliberately no similarity
 * score or AI wording ("Do not expose similarity/AI technical details") — that detail is
 * the Evaluation tab's reviewer-facing existing-solution card's business, not this one's.
 *
 * "Link your idea" and "Combine ideas" (the other two options REQUIREMENTS §15 lists)
 * are not built here — no idea-relationship data model is reserved anywhere in the
 * schema for either, unlike `SimilarIdea` itself (ADR-012). Shipping "View" + "Continue"
 * is the real FR-20 requirement (detection and surfacing); the other two are a distinct,
 * larger feature (idea linking/merging) called out as follow-up, not silently dropped.
 */
function SimilarIdeaBanner({ similarIdeas }: { similarIdeas: readonly SimilarIdeaRef[] }) {
  const [dismissed, setDismissed] = React.useState(false);
  const top = similarIdeas[0];
  if (!top || dismissed) return null;

  return (
    <Card className="border-l-4 border-l-state-info bg-state-info-bg/40">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
        <p className="text-200 font-medium">We found a similar idea.</p>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <Link to={`/ideas/${top.ideaId}/overview`}>View similar idea</Link>
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>
            Continue with your idea
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

const GLANCE = [
  { key: "problemStatement", label: "The problem", icon: CircleAlert },
  { key: "description", label: "The idea", icon: Lightbulb },
  { key: "expectedUsers", label: "Who would use it", icon: Users },
  { key: "expectedOutcome", label: "What would change", icon: TrendingUp },
] as const;

/** Overview: the submitted content as written, before any AI touches it. */
export function OverviewTab() {
  const { ideaId = "" } = useParams();
  const reviews = useReviews(ideaId);

  return (
    <IdeaShell>
      {(idea) => {
        const v = idea.currentVersion;
        /**
         * "Implementation recommendation" (platform-transformation brief §6) — the
         * platform's own review decision, not an AI verdict. `OVERRIDDEN` is excluded:
         * it is a side effect of a score adjustment (`ReviewTab.tsx`'s `OverrideForm`),
         * not anyone recording a call on whether to build this. Newest first
         * (`listReviews`'s own ordering), so the first genuine decision found is current.
         */
        const latestDecision = reviews.data?.items.find((r) => r.decision !== "OVERRIDDEN");
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
            {/*
              F-03: the six-step stepper lives on Overview, not only on the Analysis tab.
              Someone who has just pressed Submit is looking at THIS page, and progress
              they have to go find is progress they will assume is not happening.
            */}
            {idea.status === "DRAFT" ? null : (
              <AnalysisProgress ideaId={ideaId} linkToAnalysis />
            )}

            {idea.similarIdeas.length > 0 ? (
              <SimilarIdeaBanner similarIdeas={idea.similarIdeas} />
            ) : null}

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_23rem] xl:items-start">
            <div className="min-w-0 space-y-6">
            {/* Impact — what it achieved, once it is being delivered (only then are there
                results to show, and only then is the request worth making). */}
            {(DELIVERY_STAGES as readonly string[]).includes(idea.status) ? <ImpactCard ideaId={ideaId} /> : null}
            {/*
              P9 ("richer look"): the four facts every other tab is built from — the
              problem, the idea, who it is for, what would change — as one "at a glance"
              card rather than a card each, in the submitter's own words.
            */}
            <section className="rounded-2xl border border-border bg-card p-5 shadow-e2 sm:p-6">
              <h2 className="text-400 font-extrabold">The idea at a glance</h2>
              <div className="mt-4 grid gap-x-8 gap-y-5 md:grid-cols-2">
                {GLANCE.map((g) => (
                  <div key={g.key}>
                    <h3 className="flex items-center gap-2 text-100 font-extrabold uppercase tracking-[0.08em] text-muted-foreground">
                      <g.icon aria-hidden className="size-3.5 text-accent-700" />
                      {g.label}
                    </h3>
                    <p className="mt-1.5 whitespace-pre-wrap text-200 leading-relaxed">{v[g.key]}</p>
                  </div>
                ))}
              </div>
            </section>

            {idea.status === "DRAFT" ? null : <AnalysisFindings ideaId={ideaId} enabled />}

            {/*
              Implementation recommendation (brief §6, §13) — deliberately human-authored:
              this is the reviewer's own recorded decision and their own words, never AI
              output rendered as a verdict (P-3). Silent while nothing has been decided
              yet — most ideas most of the time — rather than an empty-state card
              crowding a page that is already telling the submission's own story.
            */}
            {latestDecision ? (
              <Card className="border-l-4 border-l-accent-600">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 font-serif">
                    <Gavel aria-hidden className="size-4 text-accent-700" />
                    Implementation recommendation
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={latestDecision.decision === "REJECTED" ? "outline" : "secondary"}>
                      {DECISION_LABEL[latestDecision.decision]}
                    </Badge>
                    <span className="text-100 text-muted-foreground">
                      <Link to={`/people/${latestDecision.reviewer.id}`}>
                        {latestDecision.reviewer.displayName}
                      </Link>
                      {" · "}
                      {new Date(latestDecision.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="text-200">
                    {latestDecision.comment ?? DECISION_HELP[latestDecision.decision]}
                  </p>
                  <Link to={`/ideas/${ideaId}/review`} className="text-100">
                    Full review history
                  </Link>
                </CardContent>
              </Card>
            ) : null}

            {/*
              Use cases (platform-transformation brief §7) — a real, structured field the
              submitter wrote, not the AI's own post-submission use-case analysis (that
              lives on the Analysis tab, with kind/horizon/evidence). Shown only once
              there is at least one, same as every other optional-and-real section here.
            */}
            {v.useCases.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 font-serif">
                    <ListChecks aria-hidden className="size-4 text-muted-foreground" />
                    Use cases
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="list-disc space-y-1.5 pl-5">
                    {v.useCases.map((useCase, i) => (
                      <li key={`${i}-${useCase.slice(0, 24)}`} className="text-200">{useCase}</li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ) : null}

            {provided.length > 0 ? (
              // Collapsed by default once there IS optional detail to show, same
              // reasoning as the Analysis tab's denser sections — this is real, useful
              // supplementary information, not the core of the submission above.
              <Card className="py-0">
                <Accordion type="single" collapsible>
                  <AccordionItem value="detail" className="border-none">
                    <AccordionTrigger className="px-6 py-5 hover:no-underline [&>svg]:size-5">
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <CardTitle className="font-serif">Additional detail</CardTitle>
                        <span className="text-100 font-normal text-muted-foreground">
                          {provided.length} field{provided.length === 1 ? "" : "s"} filled in
                        </span>
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="px-6">
                      <div className="space-y-4">
                        {provided.map((o) => (
                          <div key={o.label}>
                            <h3 className="text-200 font-medium text-muted-foreground">{o.label}</h3>
                            <p className="whitespace-pre-wrap">{o.value}</p>
                          </div>
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </Card>
            ) : (
              // Empty is a call to action, not detail to hide — stays plain and open so
              // "Add more detail" is never a click away from being seen.
              <Card>
                <CardHeader><CardTitle className="font-serif">Additional detail</CardTitle></CardHeader>
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
            {/*
              Files sit with the written content, because that is what they are: more of
              what the person submitted. Editable only while the idea is a draft — a
              submitted version is part of what was analysed (SPEC §4.3).
            */}
            <AttachmentsPanel ideaId={ideaId} canEdit={idea.permissions.canEdit} />

            {/*
              Structured feedback (FR-18, P11) — same gate as the "Team feedback" vote bar
              in IdeaShell.tsx above: there is nothing yet to react to on an unsubmitted
              draft.
            */}
            {idea.status === "DRAFT" ? null : <SignalsPanel ideaId={ideaId} />}

            {/* P18 — where people actually talk about it. Not on a private draft. */}
            {idea.status === "DRAFT" ? null : <Discussion ideaId={ideaId} ownerId={idea.submitter.id} />}
            </div>

            {/* The engine's reasons and the idea's recent path — only once they exist. */}
            <aside className="space-y-6">
              {idea.compositeScore !== null ? <WhyItRanks ideaId={ideaId} /> : null}
              <Timeline ideaId={ideaId} />
            </aside>
            </div>
          </div>
        );
      }}
    </IdeaShell>
  );
}

/* ══════════════════════════════════════════════════════════════════
 * P9 usability round 1 — the Overview's richer panels. Every one reads data another tab
 * already owns (analysis, evaluation, history) and links to that tab for the full story;
 * none computes anything of its own.
 * ══════════════════════════════════════════════════════════════════ */

const PANEL = "rounded-2xl border border-border bg-card p-5 shadow-e2 sm:p-6";

function PanelHeading({ title, to, cta }: { title: string; to: string; cta: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-3">
      <h2 className="text-400 font-extrabold">{title}</h2>
      <Link to={to} className="inline-flex items-center gap-1 text-200 font-bold">
        {cta} <ArrowRight aria-hidden className="size-3.5" />
      </Link>
    </div>
  );
}

/** A 1-of-N ordinal meter. Its length is the band's POSITION, never a score (the engine
 *  owns scores) — the same rule `BAND_STEPS` states. */
function Meter({ step, of, label }: { step: number; of: number; label: string }) {
  return (
    <span role="img" aria-label={label} className="mt-2.5 flex gap-1">
      {Array.from({ length: of }, (_, i) => (
        <span key={i} className={`h-1.5 flex-1 rounded-full ${i < step ? "bg-accent-600" : "bg-muted"}`} />
      ))}
    </span>
  );
}

const FEASIBILITY_STEPS: Record<FeasibilityStatus, number> = {
  NOT_CURRENTLY_FEASIBLE: 1, REQUIRES_INVESTIGATION: 2, FEASIBLE_WITH_CONDITIONS: 3, HIGHLY_FEASIBLE: 4,
};
const EFFORT_STEPS: Record<EffortClass, number> = { LOW: 1, MEDIUM: 2, HIGH: 3, VERY_HIGH: 4 };

/**
 * "What the analysis found": the strongest value finding, the feasibility call and the
 * effort class — three of the Analysis tab's own sections, one line each. It is model
 * output, so it sits inside `<Provenance>` (SPEC §7.4) like every AI block on that tab.
 */
function AnalysisFindings({ ideaId, enabled }: { ideaId: string; enabled: boolean }) {
  const analysis = useAnalysis(ideaId, enabled);
  const a = analysis.data;
  if (!a) return null;

  const topValue = [...a.valueFindings].sort((x, y) => BAND_STEPS[y.band] - BAND_STEPS[x.band])[0];
  const cards: { key: string; label: string; headline: string; meter: React.ReactNode; note: string }[] = [];

  if (topValue) {
    cards.push({
      key: "value",
      label: "Strongest value",
      headline: `${BAND_LABEL[topValue.band]} · ${VALUE_DIMENSION_LABEL[topValue.dimension]}`,
      meter: <Meter step={BAND_STEPS[topValue.band]} of={5} label={`${BAND_LABEL[topValue.band]}, band ${BAND_STEPS[topValue.band]} of 5`} />,
      note: topValue.rationale,
    });
  }
  if (a.feasibility) {
    const steps = FEASIBILITY_STEPS[a.feasibility.status];
    cards.push({
      key: "feasibility",
      label: "Feasibility",
      headline: FEASIBILITY_LABEL[a.feasibility.status],
      meter: <Meter step={steps} of={4} label={`${FEASIBILITY_LABEL[a.feasibility.status]}, ${steps} of 4`} />,
      note: a.feasibility.summary,
    });
  }
  if (a.plan) {
    const steps = EFFORT_STEPS[a.plan.effortClass];
    cards.push({
      key: "effort",
      label: "Effort to build",
      headline: EFFORT_LABEL[a.plan.effortClass],
      meter: <Meter step={steps} of={4} label={`${EFFORT_LABEL[a.plan.effortClass]} effort, ${steps} of 4`} />,
      note: `Cost ${EFFORT_LABEL[a.plan.costClass].toLowerCase()} · operational complexity ${EFFORT_LABEL[a.plan.operationalComplexity].toLowerCase()}.`,
    });
  }
  if (cards.length === 0) return null;

  const provenance = a.feasibility?.provenance ?? a.plan?.provenance;

  return (
    <section className={PANEL}>
      <PanelHeading title="What the analysis found" to={`/ideas/${ideaId}/analysis`} cta="Full analysis" />
      <div className="mt-4">
        <Provenance
          state={provenance ? provenanceState(provenance) : "AI_UNVALIDATED"}
          validatedBy={provenance ? validatedByOf(provenance) : undefined}
        >
          <div className="grid gap-3 md:grid-cols-3">
            {cards.map((c) => (
              <div key={c.key} className="rounded-xl border border-border bg-card p-4">
                <p className="text-100 font-bold uppercase tracking-[0.06em] text-muted-foreground">{c.label}</p>
                <p className="mt-1.5 text-300 font-extrabold leading-snug">{c.headline}</p>
                {c.meter}
                <p className="mt-2.5 line-clamp-4 text-200 leading-relaxed text-foreground/85">{c.note}</p>
              </div>
            ))}
          </div>
        </Provenance>
      </div>
    </section>
  );
}

/**
 * "Why it ranks here": each weighted criterion's contribution in composite points, the
 * engine's own numbers (FR-14 — a score is never shown without its reasons). Bars are
 * scaled to the largest contribution; the figure beside each is the real one.
 */
function WhyItRanks({ ideaId }: { ideaId: string }) {
  const evaluation = useEvaluation(ideaId);
  const e = evaluation.data;
  if (!e) return null;

  const rows = e.criterionScores
    .filter((c) => c.weight > 0)
    .sort((x, y) => y.contribution - x.contribution);
  const max = Math.max(0.0001, ...rows.map((r) => r.contribution));
  const strongest = e.ranking?.explanation.strengths[0];
  const holding = e.ranking?.explanation.constraints[0];

  return (
    <section className={PANEL}>
      <PanelHeading title="Why it ranks here" to={`/ideas/${ideaId}/evaluation`} cta="Evaluation" />
      <p className="mt-1 text-100 text-muted-foreground">
        Points each criterion added to the {e.compositeScore.toFixed(1)} · {e.profile.name} profile
      </p>
      <ul className="mt-4 flex list-none flex-col gap-2.5 p-0">
        {rows.map((r) => (
          <li key={r.criterionKey} className="grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)_2.75rem] items-center gap-2.5 text-100">
            <span className="truncate font-semibold text-muted-foreground" title={r.criterionLabel}>
              {r.criterionLabel}
            </span>
            <span aria-hidden className="block h-2 overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full rounded-full bg-accent-600"
                style={{ width: `${Math.max(2, (r.contribution / max) * 100)}%` }}
              />
            </span>
            <span className="text-right text-200 font-extrabold tabular-nums">{r.contribution.toFixed(1)}</span>
          </li>
        ))}
      </ul>
      {strongest || holding ? (
        <div className="mt-4 flex flex-col gap-2 border-t border-border pt-3.5 text-200 leading-relaxed">
          {strongest ? (
            <p>
              <b className="text-factor-up">Strongest: </b>
              {strongest.text}
            </p>
          ) : null}
          {holding ? (
            <p>
              <b className="text-factor-down">Holding it back: </b>
              {holding.text}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/**
 * The five most recent things that happened to the idea, newest first.
 *
 * Status history alone records only moves a PERSON made (its `actor_id` is required), so
 * an analysed, scored and ranked idea showed a single "Submitted" line, as if nothing had
 * happened since. The system's own milestones are merged in from data this page already
 * loads: when the analysis finished, and when the engine scored and ranked the version.
 */
function Timeline({ ideaId }: { ideaId: string }) {
  const history = useIdeaHistory(ideaId);
  const analysis = useAnalysisStatus(ideaId);
  const evaluation = useEvaluation(ideaId);

  const events: { key: string; label: string; at: string; by: string }[] = (
    history.data?.statusHistory ?? []
  ).map((s) => ({ key: s.id, label: STATUS_LABEL[s.toStatus], at: s.at, by: s.actor.displayName }));

  const run = analysis.data;
  if (run?.finishedAt && (run.overall === "SUCCEEDED" || run.overall === "PARTIAL")) {
    events.push({
      key: "analysis",
      label: run.overall === "PARTIAL" ? "AI analysis finished, partly" : "AI analysis finished",
      at: run.finishedAt,
      by: "AI analysis",
    });
  }
  const e = evaluation.data;
  if (e) {
    events.push({ key: "scored", label: `Scored ${e.compositeScore.toFixed(1)}`, at: e.computedAt, by: "Scoring engine" });
    if (e.ranking) {
      events.push({
        key: "ranked",
        label: `Ranked #${e.ranking.rank} of ${e.ranking.cohortSize}`,
        at: e.ranking.computedAt,
        by: `${e.profile.name} profile`,
      });
    }
  }

  const entries = events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 5);
  if (entries.length === 0) return null;

  return (
    <section className={PANEL}>
      <PanelHeading title="Timeline" to={`/ideas/${ideaId}/history`} cta="History" />
      <ol className="mt-4 flex list-none flex-col gap-3.5 p-0">
        {entries.map((s, i) => (
          <li key={s.key} className="flex gap-3">
            <span
              aria-hidden
              className={`mt-1.5 size-2.5 shrink-0 rounded-full ring-4 ${
                i === 0 ? "bg-accent-600 ring-accent-100" : "bg-border-strong ring-muted"
              }`}
            />
            <span className="min-w-0">
              <span className="block text-200 font-bold">{s.label}</span>
              <span className="block text-100 text-muted-foreground">
                {new Date(s.at).toLocaleDateString()} · {s.by}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

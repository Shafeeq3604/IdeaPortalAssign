import * as React from "react";
import { Link, useParams } from "react-router-dom";
import { CircleAlert, Gavel, Lightbulb, ListChecks, TrendingUp, Users } from "lucide-react";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger, Badge, Button, Card, CardContent,
  CardHeader, CardTitle,
} from "@iep/ui";
import type { SimilarIdeaRef } from "@iep/contracts";
import { IdeaShell } from "./IdeaShell";
import { AnalysisProgress } from "../analysis/AnalysisProgress";
import { AttachmentsPanel } from "./Attachments";
import { SignalsPanel } from "../feedback/SignalsPanel";
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

            {/*
              The core of the submission, not two identical stacked cards (visual-
              richness pass — Overview was the one idea-detail tab that never got the
              hierarchy the other four have). Problem and idea are the two facts every
              other tab is built from — the AI's read of it, the score, the rank — so
              they share one card with a brand-accent rule, side by side, instead of
              reading as two unrelated topics.
            */}
            <Card className="overflow-hidden border-l-4 border-l-accent-600 py-0 shadow-e2">
              <div className="grid gap-6 p-6 md:grid-cols-2">
                <div>
                  <h2 className="flex items-center gap-2 font-serif text-300 font-semibold">
                    <CircleAlert aria-hidden className="size-4 text-accent-700" />
                    The problem
                  </h2>
                  <p className="mt-2 whitespace-pre-wrap text-200">{v.problemStatement}</p>
                </div>
                <div>
                  <h2 className="flex items-center gap-2 font-serif text-300 font-semibold">
                    <Lightbulb aria-hidden className="size-4 text-accent-700" />
                    The idea
                  </h2>
                  <p className="mt-2 whitespace-pre-wrap text-200">{v.description}</p>
                </div>
              </div>
            </Card>

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

            <div className="grid gap-6 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 font-serif">
                    <Users aria-hidden className="size-4 text-muted-foreground" />
                    Who would use it
                  </CardTitle>
                </CardHeader>
                <CardContent><p className="whitespace-pre-wrap">{v.expectedUsers}</p></CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 font-serif">
                    <TrendingUp aria-hidden className="size-4 text-muted-foreground" />
                    What would change
                  </CardTitle>
                </CardHeader>
                <CardContent><p className="whitespace-pre-wrap">{v.expectedOutcome}</p></CardContent>
              </Card>
            </div>

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
          </div>
        );
      }}
    </IdeaShell>
  );
}

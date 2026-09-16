import { Link, useParams } from "react-router-dom";
import { CircleAlert, Lightbulb, TrendingUp, Users } from "lucide-react";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger, Card, CardContent, CardHeader,
  CardTitle,
} from "@iep/ui";
import { IdeaShell } from "./IdeaShell";
import { AnalysisProgress } from "../analysis/AnalysisProgress";
import { AttachmentsPanel } from "./Attachments";

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
            {/*
              F-03: the six-step stepper lives on Overview, not only on the Analysis tab.
              Someone who has just pressed Submit is looking at THIS page, and progress
              they have to go find is progress they will assume is not happening.
            */}
            {idea.status === "DRAFT" ? null : (
              <AnalysisProgress ideaId={ideaId} linkToAnalysis />
            )}

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
          </div>
        );
      }}
    </IdeaShell>
  );
}

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Info, Sparkles, Wand2 } from "lucide-react";
import { Button, Input } from "@iep/ui";
import type { ListCategoriesResponse } from "@iep/contracts";
import { api } from "../../app/api-client";
import { queryKeys } from "../../app/query-keys";
import { canSee, useSession } from "../../app/use-session";
import { STATUS_LABEL, useIdeaList } from "./api";
import { isEmptyFilter, parseSmartFilter, type NamedRef, type SmartFilter } from "./smart-filter";

/**
 * "Ask the ideas" — P20 smart filters (SPEC §14 M4, D-25). No model: the question is
 * matched against the department and category names this page already knows, and what
 * it understood is shown as chips WHILE typing, before anything is applied. Apply writes
 * the ordinary list filters to the URL, so the result is a normal, shareable, Back-able
 * list — not a special mode.
 */

const EXAMPLES = ["Pilots in Operations", "Best ranked ideas in Finance", "What's being built?", "Quick wins"];

export function SmartAsk({ onApply }: { onApply: (filter: SmartFilter) => void }) {
  const session = useSession();
  const [question, setQuestion] = React.useState("");
  const [applied, setApplied] = React.useState<string | null>(null);

  // Departments: the ones on ideas this person can see — the admin department list is
  // not everyone's to read, and a department with no visible ideas would filter to nothing.
  const vocabularyIdeas = useIdeaList({ sort: "recent", perPage: 100 });
  const categories = useQuery({
    queryKey: queryKeys.config.categories(),
    queryFn: () => api<ListCategoriesResponse>("/config/categories"),
    staleTime: 60_000,
  });

  const vocabulary = React.useMemo(() => {
    const departments = new Map<string, NamedRef>();
    for (const idea of vocabularyIdeas.data?.items ?? []) {
      if (idea.department) departments.set(idea.department.id, { id: idea.department.id, name: idea.department.name });
    }
    return {
      departments: [...departments.values()],
      categories: (categories.data?.items ?? [])
        .filter((c) => c.isActive)
        .flatMap((c) => [{ id: c.id, name: c.label }, { id: c.id, name: c.key.replace(/_/g, " ") }]),
    };
  }, [vocabularyIdeas.data, categories.data]);

  const parsed = question.trim() ? parseSmartFilter(question, vocabulary) : null;
  const leader = canSee(session.data?.user.roles ?? [], ["MANAGEMENT", "ADMIN"]);

  const apply = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!parsed || isEmptyFilter(parsed)) return;
    onApply(parsed);
    setApplied(question.trim());
  };

  return (
    <section
      aria-labelledby="smart-ask-heading"
      className="mb-5 rounded-2xl bg-card p-4 shadow-e1 ring-1 ring-inset ring-border sm:p-5"
    >
      <h2 id="smart-ask-heading" className="flex items-center gap-2 text-300 font-bold">
        <Wand2 aria-hidden className="size-4 text-accent-700" />
        Ask in plain words
        <span className="rounded-full bg-muted px-2 py-0.5 text-100 font-semibold text-muted-foreground">
          No AI · instant
        </span>
      </h2>
      <form onSubmit={apply} className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Input
          id="smart-ask"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. pilots in Operations, best ranked ideas in Finance"
          aria-label="Ask in plain words"
          aria-describedby="smart-ask-understood"
          className="h-10 flex-1"
        />
        <Button type="submit" disabled={!parsed || isEmptyFilter(parsed)} className="h-10">
          <Sparkles aria-hidden className="size-4" />
          Show these ideas
        </Button>
      </form>

      <div id="smart-ask-understood" aria-live="polite" className="mt-3 text-200">
        {!parsed ? (
          <p className="flex flex-wrap items-center gap-2 text-muted-foreground">
            Try:
            {EXAMPLES.map((ex) => (
              <Button
                key={ex}
                type="button"
                variant="outline"
                size="sm"
                className="h-7 rounded-full px-3 font-normal"
                onClick={() => setQuestion(ex)}
              >
                {ex}
              </Button>
            ))}
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">{isEmptyFilter(parsed) ? "Nothing to filter on yet." : "Understood as:"}</span>
            {parsed.department ? <Chip label="Department" value={parsed.department.name} /> : null}
            {parsed.category ? <Chip label="Category" value={parsed.category.name} /> : null}
            {parsed.stageLabel ? (
              <Chip
                label="Stage"
                value={parsed.statuses.length === 1 && parsed.statuses[0] ? STATUS_LABEL[parsed.statuses[0]] : parsed.stageLabel}
              />
            ) : null}
            {parsed.sortLabel ? <Chip label="Order" value={parsed.sortLabel} /> : null}
            {parsed.keyword ? <Chip label="Title mentions" value={`“${parsed.keyword}”`} /> : null}
          </div>
        )}
        {parsed?.asksAboutEffort ? (
          <p className="mt-2 flex items-start gap-1.5 text-100 text-muted-foreground">
            <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            {leader
              ? "Effort is not something this list can filter by. The portfolio map on Analytics sorts every ranked idea by impact and effort."
              : "Effort is not something this list can filter by. Each idea's Evaluation tab shows how its effort was scored."}
          </p>
        ) : null}
        {applied ? (
          <p className="mt-2 text-100 text-muted-foreground">
            Showing the filters for “{applied}”. Change or clear them with the controls below.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-100 px-2.5 py-1 text-100 text-accent-700">
      <span className="font-semibold uppercase tracking-wide">{label}</span>
      <span className="font-bold">{value}</span>
    </span>
  );
}

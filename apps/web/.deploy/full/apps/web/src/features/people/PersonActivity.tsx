import type * as React from "react";
import {
  ClipboardCheck, Gavel, MessagesSquare, Send,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from "@iep/ui";
import { Link } from "react-router-dom";
import type {
  LeadershipDecisionStatus, PersonActivityEntry, PersonActivitySummary, ReviewDecision,
  StructuredFeedbackType,
} from "@iep/contracts";
import { DECISION_LABEL } from "../review/api";
import { DECISION_STATUS_LABEL } from "../leadership/api";
import { STRUCTURED_FEEDBACK_LABEL } from "../feedback/labels";
import { usePersonActivity } from "./api";

/**
 * Personal activity summary + contribution timeline (design-review request, held to the
 * three items REQUIREMENTS §32 leaves room for: plain counts, a plain history — no
 * points, no levels, no badges, no streaks; see the "Gamification Preview" artifact for
 * what was deliberately left out and why).
 *
 * Sits on the existing `/people/:userId` page (`ScopedIdeaPages.tsx`), above the ideas
 * list that page already showed — richer content on a page SPEC §6.1 already spec'd, not
 * a new route or a new §6.2 relationship.
 *
 * Visual treatment (design-review follow-up: the first pass read as "bland," plain
 * numbers on a plain card, next to pages that already got a visual-richness pass):
 * borrows two patterns this codebase already established rather than inventing a third —
 * `DashboardPage.tsx`'s `PipelineTiles` (a coloured top rule + tinted surface that only
 * lights up once a count is real, dim otherwise) for the four stats, and
 * `packages/ui/src/components/iep/history.tsx`'s `Timeline` rail-and-dot for the
 * contribution list. Deliberately ONE accent colour throughout, not four — the icon
 * glyph tells the four stats apart, not a wall of different hues, which is exactly the
 * "restrained, not flashy" line the Aurora pass drew for this same reason.
 */

const VOTE_LABEL: Record<string, string> = {
  WOULD_USE: "said they'd use it",
  SEE_RISK: "flagged a risk",
};

const STATS: readonly {
  key: keyof PersonActivitySummary["counts"];
  label: string;
  icon: typeof Send;
}[] = [
  { key: "ideasSubmitted", label: "Ideas submitted", icon: Send },
  { key: "feedbackGiven", label: "Feedback given", icon: MessagesSquare },
  { key: "reviewsGiven", label: "Reviews given", icon: ClipboardCheck },
  { key: "decisionsRecorded", label: "Decisions recorded", icon: Gavel },
];

const ICON_BY_TYPE: Record<PersonActivityEntry["type"], typeof Send> = {
  IDEA_SUBMITTED: Send,
  FEEDBACK_GIVEN: MessagesSquare,
  REVIEW_GIVEN: ClipboardCheck,
  DECISION_RECORDED: Gavel,
};

/** The one sentence a timeline row reads as — reusing the exact same words the rest of
 *  the product already uses for each of these facts (`DECISION_LABEL`, `LABEL_BY_TYPE`,
 *  etc.), rather than inventing a second wording for the same event. */
function describeEntry(entry: PersonActivityEntry): React.ReactNode {
  const title = <Link to={`/ideas/${entry.idea.id}/overview`}>{entry.idea.title}</Link>;
  switch (entry.type) {
    case "IDEA_SUBMITTED":
      return <>Submitted {title}</>;
    case "FEEDBACK_GIVEN": {
      const detail = entry.detail ?? "";
      const label =
        VOTE_LABEL[detail] ??
        STRUCTURED_FEEDBACK_LABEL[detail as StructuredFeedbackType] ??
        "gave feedback";
      return <>On {title}, {label}</>;
    }
    case "REVIEW_GIVEN":
      return (
        <>
          Reviewed {title}
          {entry.detail ? <> — {DECISION_LABEL[entry.detail as ReviewDecision]}</> : null}
        </>
      );
    case "DECISION_RECORDED":
      return (
        <>
          Recorded a leadership decision on {title}
          {entry.detail ? <> — {DECISION_STATUS_LABEL[entry.detail as LeadershipDecisionStatus]}</> : null}
        </>
      );
  }
}

export function PersonActivity({ userId }: { userId: string }) {
  const activity = usePersonActivity(userId);

  if (activity.isPending) return <Skeleton className="mb-6 h-40 w-full" aria-busy="true" />;
  // Silent on failure: the ideas list below is the page's real content and already has
  // its own error state — a second error banner above it for a summary widget would
  // outweigh what it is reporting on.
  if (activity.isError) return null;

  const { counts, entries } = activity.data;
  const hasAnyActivity = Object.values(counts).some((n) => n > 0);
  if (!hasAnyActivity) return null;

  return (
    <div className="mb-6 grid gap-4 sm:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="font-serif">Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3">
            {STATS.map(({ key, label, icon: Icon }) => {
              const value = counts[key];
              const live = value > 0;
              return (
                <div
                  key={key}
                  className={`relative overflow-hidden rounded-xl p-3.5 ${
                    live
                      ? "bg-accent-050 shadow-e1 ring-1 ring-inset ring-ramp-2"
                      : "bg-muted/50 ring-1 ring-inset ring-border"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`absolute inset-x-0 top-0 h-1 ${live ? "bg-gradient-to-r from-ramp-3 to-ramp-5" : "bg-border"}`}
                  />
                  <span
                    aria-hidden
                    className={`flex items-center gap-1.5 text-100 font-bold uppercase tracking-[0.08em] ${
                      live ? "text-accent-700" : "text-muted-foreground"
                    }`}
                  >
                    <Icon aria-hidden className="size-3.5 shrink-0" />
                  </span>
                  <span
                    className={`mt-1 block font-serif text-500 font-bold leading-none tabular-nums ${
                      live ? "text-accent-700" : "text-muted-foreground"
                    }`}
                  >
                    {value}
                  </span>
                  <span className="mt-1 block text-100 text-muted-foreground">{label}</span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-serif">Contribution history</CardTitle>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <p className="text-200 text-muted-foreground">Nothing recorded yet.</p>
          ) : (
            <ol className="max-h-72 space-y-0 overflow-y-auto pr-1">
              {entries.map((entry, i) => {
                const Icon = ICON_BY_TYPE[entry.type];
                return (
                  <li
                    key={entry.id}
                    className="relative border-l-2 border-border py-1 pb-4 pl-9 last:pb-0"
                  >
                    <span
                      aria-hidden
                      className="absolute -left-3.5 top-0 grid size-7 place-items-center rounded-full bg-accent-100 text-accent-700 ring-4 ring-card"
                    >
                      <Icon aria-hidden className="size-3.5" />
                    </span>
                    <p className="text-200 leading-snug">{describeEntry(entry)}</p>
                    <p className="mt-0.5 text-100 text-muted-foreground">
                      {new Date(entry.at).toLocaleDateString()}
                    </p>
                    {i === entries.length - 1 ? (
                      // The rail's own border would otherwise run past the last dot with
                      // nothing below it to connect to.
                      <span aria-hidden className="absolute -left-px top-0 h-4 w-0.5 bg-card" />
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

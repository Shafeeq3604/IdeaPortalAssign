import * as React from "react";
import {
  AlertCircle, Copy, Database, Sparkles, Wrench,
} from "lucide-react";
import {
  Button, Card, CardContent, CardHeader, CardTitle, Textarea,
} from "@iep/ui";
import type { StructuredFeedbackType } from "@iep/contracts";
import { useSignals, useSetSignal } from "./api";
import { STRUCTURED_FEEDBACK_LABEL } from "./labels";

/**
 * Structured feedback (FR-18, P11) — the five `FeedbackType` reasons beyond the thumb
 * vote (`VoteButtons`), which the "Team feedback" bar above every tab already shows.
 *
 * Deliberately titled "Additional feedback," not "Discussion" or "Comments": the
 * underlying `Feedback` row is capped at one per (idea, person, reason) by the P0-frozen
 * schema (`@@unique([ideaId, userId, type])`) — a person can state each reason once and
 * attach one note to it, never reply to someone else's or post a second time. Calling
 * that a "discussion" would repeat the exact "label promises one thing, delivers
 * another" mistake the UI audit found and fixed elsewhere in this product (the header's
 * "Submit an idea" button). This panel is honest about being a structured signal, not a
 * conversation — see CONTRACT-LOG for the decision this was built against.
 */

const TYPES: readonly {
  type: StructuredFeedbackType;
  label: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}[] = [
  { type: "HAVE_PROBLEM", label: STRUCTURED_FEEDBACK_LABEL.HAVE_PROBLEM, icon: AlertCircle },
  { type: "SIMILAR_USE_CASE", label: STRUCTURED_FEEDBACK_LABEL.SIMILAR_USE_CASE, icon: Copy },
  { type: "CAN_PROVIDE_DATA", label: STRUCTURED_FEEDBACK_LABEL.CAN_PROVIDE_DATA, icon: Database },
  { type: "CAN_HELP_IMPLEMENT", label: STRUCTURED_FEEDBACK_LABEL.CAN_HELP_IMPLEMENT, icon: Wrench },
  { type: "HAVE_IMPROVEMENT", label: STRUCTURED_FEEDBACK_LABEL.HAVE_IMPROVEMENT, icon: Sparkles },
];

const LABEL_BY_TYPE = STRUCTURED_FEEDBACK_LABEL;

export function SignalsPanel({ ideaId }: { ideaId: string }) {
  const signals = useSignals(ideaId);
  const setSignal = useSetSignal(ideaId);
  const [draftFor, setDraftFor] = React.useState<StructuredFeedbackType | null>(null);
  const [draftText, setDraftText] = React.useState("");

  const mine = new Set(signals.data?.mine ?? []);
  const entriesWithNotes = (signals.data?.entries ?? []).filter((e) => e.comment);

  const toggle = (type: StructuredFeedbackType) => {
    const active = !mine.has(type);
    setSignal.mutate({ type, active });
    if (active) {
      setDraftFor(type);
      setDraftText("");
    } else if (draftFor === type) {
      setDraftFor(null);
    }
  };

  const saveNote = (type: StructuredFeedbackType) => {
    setSignal.mutate(
      { type, active: true, comment: draftText },
      { onSuccess: () => setDraftFor(null) },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-serif">Additional feedback</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-200 text-muted-foreground">
          Beyond a thumbs up or down — pick any that apply and say why, if you want to.
        </p>

        <div className="flex flex-wrap gap-2">
          {TYPES.map(({ type, label, icon: Icon }) => {
            const active = mine.has(type);
            return (
              <Button
                key={type}
                type="button"
                size="sm"
                variant={active ? "default" : "outline"}
                aria-pressed={active}
                disabled={setSignal.isPending}
                onClick={() => toggle(type)}
              >
                <Icon aria-hidden className="size-4" />
                {label}
              </Button>
            );
          })}
        </div>

        {draftFor ? (
          <div className="space-y-2 rounded-lg border border-border bg-muted p-3">
            <label htmlFor="signal-note" className="text-100 font-medium text-muted-foreground">
              A note for &ldquo;{LABEL_BY_TYPE[draftFor]}&rdquo; — optional
            </label>
            <Textarea
              id="signal-note"
              rows={2}
              maxLength={500}
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              placeholder="Say more, if it helps — this stays with your reason, visible to anyone who can see this idea."
            />
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                disabled={setSignal.isPending}
                onClick={() => saveNote(draftFor)}
              >
                Save note
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setDraftFor(null)}>
                Skip
              </Button>
            </div>
          </div>
        ) : null}

        {entriesWithNotes.length > 0 ? (
          <div className="space-y-3 border-t border-border pt-3">
            <p className="text-100 font-medium uppercase tracking-widest text-muted-foreground">
              What colleagues said
            </p>
            <ul className="space-y-3">
              {entriesWithNotes.map((entry) => (
                <li key={entry.id} className="text-200">
                  <span className="font-medium">{entry.submitter.displayName}</span>{" "}
                  <span className="text-muted-foreground">&middot; {LABEL_BY_TYPE[entry.type]}</span>
                  <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{entry.comment}</p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

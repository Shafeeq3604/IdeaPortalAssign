import * as React from "react";
import { Link, useParams } from "react-router-dom";
import {
  Badge, Button, Card, CardContent, CardHeader, CardTitle, ErrorState, Input, Label,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Skeleton, Textarea,
} from "@iep/ui";
import type { ReviewDecision } from "@iep/contracts";
import { IdeaShell } from "../ideas/IdeaShell";
import { useEvaluation } from "../evaluation/api";
import {
  DECISION_HELP, DECISION_LABEL, REVIEWER_DECISIONS, useCreateReview, useOverrideScore,
  useReviews,
} from "./api";

const link = ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
  <Link to={to} className={className}>{children}</Link>
);

/**
 * Review tab (P6 — FR-22, FR-23, P-3).
 *
 * Where a human takes responsibility for what the machine produced. Two decisions are
 * recorded here and both demand a reason where the requirement says so; neither is
 * applied optimistically, because a decision the UI claimed and the server refused is a
 * governance defect, not a UX blip.
 */
export function ReviewTab() {
  const { ideaId = "" } = useParams();
  const reviews = useReviews(ideaId);

  return (
    <IdeaShell>
      {(idea) => {
        if (reviews.isPending) return <Skeleton className="h-80 w-full" aria-busy="true" />;

        if (reviews.isError) {
          return (
            <ErrorState
              title="Could not load the review history"
              description="The idea is fine — this is the review view failing to load."
              onRetry={() => void reviews.refetch()}
              escapeTo={{ label: "Back to the idea", to: `/ideas/${ideaId}/overview` }}
              renderLink={link}
            />
          );
        }

        return (
          <div className="space-y-6">
            {idea.permissions.canReview ? <DecisionForm ideaId={ideaId} /> : null}
            {idea.permissions.canOverrideScores ? <OverrideForm ideaId={ideaId} /> : null}

            <Card>
              <CardHeader><CardTitle>Review history</CardTitle></CardHeader>
              <CardContent>
                {reviews.data.items.length === 0 ? (
                  <p className="text-200 text-muted-foreground">
                    Nobody has reviewed this idea yet.
                  </p>
                ) : (
                  <ul className="space-y-4">
                    {reviews.data.items.map((r) => (
                      <li key={r.id} className="border-b border-border pb-3 last:border-b-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={r.decision === "REJECTED" ? "outline" : "secondary"}>
                            {DECISION_LABEL[r.decision]}
                          </Badge>
                          <Link to={`/people/${r.reviewer.id}`} className="text-200">
                            {r.reviewer.displayName}
                          </Link>
                          <span className="text-100 text-muted-foreground">
                            {new Date(r.createdAt).toLocaleString()}
                          </span>
                        </div>
                        {r.comment ? (
                          <p className="mt-1 whitespace-pre-wrap text-200">{r.comment}</p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <p className="text-100 text-muted-foreground">
              Every decision here is recorded in{" "}
              <Link to="/admin/audit">the audit trail</Link>, with who made it and why.
            </p>
          </div>
        );
      }}
    </IdeaShell>
  );
}

function DecisionForm({ ideaId }: { ideaId: string }) {
  const [decision, setDecision] = React.useState<ReviewDecision>("VALIDATED");
  const [comment, setComment] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const create = useCreateReview(ideaId);

  // FR-23 is enforced by the API and by a DB CHECK. Mirroring it here is about telling
  // the reviewer before they lose their typing, not about being the guard.
  const reasonMissing = decision === "REJECTED" && comment.trim().length === 0;

  return (
    <Card>
      <CardHeader><CardTitle>Record a decision</CardTitle></CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            setTouched(true);
            if (reasonMissing) return;
            create.mutate({ decision, comment: comment.trim() || undefined });
          }}
        >
          <fieldset className="space-y-2">
            <legend className="text-200 font-medium">Your decision</legend>
            {REVIEWER_DECISIONS.map((d) => (
              <label key={d} className="flex items-start gap-3 rounded-md border border-border p-3">
                <Input
                  type="radio"
                  name="decision"
                  value={d}
                  checked={decision === d}
                  onChange={() => setDecision(d)}
                  className="mt-1 size-4"
                />
                <span>
                  <span className="block text-200 font-medium">{DECISION_LABEL[d]}</span>
                  <span className="block text-100 text-muted-foreground">{DECISION_HELP[d]}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <div>
            <Label htmlFor="field-reviewComment">
              Comment{decision === "REJECTED" ? " (required)" : " (optional)"}
            </Label>
            <Textarea
              id="field-reviewComment"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              rows={4}
              aria-invalid={touched && reasonMissing}
              aria-describedby={touched && reasonMissing ? "error-reviewComment" : undefined}
            />
            {touched && reasonMissing ? (
              <p id="error-reviewComment" role="alert" className="mt-1 text-100 text-destructive">
                A rejection needs a reason. The submitter will see it.
              </p>
            ) : null}
          </div>

          {create.isError ? (
            <p role="alert" className="text-100 text-destructive">
              The decision was not recorded. Nothing has changed — try again.
            </p>
          ) : null}
          {create.isSuccess ? (
            <p role="status" className="text-100 text-factor-up">
              Recorded. It appears in the history below and in the audit trail.
            </p>
          ) : null}

          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? "Recording…" : "Record the decision"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * Score override (FR-22).
 *
 * The criterion list comes from the idea's OWN evaluation rather than the catalogue, so
 * a reviewer cannot override a criterion this idea was never scored on.
 */
function OverrideForm({ ideaId }: { ideaId: string }) {
  const evaluation = useEvaluation(ideaId);
  const override = useOverrideScore(ideaId);
  const [criterionKey, setCriterionKey] = React.useState("");
  const [value, setValue] = React.useState("50");
  const [reason, setReason] = React.useState("");
  const [touched, setTouched] = React.useState(false);

  if (evaluation.isPending) return <Skeleton className="h-64 w-full" />;
  if (evaluation.isError || !evaluation.data) {
    return (
      <Card>
        <CardHeader><CardTitle>Adjust a score</CardTitle></CardHeader>
        <CardContent>
          <p className="text-200 text-muted-foreground">
            There is nothing to adjust until this idea has been evaluated.
          </p>
        </CardContent>
      </Card>
    );
  }

  const scores = evaluation.data.criterionScores;
  const selected = scores.find((s) => s.criterionKey === criterionKey) ?? scores[0];
  const reasonMissing = reason.trim().length === 0;

  return (
    <Card>
      <CardHeader><CardTitle>Adjust a score</CardTitle></CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            setTouched(true);
            if (reasonMissing || !selected) return;
            override.mutate({
              criterionKey: selected.criterionKey,
              newNormalized: Number(value),
              reason: reason.trim(),
            });
          }}
        >
          <div>
            <Label htmlFor="field-criterion">Criterion</Label>
            {/* shadcn's Select, not a native one: `lint:tokens` rejects a bare control
                in feature code, and that rule is the only thing keeping the single
                component layer real (ADR-019). */}
            <Select
              value={selected?.criterionKey ?? ""}
              onValueChange={(next) => {
                setCriterionKey(next);
                const row = scores.find((s) => s.criterionKey === next);
                // Seed the field with the CURRENT value so an accidental submit is a
                // no-op rather than a silent reset to 50.
                if (row) setValue(String(row.normalized));
              }}
            >
              <SelectTrigger id="field-criterion" className="mt-1">
                <SelectValue placeholder="Choose a criterion" />
              </SelectTrigger>
              <SelectContent>
                {scores.map((s) => (
                  <SelectItem key={s.criterionKey} value={s.criterionKey}>
                    {s.criterionLabel} — currently {s.normalized.toFixed(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="field-newScore">New score (0–100)</Label>
            <Input
              id="field-newScore"
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
            {selected ? (
              <p className="mt-1 text-100 text-muted-foreground">
                Currently {selected.normalized.toFixed(1)}, carrying{" "}
                {(selected.weight * 100).toFixed(1)}% of the composite. The engine derived
                it from: {selected.rationale}
              </p>
            ) : null}
          </div>

          <div>
            <Label htmlFor="field-overrideReason">Why (required)</Label>
            <Textarea
              id="field-overrideReason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              aria-invalid={touched && reasonMissing}
              aria-describedby={touched && reasonMissing ? "error-overrideReason" : undefined}
            />
            <p className="mt-1 text-100 text-muted-foreground">
              This replaces the engine's reasoning on that criterion and is shown to the
              submitter alongside your name.
            </p>
            {touched && reasonMissing ? (
              <p id="error-overrideReason" role="alert" className="mt-1 text-100 text-destructive">
                An adjustment without a reason is unaccountable. Say why.
              </p>
            ) : null}
          </div>

          {override.isError ? (
            <p role="alert" className="text-100 text-destructive">
              The adjustment was not applied. Nothing has changed — try again.
            </p>
          ) : null}
          {override.isSuccess ? (
            <p role="status" className="text-100 text-factor-up">
              Applied. The rankings are being recomputed — the board may take a moment.
            </p>
          ) : null}

          <Button type="submit" disabled={override.isPending}>
            {override.isPending ? "Applying…" : "Apply the adjustment"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

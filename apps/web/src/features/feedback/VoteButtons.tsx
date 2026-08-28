import { ThumbsDown, ThumbsUp } from "lucide-react";
import { Button, cn } from "@iep/ui";
import { useFeedback, useVote } from "./api";

/**
 * Thumbs up / thumbs down (requirements.md §14).
 *
 * Deliberately plain and deliberately small. This is one colleague's opinion, and it must
 * not read with the weight of the platform's own evaluation — which is why it lives under
 * a "Team Feedback" heading, separate from "AI Evaluation", and why nothing here is
 * expressed as a score.
 *
 * The counts show even at zero. "0 / 0" says nobody has reacted yet; hiding them would
 * make a new idea look like a broken one.
 */

export function VoteButtons({
  ideaId,
  size = "default",
}: {
  ideaId: string;
  /** `compact` for a list row, where this sits beside a title rather than in a panel. */
  size?: "default" | "compact";
}) {
  const feedback = useFeedback(ideaId);
  const vote = useVote(ideaId);

  const up = feedback.data?.up ?? 0;
  const down = feedback.data?.down ?? 0;
  const mine = feedback.data?.myVote ?? null;
  const compact = size === "compact";

  /** Pressing the thumb you already chose takes it back. */
  const press = (next: "UP" | "DOWN") => vote.mutate(mine === next ? null : next);

  return (
    <div className={cn("flex items-center", compact ? "gap-1" : "gap-2")}>
      <Button
        type="button"
        size="sm"
        variant={mine === "UP" ? "default" : "outline"}
        aria-pressed={mine === "UP"}
        aria-label={
          mine === "UP" ? `Remove your thumbs up (${up} so far)` : `Thumbs up (${up} so far)`
        }
        onClick={() => press("UP")}
        disabled={feedback.isPending}
      >
        <ThumbsUp aria-hidden className="size-4" />
        <span className="tabular-nums">{up}</span>
      </Button>

      <Button
        type="button"
        size="sm"
        variant={mine === "DOWN" ? "default" : "outline"}
        aria-pressed={mine === "DOWN"}
        aria-label={
          mine === "DOWN"
            ? `Remove your thumbs down (${down} so far)`
            : `Thumbs down (${down} so far)`
        }
        onClick={() => press("DOWN")}
        disabled={feedback.isPending}
      >
        <ThumbsDown aria-hidden className="size-4" />
        <span className="tabular-nums">{down}</span>
      </Button>
    </div>
  );
}

/**
 * The counts without the controls, for places a vote would be out of place — a dense
 * table row, or someone else's idea in a list you are scanning.
 */
export function VoteCount({ ideaId }: { ideaId: string }) {
  const feedback = useFeedback(ideaId);
  if (!feedback.data) return null;
  const { up, down } = feedback.data;

  return (
    <span className="inline-flex items-center gap-3 text-100 text-muted-foreground">
      <span className="inline-flex items-center gap-1">
        <ThumbsUp aria-hidden className="size-3.5" />
        <span className="tabular-nums">{up}</span>
        <span className="sr-only">thumbs up</span>
      </span>
      <span className="inline-flex items-center gap-1">
        <ThumbsDown aria-hidden className="size-3.5" />
        <span className="tabular-nums">{down}</span>
        <span className="sr-only">thumbs down</span>
      </span>
    </span>
  );
}

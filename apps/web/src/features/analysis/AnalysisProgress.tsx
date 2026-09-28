import * as React from "react";
import { Link } from "react-router-dom";
import { PIPELINE_STEPS, type AnalysisStep } from "@iep/contracts";
import { Skeleton, Stepper } from "@iep/ui";
import { STEP_LABEL, useAnalysisStatus } from "./api";
import { AnalysisReveal } from "./AnalysisReveal";

/**
 * The six-step determinate stepper (SPEC §8.4, F-03).
 *
 * Shown on Overview so the person who just submitted sees the work happening where they
 * already are, and again on the Analysis tab as the header for the results.
 *
 * The step LIST comes from `PIPELINE_STEPS`, not from the response, so all six render
 * from the first paint even before a single row exists. A stepper that grows as steps
 * start is indeterminate wearing a determinate costume.
 */

/** What the fallback actually means, in the words of someone who did not read the SPEC. */
function detailFor(step: {
  status: string; usedFallback: boolean; errorCode: string | null;
}): string | undefined {
  if (step.usedFallback) return "Completed without AI — a reviewer should check this part";
  if (step.status === "FAILED") return step.errorCode ?? "This step did not finish";
  return undefined;
}

export function AnalysisProgress({
  ideaId,
  linkToAnalysis = false,
}: {
  ideaId: string;
  linkToAnalysis?: boolean;
}) {
  const query = useAnalysisStatus(ideaId);

  /*
   * P20 live reveal: did THIS page watch the run finish? Only a real status the API
   * reported counts as "before" — the first load of an already-finished idea has no
   * earlier status, so it never plays. Adjusted during render (the AppShell pattern),
   * not in an effect.
   */
  const reported = query.data?.overall ?? null;
  const [lastReported, setLastReported] = React.useState(reported);
  const [watched, setWatched] = React.useState(false);
  if (reported !== lastReported) {
    const wasLive = lastReported === "PENDING" || lastReported === "RUNNING";
    if (wasLive && (reported === "SUCCEEDED" || reported === "PARTIAL")) setWatched(true);
    setLastReported(reported);
  }

  if (query.isPending) return <Skeleton className="h-64 w-full" />;

  // Not an error state: an idea that has never been submitted has no run, and saying so
  // plainly beats an alarm. The stepper renders all six as PENDING.
  const steps = PIPELINE_STEPS.map((key: AnalysisStep) => {
    const row = query.data?.steps.find((s) => s.step === key);
    return {
      key,
      label: STEP_LABEL[key],
      state: (row?.status ?? "PENDING") as "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "SKIPPED",
      detail: row ? detailFor(row) : undefined,
    };
  });

  const overall = query.data?.overall ?? "PENDING";

  return (
    <div className="space-y-3">
      {watched ? <AnalysisReveal ideaId={ideaId} runStartedAt={query.data?.startedAt ?? null} /> : null}
      <Stepper steps={steps} />

      {overall === "PENDING" ? (
        <p className="text-200 text-muted-foreground">
          Analysis starts when the idea is submitted.
        </p>
      ) : null}

      {overall === "RUNNING" ? (
        <p className="text-200 text-muted-foreground">
          This usually takes a couple of minutes. You can leave this page — the analysis
          keeps running.
        </p>
      ) : null}

      {overall === "PARTIAL" ? (
        <p className="text-200 text-muted-foreground">
          Some steps finished without AI. The idea is still fully scored and ranked; the
          parts marked above are worth a human read.
        </p>
      ) : null}

      {overall === "FAILED" ? (
        <p className="text-200 text-muted-foreground">
          The analysis could not reach the AI provider. Nothing is lost — the idea has been
          scored from what you wrote and can be re-analysed later.
        </p>
      ) : null}

      {linkToAnalysis && (overall === "SUCCEEDED" || overall === "PARTIAL") ? (
        <Link to={`/ideas/${ideaId}/analysis`} className="text-200">
          See the full analysis
        </Link>
      ) : null}
    </div>
  );
}

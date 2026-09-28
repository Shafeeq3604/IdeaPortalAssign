import * as React from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, PartyPopper } from "lucide-react";
import { queryKeys } from "../../app/query-keys";
import { useCountUp } from "../../app/use-count-up";
import { celebrate } from "../../app/motion";
import { useEvaluation } from "../evaluation/api";

/**
 * The live analysis reveal (P20 — SPEC §14 M4, D-25).
 *
 * Mounted only when the person WATCHED the analysis finish — `AnalysisProgress` decides
 * that, from seeing the run go from running to done while on the page. A later visit gets
 * the plain numbers wherever they already live; this is the one moment they arrive.
 *
 * Scoring and ranking follow the analysis by a few seconds (the worker scores, then a
 * ranking run places the idea), so this asks again a handful of times until the rank is
 * there — then stops. No number is shown before the API has it.
 */

const RETRY_MS = 3_000;
const MAX_TRIES = 10;

export function AnalysisReveal({ ideaId, runStartedAt }: { ideaId: string; runStartedAt: string | null }) {
  const qc = useQueryClient();
  const query = useEvaluation(ideaId);
  // A revised idea already has its previous version's evaluation cached — that is not
  // the number this run produced, so it is not shown as if it were.
  const since = runStartedAt ? new Date(runStartedAt).getTime() : 0;
  const fresh = query.data && new Date(query.data.computedAt).getTime() >= since ? query.data : undefined;
  const ranked = Boolean(fresh?.ranking);

  React.useEffect(() => {
    // The idea itself changed status too (analysed → evaluated → ranked).
    void qc.invalidateQueries({ queryKey: queryKeys.ideas.detail(ideaId), exact: true });
    void qc.invalidateQueries({ queryKey: queryKeys.ideas.evaluation(ideaId) });
  }, [qc, ideaId]);

  React.useEffect(() => {
    if (ranked) return;
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      void qc.invalidateQueries({ queryKey: queryKeys.ideas.evaluation(ideaId) });
      if (tries >= MAX_TRIES) window.clearInterval(timer);
    }, RETRY_MS);
    return () => window.clearInterval(timer);
  }, [qc, ideaId, ranked]);

  const score = fresh?.compositeScore;
  const shown = useCountUp(score ?? 0, 900);
  const burstRef = React.useRef<HTMLDivElement>(null);
  const burst = React.useRef(false);

  React.useEffect(() => {
    if (score === undefined || burst.current) return;
    burst.current = true;
    const r = burstRef.current?.getBoundingClientRect();
    celebrate(r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : undefined);
  }, [score]);

  if (score === undefined) {
    return (
      <div role="status" className="rounded-2xl border border-border bg-muted/50 p-4 text-200">
        <span className="motion-pending-pulse font-semibold">Analysis finished — scoring it now…</span>
      </div>
    );
  }

  const ranking = fresh?.ranking;
  return (
    <div
      ref={burstRef}
      className="reveal-glow motion-reveal flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl bg-accent-100 p-5 ring-1 ring-inset ring-accent-600/30"
    >
      <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-xl bg-card text-accent-700 shadow-e1">
        <PartyPopper className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-100 font-bold uppercase tracking-[0.1em] text-accent-700">Analysis finished</p>
        <p aria-hidden className="mt-0.5 text-300 font-semibold text-foreground">
          Scored{" "}
          <span className="font-serif text-600 font-extrabold tabular-nums text-accent-700">{shown.toFixed(1)}</span>{" "}
          out of 100
          {ranking ? (
            <>
              {" · "}ranked <span className="font-bold tabular-nums">#{ranking.rank}</span> of{" "}
              <span className="tabular-nums">{ranking.cohortSize}</span>
            </>
          ) : (
            <span className="motion-pending-pulse text-200 font-normal text-muted-foreground"> · placing it on the board…</span>
          )}
        </p>
        {/* The count-up is decoration; a screen reader gets the settled figures once. */}
        <span role="status" className="sr-only">
          Scored {score.toFixed(1)} out of 100{ranking ? `, ranked ${ranking.rank} of ${ranking.cohortSize}` : ""}.
        </span>
      </div>
      <Link
        to={`/ideas/${ideaId}/evaluation`}
        className="inline-flex items-center gap-1.5 text-200 font-semibold text-accent-700 hover:underline"
      >
        See why
        <ArrowRight aria-hidden className="size-4" />
      </Link>
    </div>
  );
}

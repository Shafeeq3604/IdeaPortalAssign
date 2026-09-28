import * as React from "react";
import { Link } from "react-router-dom";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Coins, Gauge, Minus, Sprout } from "lucide-react";
import { Skeleton } from "@iep/ui";
import { DELIVERY_STAGES } from "@iep/contracts";
import type { IdeaSummary, PilotOutcome } from "@iep/contracts";
import { useIdeaList } from "../ideas/api";
import { useDelivery } from "./api";
import { impactSummary, type KpiResult } from "./impact";

/**
 * "What it achieved" (impact) — on the idea's Overview, and in a compact form on Home and
 * a person's page. Everyone who can open the idea sees it, exactly as they already see
 * the Delivery tab it is built from (same endpoint, same `idea:read` rule — no figure
 * reaches anyone new). Every number was entered by a reviewer or admin; the sentences are
 * written by code from those numbers, never by AI.
 */

const OUTCOME: Record<PilotOutcome, string> = {
  SUCCEEDED: "Pilot succeeded",
  MIXED: "Pilot had mixed results",
  DID_NOT_SUCCEED: "Pilot did not succeed",
};

const STANDING: Record<KpiResult["standing"], { label: string; tone: string; icon: typeof ArrowUpRight }> = {
  AHEAD: { label: "Ahead of prediction", tone: "bg-state-ok-bg text-state-ok", icon: ArrowUpRight },
  ON_PREDICTION: { label: "On prediction", tone: "bg-state-ok-bg text-state-ok", icon: Minus },
  BEHIND: { label: "Behind prediction", tone: "bg-state-warn-bg text-state-warn", icon: ArrowDownRight },
  MEASURED: { label: "Measured", tone: "bg-accent-100 text-accent-700", icon: Gauge },
  PREDICTED_ONLY: { label: "Predicted", tone: "bg-muted text-muted-foreground", icon: Sprout },
  NOT_SET: { label: "Not measured yet", tone: "bg-muted text-muted-foreground", icon: Minus },
};

export function ImpactCard({ ideaId }: { ideaId: string }) {
  const query = useDelivery(ideaId);
  const ready = query.isSuccess;
  // A "Results are in" notification lands on #impact; the card only exists once its data
  // has arrived, after the browser's own hash jump has given up.
  React.useEffect(() => {
    if (ready && window.location.hash === "#impact") document.getElementById("impact")?.scrollIntoView({ block: "start" });
  }, [ready]);
  if (query.isPending) return <Skeleton className="h-40 w-full rounded-2xl" />;
  // No card at all before the idea reaches delivery, or if the tab cannot load — the
  // Overview has plenty to say without it, and an error box here would be noise.
  if (query.isError || !query.data.inDeliveryStage) return null;
  const s = impactSummary(query.data);

  return (
    <section
      id="impact"
      aria-labelledby="impact-heading"
      className="scroll-mt-20 rounded-2xl border border-border bg-card p-5 shadow-e2 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="impact-heading" className="flex items-center gap-2 text-400 font-extrabold">
            <Sprout aria-hidden className="size-5 text-state-ok" />
            What it achieved
          </h2>
          <p className="mt-1 text-300 font-semibold text-foreground">{s.headline}</p>
        </div>
        {s.pilotOutcome ? (
          <span className="rounded-full bg-muted px-3 py-1 text-100 font-semibold text-foreground">
            {OUTCOME[s.pilotOutcome]}
          </span>
        ) : null}
      </div>

      {s.money || s.results.length > 0 ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {s.money ? (
            <div className="rounded-xl bg-state-ok-bg/60 p-4 ring-1 ring-inset ring-border">
              <p className="flex items-center gap-1.5 text-100 font-bold uppercase tracking-[0.08em] text-muted-foreground">
                <Coins aria-hidden className="size-3.5" />
                Money
              </p>
              <p className="mt-1.5 font-serif text-600 font-extrabold leading-none tabular-nums text-foreground">
                {s.money.benefit ?? "—"}
              </p>
              <p className="mt-1 text-200 text-muted-foreground">
                benefit so far{s.money.investment ? ` · ${s.money.investment} invested` : ""}
                {s.money.roiPercent ? ` · return ${s.money.roiPercent}` : ""}
              </p>
              {s.money.roiSentence ? <p className="mt-2 text-200 font-semibold">{s.money.roiSentence}</p> : null}
              {s.money.basisNote ? (
                <p className="mt-1 text-100 text-muted-foreground">How it was worked out: {s.money.basisNote}</p>
              ) : null}
            </div>
          ) : null}
          {s.results.map((r) => <ResultTile key={r.id} result={r} />)}
        </div>
      ) : null}

      <p className="mt-4 flex flex-wrap items-center justify-between gap-2 text-100 text-muted-foreground">
        <span>
          {s.hasMeasuredAnything
            ? "Figures are entered by the reviewer running the delivery. Nothing here is estimated or changes the score."
            : "Results appear here as the reviewer running the delivery records them."}
        </span>
        <Link to={`/ideas/${ideaId}/delivery`} className="inline-flex items-center gap-1 font-semibold text-accent-700">
          The full delivery record
          <ArrowRight aria-hidden className="size-3.5" />
        </Link>
      </p>
    </section>
  );
}

function ResultTile({ result }: { result: KpiResult }) {
  const st = STANDING[result.standing];
  return (
    <div className="rounded-xl bg-muted/40 p-4 ring-1 ring-inset ring-border">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 text-200 font-bold">{result.name}</p>
        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-100 font-semibold ${st.tone}`}>
          <st.icon aria-hidden className="size-3" />
          {st.label}
        </span>
      </div>
      {result.headline ? (
        <p className="mt-1.5 font-serif text-600 font-extrabold leading-none tabular-nums">{result.headline}</p>
      ) : null}
      <p className="mt-1.5 text-200 text-muted-foreground">{result.sentence}</p>
    </div>
  );
}

/** One line per idea — Home's and a person's page's "what their ideas achieved". */
export function ImpactLine({ idea }: { idea: IdeaSummary }) {
  const query = useDelivery(idea.id);
  const s = query.data ? impactSummary(query.data) : null;
  const first = s?.money?.benefit
    ? `${s.money.benefit} benefit`
    : s?.results.find((r) => r.headline)?.headline
      ? `${s.results.find((r) => r.headline)?.name}: ${s.results.find((r) => r.headline)?.headline}`
      : null;
  return (
    <li>
      <Link
        to={`/ideas/${idea.id}/overview#impact`}
        className="flex items-start gap-3 rounded-xl border border-border px-4 py-3 text-foreground no-underline hover:bg-muted"
      >
        <span aria-hidden className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-state-ok-bg text-state-ok">
          <Sprout className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-200 font-semibold">{idea.title}</span>
          <span className="block text-100 text-muted-foreground">
            {query.isPending ? "Loading results…" : s ? s.headline : "Results unavailable right now."}
          </span>
        </span>
        {first ? <span className="shrink-0 text-200 font-bold tabular-nums">{first}</span> : null}
      </Link>
    </li>
  );
}

/**
 * A person's ideas that reached delivery, each with what it achieved — on Home ("your
 * ideas") and on a person's page. Renders nothing when there are none, so a page for
 * someone whose ideas are all still earlier on is not given an empty box.
 */
export function IdeasImpactSection({ submitterId, heading }: { submitterId: string; heading: string }) {
  const list = useIdeaList({ submitterId, status: DELIVERY_STAGES, sort: "recent", perPage: 10 });
  const items = list.data?.items ?? [];
  if (list.isPending || items.length === 0) return null;
  return (
    <section aria-labelledby={`impact-list-${submitterId}`} className="rounded-2xl bg-card p-5 shadow-e2 ring-1 ring-inset ring-border sm:p-6">
      <h2 id={`impact-list-${submitterId}`} className="flex items-center gap-2 text-400 font-extrabold">
        <Sprout aria-hidden className="size-5 text-state-ok" />
        {heading}
      </h2>
      <ul className="mt-4 flex list-none flex-col gap-2 p-0">
        {items.map((idea) => <ImpactLine key={idea.id} idea={idea} />)}
      </ul>
    </section>
  );
}

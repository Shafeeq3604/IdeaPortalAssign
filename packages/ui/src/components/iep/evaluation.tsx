import * as React from "react";
import { ChevronDown, Minus, TrendingDown, TrendingUp, UserCheck } from "lucide-react";
import { cn } from "../../lib/utils.js";
import type {
  ContributionBarProps, ExplanationPanelProps, RankBadgeProps, ScoreDisplayProps,
} from "./types.js";

/**
 * The explainability primitives (SPEC §7.6), implemented against their P0-frozen
 * signatures.
 *
 * These four carry P-2 — "no rank without an explanation" — so they are deliberately
 * hard to misuse: `ContributionBar` cannot render without evidence and a rationale, and
 * `ExplanationPanel` cannot render an empty case as if it were a complete one.
 */

/**
 * `tally` and `reveal-reasoning` run on FIRST PAINT ONLY (SPEC §8.3).
 *
 * Re-running a count-up on every re-render turns a number that is "arriving" into a
 * number that is flickering, and re-running it on scroll-back makes a settled score look
 * unsettled. This hook is the enforcement: it is true for exactly one render.
 */
function useFirstPaint(enabled: boolean): boolean {
  const [first, setFirst] = React.useState(enabled);
  React.useEffect(() => {
    if (!enabled) return;
    const id = requestAnimationFrame(() => setFirst(false));
    return () => cancelAnimationFrame(id);
  }, [enabled]);
  return first;
}

/* ══════════════════════════════════════════════════════════════════
 * ScoreDisplay — numbers arrive, they do not pop (SPEC §8.1).
 * ══════════════════════════════════════════════════════════════════ */

const SIZE: Record<NonNullable<ScoreDisplayProps["size"]>, string> = {
  sm: "text-300",
  md: "text-500",
  lg: "text-700",
};

export function ScoreDisplay({ value, max = 100, size = "md", animate = true }: ScoreDisplayProps) {
  const arriving = useFirstPaint(animate);

  return (
    <span className={cn("inline-flex items-baseline gap-1 tabular-nums", SIZE[size])}>
      <span
        className={cn("font-semibold transition-opacity duration-[var(--dur-tally)]", arriving && "opacity-0")}
      >
        {value.toFixed(1)}
      </span>
      <span className="text-200 text-muted-foreground">/ {max}</span>
    </span>
  );
}

/* ══════════════════════════════════════════════════════════════════
 * RankBadge — rank is relative, so movement is the point.
 * ══════════════════════════════════════════════════════════════════ */

export function RankBadge({ rank, previousRank, total, showDelta = true }: RankBadgeProps) {
  // A LOWER rank number is better, so a decrease is an improvement. Getting this
  // backwards is the easiest possible bug and the least likely to be noticed.
  const delta = previousRank === null ? null : previousRank - rank;
  const moved = delta !== null && delta !== 0;

  return (
    <span className="inline-flex items-center gap-2">
      <span className="inline-flex items-baseline gap-1 tabular-nums">
        <span className="text-500 font-semibold">#{rank}</span>
        <span className="text-200 text-muted-foreground">of {total}</span>
      </span>

      {showDelta && previousRank !== null ? (
        moved ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-100 font-medium",
              delta > 0 ? "bg-factor-up-bg text-factor-up" : "bg-factor-down-bg text-factor-down",
            )}
          >
            {delta > 0 ? (
              <TrendingUp aria-hidden className="size-3" />
            ) : (
              <TrendingDown aria-hidden className="size-3" />
            )}
            {delta > 0 ? `up ${delta}` : `down ${Math.abs(delta)}`}
            <span className="sr-only">from position {previousRank}</span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-100 text-muted-foreground">
            <Minus aria-hidden className="size-3" />
            unchanged
          </span>
        )
      ) : null}
    </span>
  );
}

/* ══════════════════════════════════════════════════════════════════
 * ContributionBar — the core explainability primitive (P-2).
 * ══════════════════════════════════════════════════════════════════ */

const CONFIDENCE_WORD = { LOW: "low confidence", MEDIUM: "medium confidence", HIGH: "high confidence" };

const SOURCE_WORD = {
  AI: "from the AI analysis",
  HUMAN: "set by a reviewer",
  SIGNAL: "from demand signals",
  FALLBACK: "derived without AI",
};

/**
 * One criterion's contribution to the composite, with its evidence one click away.
 *
 * Not a progress bar: the bar length is the NORMALIZED score, but the number beside it is
 * the CONTRIBUTION — normalized × weight — because that is what actually moved the rank.
 * Showing only one of the two is how a criterion scoring 30 at weight 0.01 gets mistaken
 * for a problem worth fixing.
 */
export function ContributionBar({
  criterionKey, criterionLabel, normalized, weight, contribution,
  rawBand, source, confidence, rationale, evidence, overriddenBy, onOpenCriterion,
}: ContributionBarProps) {
  const [open, setOpen] = React.useState(false);
  const arriving = useFirstPaint(true);
  const panelId = `evidence-${criterionKey}`;

  return (
    <div className="border-b border-border py-3 last:border-b-0" data-criterion={criterionKey}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-200 font-medium">
          {onOpenCriterion ? (
            <button type="button" onClick={onOpenCriterion} className="underline-offset-4 hover:underline">
              {criterionLabel}
            </button>
          ) : (
            criterionLabel
          )}
        </span>
        <span className="text-100 tabular-nums text-muted-foreground">
          {normalized.toFixed(1)} × {(weight * 100).toFixed(1)}% ={" "}
          <span className="font-medium text-foreground">{contribution.toFixed(2)} pts</span>
        </span>
      </div>

      {/* `tally`: fills from the left on first paint. Never on re-render (§8.3). */}
      <div
        role="img"
        aria-label={`${criterionLabel}: ${normalized.toFixed(0)} out of 100`}
        className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn(
            "h-full origin-left rounded-full transition-transform duration-[var(--dur-tally)] ease-[var(--ease-out-quint)]",
            overriddenBy ? "bg-factor-down" : "bg-primary",
          )}
          style={{ transform: `scaleX(${arriving ? 0 : Math.max(0, Math.min(1, normalized / 100))})` }}
        />
      </div>

      <p className="mt-1.5 text-100 text-muted-foreground">
        {rawBand ? `${rawBand.toLowerCase().replace("_", " ")} · ` : ""}
        {SOURCE_WORD[source]} · {CONFIDENCE_WORD[confidence]}
      </p>

      {overriddenBy ? (
        <p className="mt-1 inline-flex items-start gap-1.5 rounded-md bg-factor-down-bg px-2 py-1 text-100 text-factor-down">
          <UserCheck aria-hidden className="mt-0.5 size-3 shrink-0" />
          <span>
            Adjusted by {overriddenBy.name} — {overriddenBy.reason}
          </span>
        </p>
      ) : null}

      <p className="mt-1 text-200">{rationale}</p>

      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="mt-1 inline-flex items-center gap-1 text-100 text-muted-foreground hover:text-foreground"
      >
        <ChevronDown
          aria-hidden
          className={cn("size-3 transition-transform duration-[var(--dur-fast)]", open && "rotate-180")}
        />
        {open ? "Hide the evidence" : `Show the evidence (${evidence.length})`}
      </button>

      {/* `reveal-reasoning` (§8.3). The evidence is the whole point of the component. */}
      {open ? (
        <ul id={panelId} className="motion-reveal mt-2 space-y-1">
          {evidence.map((line, i) => (
            <li
              key={`${i}-${line.slice(0, 24)}`}
              className="border-l-2 border-border pl-3 text-200 text-muted-foreground"
            >
              {line}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
 * ExplanationPanel — rendered INLINE, never behind a link (P-2).
 * ══════════════════════════════════════════════════════════════════ */

export function ExplanationPanel({
  strengths, constraints, peerComparisons, generatedBy, tieBreakNote,
}: ExplanationPanelProps) {
  return (
    <div className="space-y-5">
      <ExplanationGroup
        heading="What lifted this idea"
        items={strengths}
        emptyNote="Nothing scored strongly enough to single out."
        tone="up"
      />
      <ExplanationGroup
        heading="What held it back"
        items={constraints}
        emptyNote="Nothing scored low enough to single out."
        tone="down"
      />

      {peerComparisons.length > 0 ? (
        <div>
          <h4 className="text-300 font-medium">Compared with its neighbours</h4>
          <ul className="mt-2 space-y-2">
            {peerComparisons.map((p) => (
              <li key={p.peerIdeaId} className="text-200">
                <span className="text-muted-foreground">#{p.peerRank} </span>
                {p.peerTitle} — {p.text}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {tieBreakNote ? <p className="text-200 text-muted-foreground">{tieBreakNote}</p> : null}

      {/*
        ADR-006: the explanation is DERIVED from the contribution vector, so every claim
        in it is true by construction. Saying so is not a disclaimer — it is the reason
        this panel can be trusted in a way a generated summary could not.
      */}
      <p className="text-100 text-muted-foreground">
        {generatedBy === "ENGINE"
          ? "Derived from the scores above by the evaluation engine — not written by AI."
          : "Derived from the scores above, then reworded by AI. No claim was added."}
      </p>
    </div>
  );
}

function ExplanationGroup({
  heading, items, emptyNote, tone,
}: {
  heading: string;
  items: ExplanationPanelProps["strengths"];
  emptyNote: string;
  tone: "up" | "down";
}) {
  return (
    <div>
      <h4 className="text-300 font-medium">{heading}</h4>
      {items.length === 0 ? (
        <p className="mt-1 text-200 text-muted-foreground">{emptyNote}</p>
      ) : (
        <ul className="mt-2 space-y-3">
          {items.map((item) => (
            <li key={item.criterionKey}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-200 font-medium">{item.criterionLabel}</span>
                <span
                  className={cn(
                    "text-100 tabular-nums",
                    tone === "up" ? "text-factor-up" : "text-factor-down",
                  )}
                >
                  {/* Share of the composite, so "big" and "small" mean something. */}
                  {(item.shareOfTotal * 100).toFixed(0)}% of the score
                </span>
              </div>
              <p className="text-200">{item.text}</p>
              {item.evidence.length > 0 ? (
                <ul className="mt-1 space-y-1">
                  {item.evidence.slice(0, 2).map((line, i) => (
                    <li
                      key={`${i}-${line.slice(0, 24)}`}
                      className="border-l-2 border-border pl-3 text-100 text-muted-foreground"
                    >
                      {line}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

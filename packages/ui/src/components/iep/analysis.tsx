import * as React from "react";
import {
  AlertTriangle, Check, CircleDashed, CircleHelp, Loader2, MinusCircle, Search, ShieldCheck,
} from "lucide-react";
import { cn } from "../../lib/utils.js";
import type {
  EvidenceListProps, ProvenanceProps, StatusPillProps, StepperProps,
} from "./types.js";

/**
 * The four custom components P3 needs, implemented against the P0-frozen signatures
 * (SPEC §7.6). No prop was added, removed or widened — the frozen interfaces in
 * `types.ts` are the contract, and these implementations satisfy them as written.
 *
 * Router-agnostic like `states.tsx`: no react-router import reaches this package.
 */

/* ══════════════════════════════════════════════════════════════════
 * Provenance — SPEC §7.4. A rendering CONTRACT, not a style.
 * ══════════════════════════════════════════════════════════════════ */

const CHIP = "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-100 font-medium";

/**
 * Wraps AI-derived content so machine-written and human-approved material are distinct
 * at a glance. Every AI block in the Analysis tab sits inside one of these; rendering an
 * AI field outside it is the thing SPEC §7.4 forbids.
 *
 * The chip carries WORDS as well as colour — a purple background alone is not an
 * accessible signal, and colour is the first thing lost to a screenshot in a deck.
 */
export function Provenance({ state, validatedBy, children }: ProvenanceProps) {
  const ai = state === "AI_UNVALIDATED";

  return (
    <div
      data-provenance={state}
      className={cn(
        "rounded-md border-l-[3px] px-4 py-3 transition-colors duration-[var(--dur-slow)]",
        ai
          ? "border-ai-border bg-ai-surface"
          : state === "HUMAN_OVERRIDDEN"
            ? "border-factor-down bg-card"
            : "border-factor-up bg-card",
      )}
    >
      <p className="mb-2">
        {ai ? (
          <span className={cn(CHIP, "bg-ai-border/60 text-ai-ink")}>
            <CircleHelp aria-hidden className="size-3" />
            AI-generated · not yet validated
          </span>
        ) : state === "HUMAN_VALIDATED" ? (
          <span className={cn(CHIP, "bg-factor-up-bg text-factor-up")}>
            <ShieldCheck aria-hidden className="size-3" />
            {validatedBy ? `Validated by ${validatedBy.name} · ${validatedBy.at}` : "Validated"}
          </span>
        ) : (
          <span className={cn(CHIP, "bg-factor-down-bg text-factor-down")}>
            <AlertTriangle aria-hidden className="size-3" />
            {validatedBy ? `Adjusted by ${validatedBy.name}` : "Adjusted by a reviewer"}
          </span>
        )}
      </p>
      {/* `defer` (§8.3): AI content fades and rises 2px. No scale, no bounce. */}
      <div className="motion-defer">{children}</div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
 * Stepper — the six-step determinate analysis progress (SPEC §8.4).
 * ══════════════════════════════════════════════════════════════════ */

type StepState = StepperProps["steps"][number]["state"];

const STEP_ICON: Record<StepState, React.ReactNode> = {
  PENDING: <CircleDashed aria-hidden className="size-4 text-muted-foreground" />,
  RUNNING: <Loader2 aria-hidden className="size-4 animate-spin text-primary" />,
  SUCCEEDED: <Check aria-hidden className="size-4 text-factor-up" />,
  FAILED: <AlertTriangle aria-hidden className="size-4 text-factor-down" />,
  SKIPPED: <MinusCircle aria-hidden className="size-4 text-muted-foreground" />,
};

const STEP_WORD: Record<StepState, string> = {
  PENDING: "Not started",
  RUNNING: "Running",
  SUCCEEDED: "Done",
  FAILED: "Failed",
  SKIPPED: "Skipped",
};

/**
 * Determinate and honest: every step is present from the first paint, in order, with its
 * real state. There is no synthetic percentage, and a step that fell back says so in its
 * `detail` rather than showing a clean tick.
 *
 * `aria-valuenow` is a real count against a known total, so a screen reader gets the same
 * determinacy a sighted user does.
 */
export function Stepper({ steps, onStepClick }: StepperProps) {
  const done = steps.filter((s) => s.state === "SUCCEEDED" || s.state === "FAILED").length;

  return (
    <div
      role="group"
      aria-label="Analysis progress"
      className="rounded-lg border border-border bg-card p-4"
    >
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-200 font-medium">Analysis progress</h3>
        <p
          role="progressbar"
          // A progressbar without a name is announced as "progress bar" and nothing else.
          // `aria-valuetext` describes the VALUE, not what is progressing — axe caught
          // the difference.
          aria-label="Analysis steps finished"
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-valuenow={done}
          aria-valuetext={`${done} of ${steps.length} steps finished`}
          className="text-100 tabular-nums text-muted-foreground"
        >
          {done} of {steps.length} finished
        </p>
      </div>

      <ol className="space-y-1">
        {steps.map((step, i) => {
          const inner = (
            <>
              <span className="flex size-6 shrink-0 items-center justify-center">
                {STEP_ICON[step.state]}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-200">{step.label}</span>
                {step.detail ? (
                  <span className="block text-100 text-muted-foreground">{step.detail}</span>
                ) : null}
              </span>
              <span className="text-100 text-muted-foreground">{STEP_WORD[step.state]}</span>
            </>
          );

          return (
            <li
              key={step.key}
              // `pending-pulse` (§8.3): only the step actually in flight breathes, on the
              // one shared clock. Reduced motion stops it via the global rule in tokens.css.
              className={cn(
                "flex items-center gap-3 rounded-md px-2 py-2",
                step.state === "RUNNING" && "motion-pending-pulse bg-muted",
              )}
            >
              <span className="sr-only">
                Step {i + 1} of {steps.length}:
              </span>
              {onStepClick ? (
                <button
                  type="button"
                  onClick={() => onStepClick(step.key)}
                  className="flex flex-1 items-center gap-3 text-left"
                >
                  {inner}
                </button>
              ) : (
                inner
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
 * StatusPill — never colour alone (SPEC §7.6).
 * ══════════════════════════════════════════════════════════════════ */

const FEASIBILITY_TONE: Record<string, { className: string; icon: React.ReactNode }> = {
  HIGHLY_FEASIBLE: {
    className: "bg-factor-up-bg text-factor-up",
    icon: <Check aria-hidden className="size-3" />,
  },
  FEASIBLE_WITH_CONDITIONS: {
    className: "bg-factor-up-bg text-factor-up",
    icon: <ShieldCheck aria-hidden className="size-3" />,
  },
  REQUIRES_INVESTIGATION: {
    className: "bg-muted text-muted-foreground",
    icon: <Search aria-hidden className="size-3" />,
  },
  NOT_CURRENTLY_FEASIBLE: {
    className: "bg-factor-down-bg text-factor-down",
    icon: <AlertTriangle aria-hidden className="size-3" />,
  },
};

/**
 * A feasibility verdict is consequential enough that it must survive being printed in
 * greyscale: icon + label always, colour as reinforcement only.
 */
export function StatusPill({ kind, feasibility, label }: StatusPillProps) {
  const tone =
    (kind === "FEASIBILITY" && feasibility ? FEASIBILITY_TONE[feasibility] : undefined) ?? {
      className: "bg-muted text-muted-foreground",
      icon: <CircleDashed aria-hidden className="size-3" />,
    };

  return (
    <span data-status-kind={kind} className={cn(CHIP, tone.className)}>
      {tone.icon}
      {label}
    </span>
  );
}

/* ══════════════════════════════════════════════════════════════════
 * EvidenceList — evidence bound to its source (P-7).
 * ══════════════════════════════════════════════════════════════════ */

/**
 * Evidence is what makes a band inspectable rather than an assertion, so the SOURCE is
 * shown with it. FALLBACK is called out explicitly: those lines come from the
 * deterministic fallback, not a model, and reading them as analysis would be wrong.
 */
export function EvidenceList({ evidence, source }: EvidenceListProps) {
  if (evidence.length === 0) return null;

  return (
    <div className="mt-2">
      <p className="text-100 font-medium text-muted-foreground">
        {source === "FALLBACK"
          ? "Derived without AI — the provider was unavailable"
          : source === "HUMAN"
            ? "Evidence recorded by a reviewer"
            : "Evidence from the submission"}
      </p>
      <ul className="mt-1 space-y-1">
        {evidence.map((line, i) => (
          <li
            key={`${i}-${line.slice(0, 24)}`}
            className="border-l-2 border-border pl-3 text-200 text-muted-foreground"
          >
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

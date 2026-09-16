import * as React from "react";
import { Link } from "react-router-dom";
import { ClipboardCheck, PenSquare, Trophy, X } from "lucide-react";
import { Button } from "@iep/ui";

/**
 * A one-time, three-step orientation for whoever has never used this product before —
 * a new employee, or someone walking through it live for the first time. Nothing else in
 * the shell currently tells a first-time viewer what to do first; every page assumes you
 * already know the shape of the workflow (submit → get scored → see it ranked) and jumps
 * straight into whichever one it is.
 *
 * Dismissed once, remembered forever (per browser) — this is an orientation, not a
 * recurring nag. It never blocks anything underneath it: no overlay, no modal, nothing
 * that has to be dismissed before the page beneath becomes usable.
 */
const STORAGE_KEY = "iep-onboarding-dismissed";

const STEPS = [
  {
    icon: PenSquare,
    title: "Submit an idea",
    body: "Describe it in your own words — no technical detail needed.",
  },
  {
    icon: ClipboardCheck,
    title: "Watch it get scored",
    body: "Every score comes with the arithmetic that produced it, right on the Evaluation tab.",
  },
  {
    icon: Trophy,
    title: "Check the board",
    body: "See where it ranks against everything else, and why.",
  },
] as const;

function readDismissed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    // Private windows and blocked site data both throw here — showing the banner every
    // visit in that case is the safe failure, not a broken dismiss button.
    return false;
  }
}

export function OnboardingSpotlight() {
  // Lazy initializer, not an effect: this is a pure client-side SPA (no server-rendered
  // HTML to mismatch against), so reading localStorage during the first render is safe,
  // and it means the banner never flashes visible-then-hidden for someone who already
  // dismissed it — an effect-based read would paint the wrong state for one frame first.
  const [dismissed, setDismissed] = React.useState(() => readDismissed());

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // Not persisted; it reappears next visit, which is the same failure mode as never
      // having seen it before — not a broken experience, just a repeated one.
    }
  };

  if (dismissed) return null;

  return (
    <div className="border-b border-accent-100 bg-accent-050">
      {/*
        The label and the dismiss controls are their OWN row, separate from the three
        steps below — the first version put all of it in one `flex flex-wrap` line, and
        at any width narrow enough to wrap, "New here?" and the buttons interleaved
        between individual steps instead of framing them. A header row plus a grid row
        wrap independently of each other, so the framing never breaks apart from what
        it's framing.
      */}
      <div className="mx-auto max-w-[var(--content)] px-8 py-4">
        <div className="flex items-center justify-between gap-4">
          <p className="text-100 font-semibold uppercase tracking-wide text-accent-700">
            New here?
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <Button asChild size="sm" onClick={dismiss}>
              <Link to="/ideas/new">Try it now</Link>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={dismiss}
              aria-label="Dismiss this introduction"
            >
              <X aria-hidden className="size-4" />
            </Button>
          </div>
        </div>

        <ol className="mt-3 grid gap-x-8 gap-y-3 sm:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex min-w-0 items-start gap-2.5">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent-100 text-100 font-bold text-accent-700">
                {i + 1}
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-200 font-medium">
                  <step.icon aria-hidden className="size-3.5 shrink-0 text-accent-700" />
                  {step.title}
                </span>
                <span className="block text-100 text-muted-foreground">{step.body}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

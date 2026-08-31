import * as React from "react";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button, Input, Label, cn } from "@iep/ui";
import { ThemeToggle } from "../../app/theme";
import { ORG_NAME, PRODUCT_NAME } from "../../app/product";

/**
 * The frame the two signed-out screens share — sign in and sign up.
 *
 * A split screen: a saturated indigo-to-violet gradient carrying the branding on the
 * left, and a floating card holding the form on the right. Everything past the door is
 * deliberately quiet grey and indigo; this is the one screen someone looks AT rather than
 * through, so it is allowed to be loud.
 *
 * Three things are load-bearing rather than decorative:
 *
 *  - **Every colour is a token.** No `indigo-500`, no hex. `pnpm lint:tokens` fails the
 *    build on a raw value in `features/**`, and the point of that rule is that a palette
 *    change stays one edit rather than a search.
 *  - **Contrast was computed, not eyeballed.** White on the darkest stop is 17.1:1 and on
 *    the lightest 5.7:1, so the headline stays AA across the whole sweep. Amber appears
 *    only on numerals and pills — white on amber is about 2:1 and a heading that dissolves
 *    halfway across is worse than no gradient at all.
 *  - **The controls are shadcn's**, restyled through className. ADR-019 puts the component
 *    layer in `@iep/ui` and keeps it there; a new skin is not a new component.
 */

export function WelcomeShell({
  eyebrow,
  headline,
  standfirst,
  aside,
  children,
}: {
  eyebrow: string;
  headline: React.ReactNode;
  standfirst: string;
  aside: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-welcome-canvas lg:grid lg:grid-cols-[1.05fr_minmax(0,1fr)]">
      {/* ═══ left: the gradient ═══ */}
      <section className="welcome-panel relative flex flex-col justify-between overflow-hidden px-6 py-10 text-grad-ink sm:px-10 lg:px-14 lg:py-14">
        <header className="relative flex items-center gap-2">
          <span className="grid size-9 place-items-center rounded-xl bg-grad-highlight/15 ring-1 ring-grad-rule">
            <Sparkles aria-hidden className="size-4 text-grad-highlight" />
          </span>
          <span className="text-400 font-semibold tracking-tight">{ORG_NAME}</span>
          <span className="text-100 font-medium uppercase tracking-[0.2em] text-grad-ink-soft">
            Ideas
          </span>
        </header>

        <div className="relative my-12 max-w-xl lg:my-0">
          <p className="inline-flex items-center gap-2 rounded-full bg-grad-highlight/15 px-3 py-1 text-100 font-semibold uppercase tracking-[0.16em] text-grad-highlight ring-1 ring-grad-rule">
            {eyebrow}
          </p>

          <h1 className="mt-6 text-700 font-bold leading-[1.08] tracking-[-0.02em] sm:text-800">
            {headline}
          </h1>

          <p className="mt-5 max-w-lg text-300 leading-relaxed text-grad-ink-soft">
            {standfirst}
          </p>

          <div className="mt-10">{aside}</div>
        </div>

        <p className="relative text-100 text-grad-ink-soft">
          {PRODUCT_NAME} · Confidential, {ORG_NAME} internal use only
        </p>
      </section>

      {/* ═══ right: the card ═══ */}
      <section className="welcome-stage flex flex-col px-6 py-8 sm:px-10">
        <div className="flex justify-end">
          <ThemeToggle />
        </div>

        <div className="flex flex-1 items-center justify-center py-8">
          {/*
            The card floats on both breakpoints. On mobile the gradient panel stacks above
            it rather than disappearing — the branding is the reason someone trusts the
            form, and hiding it on a phone hides exactly that.
          */}
          <div className="w-full max-w-md rounded-2xl border border-welcome-rule bg-welcome-surface p-7 shadow-e4 sm:p-9">
            {children}
          </div>
        </div>
      </section>
    </div>
  );
}

/**
 * The numbered list on the gradient.
 *
 * Each row is a card rather than a plain line so it reads against a moving background —
 * type alone on a gradient loses its edge wherever the two happen to be close in value.
 */
export function ContentsList({
  items,
}: {
  items: readonly { readonly title: string; readonly body: string }[];
}) {
  return (
    <ol className="grid gap-2.5">
      {items.map((item, i) => (
        <li
          key={item.title}
          className="grid grid-cols-[2rem_minmax(0,1fr)] items-start gap-x-3 rounded-xl bg-grad-ink/5 p-3 ring-1 ring-grad-rule backdrop-blur-sm transition-colors duration-[var(--dur-base)] hover:bg-grad-ink/10"
        >
          <span
            aria-hidden
            className="grid size-8 place-items-center rounded-lg bg-grad-highlight/15 text-200 font-bold text-grad-highlight"
          >
            {i + 1}
          </span>
          <span>
            <span className="block text-200 font-semibold text-grad-ink">{item.title}</span>
            <span className="mt-0.5 block text-200 leading-relaxed text-grad-ink-soft">
              {item.body}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/* ── controls ───────────────────────────────────────────────────────────── */

const FIELD =
  "mt-1.5 h-11 rounded-xl border-welcome-rule bg-welcome-canvas text-welcome-ink " +
  "placeholder:text-welcome-ink-soft/70 transition-[box-shadow,border-color] " +
  "duration-[var(--dur-fast)] focus-visible:border-welcome-accent " +
  "focus-visible:ring-2 focus-visible:ring-welcome-accent/40";

export function WelcomeLabel({
  htmlFor,
  children,
}: {
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <Label
      htmlFor={htmlFor}
      className="text-100 font-semibold uppercase tracking-[0.12em] text-welcome-ink-soft"
    >
      {children}
    </Label>
  );
}

export function WelcomeField({
  id,
  label,
  hint,
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof Input> & {
  id: string;
  label: string;
  hint?: string;
}) {
  return (
    <div>
      <WelcomeLabel htmlFor={id}>{label}</WelcomeLabel>
      <Input
        id={id}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className={cn(FIELD, className)}
        {...props}
      />
      {hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-100 text-welcome-ink-soft">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A password field with a reveal toggle.
 *
 * Shared, because sign-in and sign-up must behave identically here — a reveal on one and
 * not the other is the sort of difference nobody notices until somebody mistypes a long
 * password they cannot see and blames the account.
 */
export function WelcomePasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  autoComplete: "current-password" | "new-password";
  hint?: string;
}) {
  const [reveal, setReveal] = React.useState(false);

  return (
    <div>
      <WelcomeLabel htmlFor={id}>{label}</WelcomeLabel>
      <div className="relative">
        <Input
          id={id}
          type={reveal ? "text" : "password"}
          autoComplete={autoComplete}
          required
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={hint ? `${id}-hint` : undefined}
          className={cn(FIELD, "pr-16")}
        />
        {/*
          A word, not an eye icon. Two crossed-out-eye glyphs are near-indistinguishable at
          a glance, and this control has to be unambiguous the first time it is seen.
        */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setReveal((v) => !v)}
          aria-pressed={reveal}
          className="absolute inset-y-0 right-1 my-auto h-8 rounded-lg text-100 font-semibold uppercase tracking-wider text-welcome-ink-soft hover:bg-welcome-accent-soft hover:text-welcome-accent"
        >
          {reveal ? "Hide" : "Show"}
        </Button>
      </div>
      {hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-100 text-welcome-ink-soft">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** The primary call to action. Lifts on hover, presses in on click. */
export function WelcomeSubmit({
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof Button>) {
  return (
    <Button
      type="submit"
      className={cn(
        "group h-11 w-full rounded-xl bg-welcome-accent text-100 font-semibold tracking-wide text-welcome-on-accent",
        "shadow-e2 transition-all duration-[var(--dur-fast)]",
        "hover:-translate-y-px hover:bg-welcome-accent hover:opacity-95 hover:shadow-e3",
        "active:translate-y-0 active:shadow-e1",
        "disabled:translate-y-0 disabled:opacity-60 disabled:shadow-e1",
      )}
      {...props}
    >
      {children}
      <ArrowRight
        aria-hidden
        className="size-4 transition-transform duration-[var(--dur-fast)] group-hover:translate-x-0.5"
      />
    </Button>
  );
}

/** The one place an error is allowed to appear on these screens. */
export function WelcomeAlert({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-200 text-destructive"
    >
      {children}
    </p>
  );
}

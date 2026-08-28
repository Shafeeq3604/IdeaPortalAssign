import * as React from "react";
import { Link } from "react-router-dom";
import { Button, Input, Label, cn } from "@iep/ui";
import { ThemeToggle } from "../../app/theme";
import { ORG_NAME, PRODUCT_NAME } from "../../app/product";

/**
 * The frame the two signed-out screens share.
 *
 * Warm paper, a serif masthead, and a column of type with the form beside it — closer to
 * the opening page of a printed handbook than to a product landing page. That is the
 * point. Everything past the door is cool grey and indigo because a working tool should
 * recede; this is the only screen anyone chooses to look at, and it should look like
 * something a person wrote.
 *
 * It uses the `--welcome-*` tokens and nothing else. Those tokens exist for these two
 * screens and are not mapped into the signed-in application.
 *
 * The controls below are shadcn's, restyled through className. They are NOT reimplemented
 * — ADR-019 puts the component layer in @iep/ui and keeps it there, and a warm palette is
 * a skin, not a new component.
 */

export function WelcomeShell({
  eyebrow,
  headline,
  standfirst,
  aside,
  children,
}: {
  /** Small caps above the headline. */
  eyebrow: string;
  /** Set in the display serif. One sentence — it is a masthead, not a pitch. */
  headline: React.ReactNode;
  standfirst: string;
  /** The editorial column under the standfirst. */
  aside: React.ReactNode;
  /** The form. */
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-welcome-canvas text-welcome-ink">
      <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-6 sm:px-10">
        {/* ── masthead ── */}
        <header className="flex items-center justify-between border-b border-welcome-rule py-5">
          <Link
            to="/login"
            className="font-[family-name:var(--font-display)] text-400 font-semibold tracking-tight text-welcome-ink no-underline"
          >
            {ORG_NAME}
            <span className="ml-2 font-sans text-100 font-normal uppercase tracking-[0.18em] text-welcome-ink-soft">
              Ideas
            </span>
          </Link>
          <ThemeToggle />
        </header>

        <main className="grid flex-1 content-center items-start gap-x-16 gap-y-12 py-12 lg:grid-cols-[minmax(0,1fr)_23rem] lg:py-20">
          {/* ── what this is ── */}
          <div className="max-w-[34rem]">
            <p className="text-100 font-medium uppercase tracking-[0.18em] text-welcome-accent">
              {eyebrow}
            </p>
            <h1 className="mt-5 font-[family-name:var(--font-display)] text-700 font-normal leading-[1.1] tracking-[-0.01em] sm:text-800">
              {headline}
            </h1>
            <p className="mt-5 max-w-prose text-300 leading-relaxed text-welcome-ink-soft">
              {standfirst}
            </p>
            <div className="mt-10">{aside}</div>
          </div>

          {/* ── the way in ── */}
          <div className="w-full rounded-xl border border-welcome-rule bg-welcome-surface p-6 shadow-e1 sm:p-8 lg:sticky lg:top-12">
            {children}
          </div>
        </main>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-welcome-rule py-5 text-100 text-welcome-ink-soft">
          <span>{PRODUCT_NAME}</span>
          <span>Confidential · {ORG_NAME} internal use only</span>
        </footer>
      </div>
    </div>
  );
}

/**
 * A numbered list set as a contents page: hairline rules, a figure in the margin, a line
 * of type each.
 *
 * The previous version of this was four cards with four icons, and it read as the feature
 * grid of a marketing site. This reads as a table of contents, which is what it is.
 */
export function ContentsList({
  items,
}: {
  items: readonly { readonly title: string; readonly body: string }[];
}) {
  return (
    <ol className="border-t border-welcome-rule">
      {items.map((item, i) => (
        <li
          key={item.title}
          className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-baseline gap-x-3 border-b border-welcome-rule py-4"
        >
          <span
            aria-hidden
            className="font-[family-name:var(--font-display)] text-400 text-welcome-accent"
          >
            {String(i + 1).padStart(2, "0")}
          </span>
          <span>
            <span className="block text-200 font-medium text-welcome-ink">{item.title}</span>
            <span className="mt-0.5 block text-200 leading-relaxed text-welcome-ink-soft">
              {item.body}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/* ── controls, on warm paper ── */

const FIELD =
  "mt-1.5 border-welcome-rule bg-welcome-canvas text-welcome-ink " +
  "placeholder:text-welcome-ink-soft focus-visible:ring-welcome-accent";

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
      className="text-100 font-medium uppercase tracking-[0.12em] text-welcome-ink-soft"
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
 * Shared because sign-in and sign-up must behave identically here — a reveal on one and
 * not the other is the sort of difference nobody notices until someone mistypes a long
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
          className="absolute inset-y-0 right-0 my-auto h-8 text-100 font-medium uppercase tracking-wider text-welcome-ink-soft hover:bg-transparent hover:text-welcome-accent"
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

export function WelcomeSubmit({
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof Button>) {
  return (
    <Button
      type="submit"
      className="w-full bg-welcome-accent text-welcome-surface hover:bg-welcome-accent hover:opacity-90"
      {...props}
    >
      {children}
    </Button>
  );
}

/** The one place an error is allowed to appear on these screens. */
export function WelcomeAlert({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-md border border-welcome-accent bg-welcome-accent-soft px-3 py-2 text-200 text-welcome-ink"
    >
      {children}
    </p>
  );
}

import type * as React from "react";

/**
 * The gradient hero banner, extended from the Management/Admin dashboard to every page
 * everyone actually lives in.
 *
 * `DashboardHero` (features/rankings/DashboardHero.tsx) introduced `.dash-hero` — the
 * gradient-plus-dot-grid panel, the pulsing "recomputed" chip, the serif headline — but
 * that whole screen is gated to MANAGEMENT/ADMIN (REQUIREMENTS §20). Every other role's
 * first five seconds on Ideas, Rankings, Discover and Submit an idea was a plain h1 and a
 * line of muted text, which is exactly the gap a design review surfaces: the product's
 * best-looking screen belongs to the fewest people.
 *
 * This is that same shell, generalised: an optional pulsing eyebrow, a serif headline
 * (still a real `<h1>` — nothing here changes what a screen reader or a test querying by
 * role sees), an optional line of description, optional actions, and an optional aside
 * for a stat panel. Content is supplied per page rather than assumed, so a page with
 * nothing true to put in the aside simply doesn't render one — CLAUDE.md's rule against
 * inventing a number applies here exactly as it does on the dashboard itself.
 */
export function PageHero({
  eyebrow,
  heading,
  description,
  actions,
  aside,
}: {
  eyebrow?: React.ReactNode;
  heading: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <div className="dash-hero relative mb-6 overflow-hidden rounded-2xl p-6 text-grad-ink shadow-e4 sm:p-7">
      <div className="relative flex flex-wrap items-start justify-between gap-6">
        <div className="max-w-[60ch]">
          {eyebrow ? (
            <span className="inline-flex items-center gap-2 rounded-full bg-grad-ink/10 px-3 py-1 text-100 uppercase tracking-[0.06em] text-grad-ink-soft ring-1 ring-grad-rule">
              <span aria-hidden className="dash-pulse size-1.5 rounded-full bg-grad-highlight" />
              {eyebrow}
            </span>
          ) : null}

          <h1
            className={`font-serif font-semibold leading-tight tracking-tight text-grad-ink text-600 sm:text-700 ${eyebrow ? "mt-3.5" : ""}`}
          >
            {heading}
          </h1>

          {description ? (
            <p className="mt-2.5 text-300 leading-relaxed text-grad-ink-soft">{description}</p>
          ) : null}

          {actions ? <div className="mt-5 flex flex-wrap gap-2.5">{actions}</div> : null}
        </div>

        {aside ? <div className="w-full max-w-[16rem] shrink-0">{aside}</div> : null}
      </div>
    </div>
  );
}

/** One real figure, styled like `DashboardHero`'s own `Stat` — reused so a hero's aside
 * panel never has to invent its own numeral treatment. */
export function HeroStat({ value, label }: { value: string; label: string }) {
  return (
    <span>
      <b className="block font-serif text-500 font-semibold leading-none tabular-nums text-grad-highlight">
        {value}
      </b>
      <span className="mt-1 block text-100 text-grad-ink-soft">{label}</span>
    </span>
  );
}

/** A hero action styled as the primary amber pill (matches DashboardHero's "Review N
 * ideas" / the header bar's "New idea" — the one call to action a hero makes, always
 * amber, always this shape). Renders as a plain <span>'s child via `asChild`-less usage:
 * wrap a <Link> or <button> in this for the visual treatment. */
export const HERO_PRIMARY_ACTION =
  "inline-flex h-9 items-center gap-2 rounded-full bg-grad-highlight px-4 text-100 font-bold text-grad-from no-underline shadow-e2 transition-transform duration-[var(--dur-fast)] hover:-translate-y-px";

/** A hero action styled as the secondary ghost pill (matches DashboardHero's "See the
 * board"). */
export const HERO_SECONDARY_ACTION =
  "inline-flex h-9 items-center gap-2 rounded-full bg-grad-ink/10 px-4 text-100 font-semibold text-grad-ink no-underline ring-1 ring-grad-rule transition-colors duration-[var(--dur-fast)] hover:bg-grad-ink/20";

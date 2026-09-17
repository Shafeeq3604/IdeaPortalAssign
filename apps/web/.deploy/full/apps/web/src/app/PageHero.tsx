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
  icon: Icon,
  eyebrow,
  heading,
  description,
  actions,
  aside,
}: {
  /** A per-page identity mark, tinted amber to match the hero's own accent — so a page
   * with nothing else to distinguish it from its neighbours still reads as itself at a
   * glance, the same way each sidebar destination already carries its own icon. */
  icon?: React.ComponentType<{ className?: string }>;
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
            className={`flex items-center gap-3 font-serif font-semibold leading-tight tracking-tight text-grad-ink text-600 sm:text-700 ${eyebrow ? "mt-3.5" : ""}`}
          >
            {Icon ? (
              <span
                aria-hidden
                className="grid size-9 shrink-0 place-items-center rounded-xl bg-grad-highlight/20 text-grad-highlight ring-1 ring-grad-rule sm:size-10"
              >
                <Icon className="size-4.5 sm:size-5" />
              </span>
            ) : null}
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

/**
 * The plain heading for a "working" page — one someone operates rather than arrives at.
 *
 * `PageHero` used to open every single routed page, landing or working alike: Submit an
 * idea, Rankings, Criteria, the Review queue and both admin screens got the identical
 * gradient-plus-dot-grid banner as the Dashboard and Discover, so nothing distinguished
 * "somewhere I arrive" from "somewhere I operate thirty times a day," and eleven
 * unmodified copies of the same component read as a template rather than a design.
 *
 * This keeps the one piece of hero furniture worth keeping on a working page — a per-page
 * icon, so the destination is still identifiable at a glance — and drops the rest: no
 * gradient, no dot texture, no serif display type. `<h1>` is a direct child of `.page`
 * here on purpose (index.css's `.page > h1::after` rule), so the same short gradient
 * underline that already marks every plain heading in the product (IdeaShell, the
 * People/Department pages) marks this one too, instead of inventing a second identity
 * mark for "a heading with an icon."
 */
export function PageHeading({
  icon: Icon,
  heading,
  description,
  actions,
  stats,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  heading: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** A small inline figure or two — the thing an aside stat panel would have carried on
   * the old hero, sized down to fit beside a plain heading instead of inside a card. */
  stats?: React.ReactNode;
}) {
  return (
    <>
      <h1 className="flex flex-wrap items-center gap-3">
        {Icon ? (
          <span
            aria-hidden
            className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-100 text-accent-700"
          >
            <Icon className="size-4" />
          </span>
        ) : null}
        {heading}
      </h1>

      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-2">
        {description ? <p className="muted mb-0 max-w-[60ch]">{description}</p> : <span />}
        {stats ? <div className="mb-8 flex shrink-0 gap-6">{stats}</div> : null}
      </div>

      {actions ? <div className="-mt-4 mb-8 flex flex-wrap gap-2.5">{actions}</div> : null}
    </>
  );
}

/** A compact inline figure for `PageHeading`'s `stats` slot — same numeral treatment as
 * `HeroStat`, sized for sitting beside a plain heading rather than inside a hero card. */
export function InlineStat({ value, label }: { value: string; label: string }) {
  return (
    <span className="text-right">
      <b className="block font-serif text-400 font-semibold leading-none tabular-nums text-accent-700">
        {value}
      </b>
      <span className="mt-1 block text-100 text-muted-foreground">{label}</span>
    </span>
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

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
    <div className="dash-hero relative mb-6 overflow-hidden rounded-2xl p-6 text-grad-ink shadow-e4-lit sm:p-8">
      <div className="relative flex flex-wrap items-center justify-between gap-6">
        <div className="min-w-0 max-w-[64ch] flex-[1_1_24rem]">
          {eyebrow ? (
            <span className="inline-flex items-center gap-2 rounded-full bg-grad-ink/10 px-3 py-1 text-100 font-bold uppercase tracking-[0.08em] text-grad-ink-soft ring-1 ring-grad-rule">
              <span aria-hidden className="dash-pulse size-1.5 rounded-full bg-grad-highlight" />
              {eyebrow}
            </span>
          ) : null}

          <h1
            className={`flex items-center gap-3 text-600 font-extrabold leading-tight tracking-tight text-balance text-grad-ink sm:text-700 ${eyebrow ? "mt-4" : ""}`}
          >
            {Icon ? (
              <span
                aria-hidden
                className="grid size-10 shrink-0 place-items-center rounded-xl bg-grad-highlight/20 text-grad-highlight ring-1 ring-grad-rule sm:size-11"
              >
                <Icon className="size-5" />
              </span>
            ) : null}
            {heading}
          </h1>

          {description ? (
            <p className="mt-3 text-300 leading-relaxed text-grad-ink-soft">{description}</p>
          ) : null}

          {actions ? <div className="mt-6 flex flex-wrap gap-3">{actions}</div> : null}
        </div>

        {aside ? <div className="hero-panel w-full max-w-[17rem] shrink-0 rounded-2xl p-4.5">{aside}</div> : null}
      </div>
    </div>
  );
}

/**
 * The heading for a "working" page — one someone operates rather than arrives at.
 *
 * Deliberately NOT the navy hero: a page used thirty times a day should open on its
 * content, not a banner. P9 ("richer, enterprise-grade look") gives it the mockups'
 * treatment instead — an icon chip, an 800-weight title, a description, and any real
 * figures as the same bordered KPI cards the dashboard uses, so every page reads as the
 * same product.
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
  /** A small figure or two (`HeadingStat` / `InlineStat`). */
  stats?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
      <div className="min-w-0 max-w-[68ch] flex-[1_1_26rem]">
        <h1 className="flex flex-wrap items-center gap-3">
          {Icon ? (
            <span
              aria-hidden
              className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-100 text-accent-700 shadow-e1"
            >
              <Icon className="size-5" />
            </span>
          ) : null}
          {heading}
        </h1>
        {description ? <p className="mt-2 text-300 leading-relaxed text-muted-foreground">{description}</p> : null}
        {actions ? <div className="mt-5 flex flex-wrap gap-2.5">{actions}</div> : null}
      </div>
      {stats ? <div className="flex shrink-0 flex-wrap gap-3">{stats}</div> : null}
    </div>
  );
}

/** A `PageHeading` figure as a small KPI card — the dashboard's own card treatment. */
export function HeadingStat({
  icon: Icon, value, label,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: string;
  label: string;
}) {
  return (
    <div className="flex min-w-[9.5rem] shrink-0 flex-col gap-2 rounded-2xl border border-border bg-card px-4 py-3.5 shadow-e2">
      <span className="flex items-center justify-between gap-3">
        <span className="text-100 font-semibold text-muted-foreground first-letter:uppercase">{label}</span>
        <span aria-hidden className="grid size-7 place-items-center rounded-lg bg-accent-100 text-accent-700">
          <Icon className="size-3.5" />
        </span>
      </span>
      <span className="text-600 font-extrabold leading-none tracking-tight tabular-nums text-foreground">
        {value}
      </span>
    </div>
  );
}

/** A compact figure for `PageHeading`'s `stats` slot, as a small bordered card. */
export function InlineStat({ value, label }: { value: string; label: string }) {
  return (
    <span className="flex min-w-[7.5rem] flex-col rounded-2xl border border-border bg-card px-4 py-3 shadow-e2">
      <span className="text-100 font-semibold text-muted-foreground first-letter:uppercase">{label}</span>
      <b className="mt-1 block text-500 font-extrabold leading-none tracking-tight tabular-nums text-foreground">
        {value}
      </b>
    </span>
  );
}

/** One real figure inside a hero's aside panel. */
export function HeroStat({ value, label }: { value: string; label: string }) {
  return (
    <span>
      <b className="block text-600 font-extrabold leading-none tracking-tight tabular-nums text-grad-ink">
        {value}
      </b>
      <span className="mt-1.5 block text-100 text-grad-ink-soft">{label}</span>
    </span>
  );
}

/** A hero's primary action — the dashboard hero's own button shape. Wrap a <Link> or
 * <button> in this for the visual treatment. */
export const HERO_PRIMARY_ACTION =
  "inline-flex h-11 items-center gap-2 rounded-xl bg-grad-highlight px-5 text-200 font-extrabold text-grad-from no-underline shadow-[0_8px_24px_-8px_var(--grad-highlight)] transition-transform duration-[var(--dur-fast)] hover:-translate-y-px";

/** A hero's secondary action (the dashboard hero's "See the board"). */
export const HERO_SECONDARY_ACTION =
  "inline-flex h-11 items-center gap-2 rounded-xl px-5 text-200 font-bold text-grad-ink no-underline ring-1 ring-inset ring-grad-ink/25 transition-colors duration-[var(--dur-fast)] hover:bg-grad-ink/10";

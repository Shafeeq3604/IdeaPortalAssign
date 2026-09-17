/**
 * The product's own mark — three ascending bars culminating in a spark.
 *
 * Design-audit finding: every brand touchpoint (sign-in, the authenticated header, the
 * loading skeleton, the browser tab) used a generic `Sparkles` glyph — the same icon any
 * AI-flavoured product reaches for, carrying no relationship to what this one actually
 * does. This glyph draws the product's own mechanic instead: ideas get scored, ranked
 * against each other, and the one that rises to the top does so with a spark, not a
 * guess. It replaces `Sparkles` everywhere that icon was standing in for a logo — nowhere
 * else; `Sparkles` stays exactly where it already meant "AI" (Discover's nav icon, the
 * provenance badge), because overloading one glyph for two different meanings is its own
 * kind of inconsistency.
 *
 * Drawn stroke-first at lucide's own geometry (24×24 viewBox, 2px stroke, round caps) so
 * it sits in the same icon family as every other glyph in the product rather than reading
 * as an imported asset. `currentColor` throughout — same drop-in usage as any lucide icon:
 * size and color come from the className the caller already applies.
 */
export function BrandMark({
  className,
  "aria-hidden": ariaHidden = true,
}: {
  className?: string;
  "aria-hidden"?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={ariaHidden}
    >
      <path d="M5 19v-4" />
      <path d="M12 19v-8" />
      <path d="M19 19V8" />
      <circle cx="19" cy="4.5" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

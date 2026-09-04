import { ArrowRight, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "../../lib/utils.js";
import type { DiffViewProps, TimelineProps } from "./types.js";

/**
 * Version history primitives (SPEC §7.6), against their P0-frozen signatures.
 *
 * FR-24's claim is that an employee can see their idea improve. That only lands if the
 * before and after are on the same screen — a list of versions with today's score against
 * every row tells the opposite story.
 */

/* ══════════════════════════════════════════════════════════════════
 * Timeline — versions with what each one changed.
 * ══════════════════════════════════════════════════════════════════ */

function Delta({
  before, after, lowerIsBetter = false, unit = "",
}: {
  before: number | null;
  after: number | null;
  lowerIsBetter?: boolean;
  unit?: string;
}) {
  if (after === null) {
    return <span className="text-100 text-muted-foreground">not evaluated</span>;
  }
  if (before === null) {
    return (
      <span className="text-100 tabular-nums text-muted-foreground">
        {unit}
        {after.toFixed(unit === "#" ? 0 : 1)} · first measurement
      </span>
    );
  }

  const raw = after - before;
  // For rank, DOWN is up. Getting this backwards is the easiest bug here and the least
  // likely to be spotted, so the direction is a parameter rather than an assumption.
  const improved = lowerIsBetter ? raw < 0 : raw > 0;
  const unchanged = Math.abs(raw) < 0.05;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-100 tabular-nums",
        unchanged ? "text-muted-foreground" : improved ? "text-factor-up" : "text-factor-down",
      )}
    >
      {unit}
      {before.toFixed(unit === "#" ? 0 : 1)}
      <ArrowRight aria-hidden className="size-3" />
      {unit}
      {after.toFixed(unit === "#" ? 0 : 1)}
      {unchanged ? (
        <Minus aria-hidden className="size-3" />
      ) : improved ? (
        <TrendingUp aria-hidden className="size-3" />
      ) : (
        <TrendingDown aria-hidden className="size-3" />
      )}
      <span className="sr-only">{unchanged ? "unchanged" : improved ? "improved" : "declined"}</span>
    </span>
  );
}

export function Timeline({ entries }: TimelineProps) {
  if (entries.length === 0) return null;

  return (
    <ol className="space-y-0">
      {entries.map((entry, i) => (
        <li key={entry.versionNo} className="relative border-l-2 border-border pb-6 pl-6 last:pb-0">
          <span
            aria-hidden
            className="absolute -left-[5px] top-1 size-2 rounded-full bg-primary"
          />
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-300 font-medium">Version {entry.versionNo}</span>
            <span className="text-100 text-muted-foreground">
              {entry.author} · {new Date(entry.at).toLocaleDateString()}
            </span>
          </div>

          <p className="mt-1 text-200">
            {entry.changeSummary ?? "The first version, as submitted."}
          </p>

          <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1">
            <div className="flex items-baseline gap-2">
              <dt className="text-100 text-muted-foreground">Score</dt>
              <dd>
                <Delta before={entry.compositeBefore} after={entry.compositeAfter} />
              </dd>
            </div>
            <div className="flex items-baseline gap-2">
              <dt className="text-100 text-muted-foreground">Rank</dt>
              <dd>
                <Delta
                  before={entry.rankBefore}
                  after={entry.rankAfter}
                  lowerIsBetter
                  unit="#"
                />
              </dd>
            </div>
            <div className="flex items-baseline gap-2">
              <dt className="text-100 text-muted-foreground">Maturity</dt>
              <dd className="text-100 tabular-nums">Level {entry.maturity}</dd>
            </div>
          </dl>

          {/* The comparison only means anything against the version before it. */}
          {i < entries.length - 1 ? (
            <p className="mt-1 text-100 text-muted-foreground">
              Compared with version {entries[i + 1]?.versionNo}.
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

/* ══════════════════════════════════════════════════════════════════
 * DiffView — what actually changed between two versions.
 * ══════════════════════════════════════════════════════════════════ */

/**
 * Field-level, not character-level.
 *
 * A word-diff of a rewritten paragraph is noise; what a reader wants to know is which
 * of the eleven fields moved, and what each now says. Unchanged fields are collapsed to
 * a single line so the changed ones are the page.
 */
export function DiffView({ before, after, fieldLabels }: DiffViewProps) {
  const keys = [...new Set([...Object.keys(fieldLabels), ...Object.keys(after)])];

  const rows = keys.map((key) => {
    const from = (before[key] ?? "").trim();
    const to = (after[key] ?? "").trim();
    return {
      key,
      label: fieldLabels[key] ?? key,
      from,
      to,
      state: from === to ? "same" : from === "" ? "added" : to === "" ? "removed" : "changed",
    } as const;
  });

  const changed = rows.filter((r) => r.state !== "same");
  const unchanged = rows.filter((r) => r.state === "same" && r.to !== "");

  return (
    <div className="space-y-5">
      {changed.length === 0 ? (
        <p className="text-200 text-muted-foreground">
          Nothing in the submission changed between these versions.
        </p>
      ) : (
        changed.map((row) => (
          <div key={row.key}>
            <h4 className="text-200 font-medium">
              {row.label}
              <span className="ml-2 text-100 font-normal text-muted-foreground">
                {row.state === "added" ? "added" : row.state === "removed" ? "removed" : "rewritten"}
              </span>
            </h4>

            {row.from ? (
              <p className="mt-1 whitespace-pre-wrap border-l-2 border-factor-down bg-factor-down-bg/40 px-3 py-2 text-200">
                {row.from}
              </p>
            ) : null}
            {row.to ? (
              <p className="mt-1 whitespace-pre-wrap border-l-2 border-factor-up bg-factor-up-bg/40 px-3 py-2 text-200">
                {row.to}
              </p>
            ) : null}
          </div>
        ))
      )}

      {unchanged.length > 0 ? (
        <p className="text-100 text-muted-foreground">
          Unchanged: {unchanged.map((r) => r.label).join(", ")}.
        </p>
      ) : null}
    </div>
  );
}

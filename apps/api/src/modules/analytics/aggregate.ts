/**
 * Pure aggregation helpers for P14 analytics — no I/O, so they are unit-tested directly
 * (aggregate.test.ts) rather than only through a real database.
 */

const DAY_MS = 86_400_000;

/** Median of a list, or null for an empty one — "no data" is never reported as 0. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const hi = sorted[mid] ?? 0;
  return sorted.length % 2 === 1 ? hi : ((sorted[mid - 1] ?? hi) + hi) / 2;
}

/** Whole-and-fractional days from `from` to `to`, rounded to one decimal. Negative → dropped by caller. */
export function daysBetween(from: Date, to: Date): number {
  return Math.round(((to.getTime() - from.getTime()) / DAY_MS) * 10) / 10;
}

/** `YYYY-MM` in UTC. */
export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The first instant (UTC) of the month `monthsBack` months before `now`'s month. */
export function startOfMonthUtc(now: Date, monthsBack: number): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 1));
}

/** The last `count` calendar months ending with `now`'s, oldest first, zero-filled. */
export function bucketByMonth(
  dates: readonly Date[],
  now: Date,
  count = 12,
): { month: string; count: number }[] {
  const buckets = new Map<string, number>();
  for (let i = count - 1; i >= 0; i--) buckets.set(monthKey(startOfMonthUtc(now, i)), 0);
  for (const d of dates) {
    const key = monthKey(d);
    const current = buckets.get(key);
    if (current !== undefined) buckets.set(key, current + 1);
  }
  return [...buckets].map(([month, n]) => ({ month, count: n }));
}

/** Plain mean, rounded to one decimal, or null when there is nothing to average. */
export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10;
}

/**
 * Earliest timestamp per key. Used for "first score" and "first review": each idea may
 * have many evaluations and many reviews, and a cycle time measures the first of each.
 */
export function earliestBy<T>(rows: readonly T[], key: (r: T) => string, at: (r: T) => Date): Map<string, Date> {
  const out = new Map<string, Date>();
  for (const r of rows) {
    const k = key(r);
    const t = at(r);
    const prev = out.get(k);
    if (!prev || t < prev) out.set(k, t);
  }
  return out;
}

/** Durations (days) between two keyed timestamps, keeping only pairs in the right order. */
export function pairedDurations(starts: ReadonlyMap<string, Date>, ends: ReadonlyMap<string, Date>): number[] {
  const out: number[] = [];
  for (const [k, start] of starts) {
    const end = ends.get(k);
    if (end && end >= start) out.push(daysBetween(start, end));
  }
  return out;
}

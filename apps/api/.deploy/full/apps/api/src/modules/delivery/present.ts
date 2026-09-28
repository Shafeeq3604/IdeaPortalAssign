import type { CriterionDirection, KpiVersusPredicted } from "@iep/contracts";

/**
 * P16 arithmetic — pure, so every rule is unit-tested (present.test.ts).
 *
 * Both functions only combine numbers a person entered. Neither estimates anything, and
 * both answer "cannot say" (null) rather than a number whenever an input is missing or
 * the ratio is undefined.
 */

/** (benefit − investment) / investment. Null unless both are entered and investment > 0. */
export function computeRoi(investment: number | null, benefit: number | null): number | null {
  if (investment === null || benefit === null || investment <= 0) return null;
  return Math.round(((benefit - investment) / investment) * 10_000) / 10_000;
}

/**
 * Latest actual against the prediction. The direction decides only the wording: for a
 * LOWER_IS_BETTER KPI (e.g. hours spent), coming in under the prediction is AHEAD.
 * An exact tie is ON_PREDICTION — no tolerance band is invented.
 */
export function versusPredicted(
  predicted: number | null,
  latestActual: number | null,
  direction: CriterionDirection,
): KpiVersusPredicted | null {
  if (predicted === null || latestActual === null) return null;
  const difference = Math.round((latestActual - predicted) * 1000) / 1000;
  const percent = predicted === 0 ? null : Math.round((difference / Math.abs(predicted)) * 1000) / 10;
  const better = direction === "HIGHER_IS_BETTER" ? difference > 0 : difference < 0;
  const standing = difference === 0 ? "ON_PREDICTION" : better ? "AHEAD" : "BEHIND";
  return { difference, percent, standing };
}

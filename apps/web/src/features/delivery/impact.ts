import type { IdeaDeliveryResponse, KpiView, PilotOutcome } from "@iep/contracts";

/**
 * "What did this idea achieve?" — the Delivery tab's figures turned into plain sentences
 * for the submitter, the team and everyone else who can open the idea.
 *
 * Only arithmetic on figures a person entered (P16): nothing is estimated, no AI writes
 * a word of it, and none of it touches the score (P-5). Where nothing was entered the
 * answer is "not measured yet", never a guess. Pure, so every sentence is unit-tested.
 */

export type ResultStanding = "AHEAD" | "ON_PREDICTION" | "BEHIND" | "MEASURED" | "PREDICTED_ONLY" | "NOT_SET";

export interface KpiResult {
  readonly id: string;
  readonly name: string;
  /** One sentence, e.g. "120 hours a month, against 100 predicted — 20% better than predicted." */
  readonly sentence: string;
  readonly standing: ResultStanding;
  /** The latest measured figure with its unit, for the big number; null before any. */
  readonly headline: string | null;
}

export interface MoneyResult {
  readonly benefit: string | null;
  readonly investment: string | null;
  /** "Returned 1.8× what was invested" style line, or null when the ROI cannot be said. */
  readonly roiSentence: string | null;
  readonly roiPercent: string | null;
  readonly positive: boolean | null;
  readonly basisNote: string | null;
}

export interface ImpactSummary {
  readonly results: readonly KpiResult[];
  readonly money: MoneyResult | null;
  readonly pilotOutcome: PilotOutcome | null;
  /** At least one real measurement or money figure exists. */
  readonly hasMeasuredAnything: boolean;
  /** One line that answers "was it worth it?" as far as the figures allow. */
  readonly headline: string;
}

export const fmtFigure = (n: number): string => n.toLocaleString(undefined, { maximumFractionDigits: 3 });

export function fmtMoney(amount: number | null, currency: string): string | null {
  if (amount === null) return null;
  try {
    return amount.toLocaleString(undefined, { style: "currency", currency, maximumFractionDigits: 0 });
  } catch {
    return `${amount.toLocaleString()} ${currency}`;
  }
}

const withUnit = (n: number, unit: string) => (unit ? `${fmtFigure(n)} ${unit}` : fmtFigure(n));

export function kpiResult(kpi: KpiView): KpiResult {
  const latest = kpi.measurements.at(-1);
  const target = kpi.targetValue !== null ? `; target ${withUnit(kpi.targetValue, kpi.unit)}` : "";

  if (!latest) {
    if (kpi.predictedValue !== null) {
      return {
        id: kpi.id, name: kpi.name, headline: null, standing: "PREDICTED_ONLY",
        sentence: `Predicted ${withUnit(kpi.predictedValue, kpi.unit)}${target}. Not measured yet.`,
      };
    }
    return { id: kpi.id, name: kpi.name, headline: null, standing: "NOT_SET", sentence: "Not measured yet." };
  }

  const actual = withUnit(latest.actualValue, kpi.unit);
  const vs = kpi.versusPredicted;
  if (!vs || kpi.predictedValue === null) {
    return { id: kpi.id, name: kpi.name, headline: actual, standing: "MEASURED", sentence: `Measured ${actual}${target}.` };
  }
  const predicted = withUnit(kpi.predictedValue, kpi.unit);
  const by = vs.percent !== null ? `${fmtFigure(Math.abs(vs.percent))}% ` : "";
  const verdict =
    vs.standing === "ON_PREDICTION"
      ? "exactly as predicted"
      : vs.standing === "AHEAD"
        ? `${by}better than predicted`
        : `${by}short of the prediction`;
  return {
    id: kpi.id, name: kpi.name, headline: actual, standing: vs.standing,
    sentence: `${actual}, against ${predicted} predicted — ${verdict}${target}.`,
  };
}

export function moneyResult(d: IdeaDeliveryResponse): MoneyResult | null {
  const f = d.financials;
  if (!f || (f.realizedBenefit === null && f.investmentToDate === null)) return null;
  const roi = f.roi;
  return {
    benefit: fmtMoney(f.realizedBenefit, f.currency),
    investment: fmtMoney(f.investmentToDate, f.currency),
    roiPercent: roi !== null ? `${roi >= 0 ? "+" : ""}${fmtFigure(Math.round(roi * 1000) / 10)}%` : null,
    roiSentence:
      roi === null
        ? null
        : roi >= 0
          ? `Returned ${fmtFigure(Math.round((roi + 1) * 10) / 10)}× what was invested so far.`
          : `Has returned ${fmtFigure(Math.round((roi + 1) * 100))}% of what was invested so far.`,
    positive: roi === null ? null : roi >= 0,
    basisNote: f.basisNote,
  };
}

export function impactSummary(d: IdeaDeliveryResponse): ImpactSummary {
  const results = d.kpis.map(kpiResult);
  const money = moneyResult(d);
  const measured = results.filter((r) => r.headline !== null);
  const hasMeasuredAnything = measured.length > 0 || money !== null;
  const ahead = results.filter((r) => r.standing === "AHEAD" || r.standing === "ON_PREDICTION").length;
  const compared = results.filter((r) => ["AHEAD", "ON_PREDICTION", "BEHIND"].includes(r.standing)).length;

  let headline: string;
  if (!hasMeasuredAnything) {
    headline = results.length > 0 ? "Success measures are set — results are not in yet." : "No results have been recorded yet.";
  } else if (money?.roiSentence && compared > 0) {
    headline = `${money.roiSentence} ${ahead} of ${compared} measures on or ahead of prediction.`;
  } else if (money?.roiSentence) {
    headline = money.roiSentence;
  } else if (compared > 0) {
    headline = `${ahead} of ${compared} measures on or ahead of prediction.`;
  } else {
    headline = `${measured.length} ${measured.length === 1 ? "result" : "results"} recorded so far.`;
  }

  return { results, money, pilotOutcome: d.pilot?.outcome ?? null, hasMeasuredAnything, headline };
}

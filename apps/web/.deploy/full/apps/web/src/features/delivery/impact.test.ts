import { describe, expect, it } from "vitest";
import type { IdeaDeliveryResponse, KpiView } from "@iep/contracts";
import { impactSummary, kpiResult, moneyResult } from "./impact";

const NOW = "2026-09-25T10:00:00.000Z";

function kpi(overrides: Partial<KpiView> = {}): KpiView {
  return {
    id: "k1", name: "Hours saved", unit: "hours", description: null, direction: "HIGHER_IS_BETTER",
    targetValue: null, predictedValue: null, measurements: [], versusPredicted: null, createdAt: NOW,
    ...overrides,
  };
}

const measured = (actualValue: number) => [{ id: "m1", actualValue, measuredAt: NOW, note: null, recordedBy: null }];

function delivery(overrides: Partial<IdeaDeliveryResponse> = {}): IdeaDeliveryResponse {
  return {
    ideaId: "i1", status: "PILOT", canWrite: false, inDeliveryStage: true,
    pilot: null, updates: [], kpis: [], financials: null, ...overrides,
  };
}

describe("kpiResult — one plain sentence per success measure", () => {
  it("says a measure is not measured yet, and never invents a figure", () => {
    expect(kpiResult(kpi())).toMatchObject({ standing: "NOT_SET", headline: null, sentence: "Not measured yet." });
    expect(kpiResult(kpi({ predictedValue: 100, targetValue: 90 }))).toMatchObject({
      standing: "PREDICTED_ONLY", headline: null, sentence: "Predicted 100 hours; target 90 hours. Not measured yet.",
    });
  });

  it("compares the latest result with the prediction, using the engine's own standing", () => {
    const r = kpiResult(kpi({
      predictedValue: 100, measurements: measured(120),
      versusPredicted: { difference: 20, percent: 20, standing: "AHEAD" },
    }));
    expect(r.headline).toBe("120 hours");
    expect(r.sentence).toBe("120 hours, against 100 hours predicted — 20% better than predicted.");
  });

  it("says when it came in short, without calling the idea a failure", () => {
    const r = kpiResult(kpi({
      predictedValue: 100, measurements: measured(80),
      versusPredicted: { difference: -20, percent: -20, standing: "BEHIND" },
    }));
    expect(r.sentence).toBe("80 hours, against 100 hours predicted — 20% short of the prediction.");
  });

  it("reports a measurement with no prediction as just that", () => {
    expect(kpiResult(kpi({ measurements: measured(42) })).sentence).toBe("Measured 42 hours.");
  });
});

describe("moneyResult — only what was entered", () => {
  it("is absent when no money figure was entered", () => {
    expect(moneyResult(delivery())).toBeNull();
  });

  it("states the return as a multiple when positive, and as a share when not", () => {
    const up = moneyResult(delivery({
      financials: { currency: "USD", investmentToDate: 1000, realizedBenefit: 1800, basisNote: null, roi: 0.8, updatedBy: null, updatedAt: NOW },
    }));
    expect(up).toMatchObject({ roiPercent: "+80%", roiSentence: "Returned 1.8× what was invested so far.", positive: true });

    const down = moneyResult(delivery({
      financials: { currency: "USD", investmentToDate: 1000, realizedBenefit: 400, basisNote: null, roi: -0.6, updatedBy: null, updatedAt: NOW },
    }));
    expect(down).toMatchObject({ roiPercent: "-60%", roiSentence: "Has returned 40% of what was invested so far.", positive: false });
  });

  it("gives no return figure when only one side was entered", () => {
    const partial = moneyResult(delivery({
      financials: { currency: "USD", investmentToDate: 1000, realizedBenefit: null, basisNote: null, roi: null, updatedBy: null, updatedAt: NOW },
    }));
    expect(partial).toMatchObject({ benefit: null, roiSentence: null, roiPercent: null });
  });
});

describe("impactSummary — the one-line answer", () => {
  it("says results are not in yet when measures exist but nothing is measured", () => {
    expect(impactSummary(delivery({ kpis: [kpi({ predictedValue: 5 })] }))).toMatchObject({
      hasMeasuredAnything: false, headline: "Success measures are set — results are not in yet.",
    });
    expect(impactSummary(delivery()).headline).toBe("No results have been recorded yet.");
  });

  it("combines money and measures when both exist", () => {
    const s = impactSummary(delivery({
      kpis: [
        kpi({ id: "a", predictedValue: 100, measurements: measured(120), versusPredicted: { difference: 20, percent: 20, standing: "AHEAD" } }),
        kpi({ id: "b", predictedValue: 10, measurements: measured(8), versusPredicted: { difference: -2, percent: -20, standing: "BEHIND" } }),
      ],
      financials: { currency: "USD", investmentToDate: 1000, realizedBenefit: 1800, basisNote: null, roi: 0.8, updatedBy: null, updatedAt: NOW },
    }));
    expect(s.headline).toBe("Returned 1.8× what was invested so far. 1 of 2 measures on or ahead of prediction.");
  });
});

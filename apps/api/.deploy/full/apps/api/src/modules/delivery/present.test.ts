import { describe, expect, it } from "vitest";
import { computeRoi, versusPredicted } from "./present.js";

describe("P16 ROI", () => {
  it("is (benefit − investment) / investment as a ratio", () => {
    expect(computeRoi(1000, 1250)).toBe(0.25);
    expect(computeRoi(1000, 600)).toBe(-0.4);
  });
  it("says nothing rather than guessing when an input is missing or the investment is zero", () => {
    expect(computeRoi(null, 500)).toBeNull();
    expect(computeRoi(1000, null)).toBeNull();
    expect(computeRoi(0, 500)).toBeNull();
  });
});

describe("P16 actual vs predicted", () => {
  it("is ahead when a higher-is-better KPI beats its prediction", () => {
    expect(versusPredicted(100, 120, "HIGHER_IS_BETTER")).toEqual({ difference: 20, percent: 20, standing: "AHEAD" });
  });
  it("is ahead when a lower-is-better KPI comes in under its prediction", () => {
    expect(versusPredicted(40, 30, "LOWER_IS_BETTER")).toEqual({ difference: -10, percent: -25, standing: "AHEAD" });
  });
  it("is behind otherwise, on prediction only on an exact tie, and has no percent against a zero prediction", () => {
    expect(versusPredicted(100, 90, "HIGHER_IS_BETTER")?.standing).toBe("BEHIND");
    expect(versusPredicted(100, 100, "HIGHER_IS_BETTER")?.standing).toBe("ON_PREDICTION");
    expect(versusPredicted(0, 5, "HIGHER_IS_BETTER")?.percent).toBeNull();
  });
  it("is null without a prediction or a measurement", () => {
    expect(versusPredicted(null, 5, "HIGHER_IS_BETTER")).toBeNull();
    expect(versusPredicted(5, null, "HIGHER_IS_BETTER")).toBeNull();
  });
});

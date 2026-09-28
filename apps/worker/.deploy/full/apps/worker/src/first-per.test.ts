import { describe, expect, it } from "vitest";
import { firstPer } from "./pipeline.js";

/**
 * The real model once returned two feasibility findings for one dimension, which the
 * database's one-per-dimension constraint rejected and the whole step failed. `firstPer`
 * is what the write path now uses to keep the model's first answer per key.
 */
describe("firstPer", () => {
  it("keeps the first item for each key, in the original order", () => {
    const findings = [
      { dimension: "TECHNICAL", band: "HIGH" },
      { dimension: "DATA", band: "LOW" },
      { dimension: "TECHNICAL", band: "LOW" },
    ];
    expect(firstPer(findings, (f) => f.dimension)).toEqual([
      { dimension: "TECHNICAL", band: "HIGH" },
      { dimension: "DATA", band: "LOW" },
    ]);
  });

  it("leaves a list with no repeats untouched", () => {
    const phases = [{ phase: "DISCOVERY" }, { phase: "MVP" }];
    expect(firstPer(phases, (p) => p.phase)).toEqual(phases);
  });
});

import { describe, expect, it } from "vitest";
import { isEmptyFilter, parseSmartFilter } from "./smart-filter";

const vocabulary = {
  departments: [
    { id: "d-ops", name: "Operations" },
    { id: "d-fin", name: "Finance" },
    { id: "d-cs", name: "Customer Success" },
  ],
  categories: [
    { id: "c-auto", name: "Process automation" },
    { id: "c-auto", name: "process automation" },
  ],
};

describe("parseSmartFilter (P20 smart filters)", () => {
  it("finds a department and a stage", () => {
    const f = parseSmartFilter("Pilots in Operations", vocabulary);
    expect(f.department?.id).toBe("d-ops");
    expect(f.statuses).toEqual(["PILOT"]);
    expect(f.keyword).toBeUndefined();
  });

  it("prefers the longest department name, and ignores case", () => {
    const f = parseSmartFilter("ideas from the customer success team", vocabulary);
    expect(f.department?.id).toBe("d-cs");
  });

  it("reads 'best ranked' as an order, not a filter", () => {
    const f = parseSmartFilter("Best ranked ideas in Finance", vocabulary);
    expect(f.department?.id).toBe("d-fin");
    expect(f.sort).toBe("rank");
    // Not also a "Ranked" stage filter — that would hide ideas further along.
    expect(f.statuses).toEqual([]);
  });

  it("groups 'being built' as every delivery stage", () => {
    expect(parseSmartFilter("What's being built?", vocabulary).statuses).toEqual([
      "PROTOTYPE_CANDIDATE", "PILOT", "PRODUCTION_CANDIDATE", "IMPLEMENTED",
    ]);
  });

  it("matches 'under review' before a shorter stage word", () => {
    expect(parseSmartFilter("anything under review", vocabulary).statuses).toEqual(["UNDER_REVIEW"]);
  });

  it("finds a category", () => {
    expect(parseSmartFilter("process automation ideas", vocabulary).category?.id).toBe("c-auto");
  });

  it("keeps one meaningful word for the title search", () => {
    const f = parseSmartFilter("cut manual invoicing in Finance", vocabulary);
    expect(f.department?.id).toBe("d-fin");
    expect(f.keyword).toBe("invoicing");
  });

  it("says effort is out of reach instead of inventing a cut-off", () => {
    const f = parseSmartFilter("Quick wins", vocabulary);
    expect(f.asksAboutEffort).toBe(true);
    expect(isEmptyFilter(f)).toBe(true);
  });

  it("does not match a department inside another word", () => {
    const f = parseSmartFilter("refinance", vocabulary);
    expect(f.department).toBeUndefined();
    expect(f.keyword).toBe("refinance");
  });
});

import { describe, expect, it } from "vitest";
import { bucketByMonth, earliestBy, mean, median, pairedDurations } from "./aggregate.js";

describe("analytics aggregation", () => {
  it("median is null for no data, and averages the middle pair for an even count", () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("mean is null for no data and rounds to one decimal", () => {
    expect(mean([])).toBeNull();
    expect(mean([50, 51, 51])).toBe(50.7);
  });

  it("buckets the last 12 UTC months, oldest first, zero-filled, ignoring older dates", () => {
    const now = new Date("2026-09-15T00:00:00Z");
    const out = bucketByMonth(
      [new Date("2026-09-01T00:00:00Z"), new Date("2026-09-30T23:59:59Z"), new Date("2025-10-01T00:00:00Z"), new Date("2025-09-30T00:00:00Z")],
      now,
    );
    expect(out).toHaveLength(12);
    expect(out[0]).toEqual({ month: "2025-10", count: 1 });
    expect(out[11]).toEqual({ month: "2026-09", count: 2 });
    expect(out.reduce((s, m) => s + m.count, 0)).toBe(3);
  });

  it("measures first-to-first, and drops pairs where the end precedes the start", () => {
    const starts = earliestBy(
      [{ k: "a", t: new Date("2026-01-03Z") }, { k: "a", t: new Date("2026-01-01Z") }, { k: "b", t: new Date("2026-01-10Z") }],
      (r) => r.k, (r) => r.t,
    );
    const ends = new Map([["a", new Date("2026-01-04Z")], ["b", new Date("2026-01-05Z")]]);
    expect(pairedDurations(starts, ends)).toEqual([3]);
  });
});

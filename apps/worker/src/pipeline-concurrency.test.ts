import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "./pipeline.js";

describe("mapWithConcurrency (P9 — analysis steps run concurrently, capped)", () => {
  it("keeps input order and never has more than `limit` in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    const delays = [30, 5, 20, 1, 15, 10, 25];
    const out = await mapWithConcurrency(delays, 3, async (ms) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, ms));
      inFlight -= 1;
      return ms * 2;
    });
    expect(out).toEqual(delays.map((d) => d * 2));
    expect(peak).toBe(3);
  });

  it("is quicker than one-at-a-time — the whole point", async () => {
    const started = Date.now();
    await mapWithConcurrency([40, 40, 40, 40], 4, (ms) => new Promise((r) => setTimeout(r, ms)));
    expect(Date.now() - started).toBeLessThan(120); // sequential would be ≥160ms
  });

  it("propagates a failure, as the sequential loop did", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("step failed");
        return n;
      }),
    ).rejects.toThrow("step failed");
  });
});

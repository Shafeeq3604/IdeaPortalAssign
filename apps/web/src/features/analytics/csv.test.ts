import { describe, expect, it } from "vitest";
import type { AnalyticsResponse } from "@iep/contracts";
import { analyticsCsv } from "./csv";

const base: AnalyticsResponse = {
  generatedAt: "2026-09-23T12:00:00.000Z",
  totalIdeas: 2,
  statusBreakdown: [{ status: "RANKED", count: 2, href: "/ideas?status=RANKED" }],
  submissionsByMonth: Array.from({ length: 12 }, (_, i) => ({ month: `2026-${String(i + 1).padStart(2, "0")}`, count: 0 })),
  byDepartment: [],
  byCategory: [],
  cycleTimes: [{ key: "SUBMITTED_TO_FIRST_SCORE", label: "Submitted → first scored", medianDays: null, sampleSize: 0 }],
  reviewActivity: { reviews: 0, byDecision: [], scoreOverrides: 0, leadershipDecisions: 0 },
  revisions: { profileName: "Balanced", revisedIdeas: 1, improved: 0, declined: 1, unchanged: 0, medianCompositeDelta: -3.2 },
  impactVsEffort: {
    runId: null, profileName: null, computedAt: null,
    points: [
      { ideaId: "00000000-0000-4000-8000-000000000001", title: "=HYPERLINK(\"x\")", rank: 1, impact: 50, ease: 60, href: "/ideas/1" },
      { ideaId: "00000000-0000-4000-8000-000000000002", title: "Rooms, desks", rank: 2, impact: 40, ease: 30, href: "/ideas/2" },
    ],
  },
};

describe("analyticsCsv", () => {
  const csv = analyticsCsv(base);
  const lines = csv.trimEnd().split("\r\n");

  it("starts with a header and ends every line with CRLF", () => {
    expect(lines[0]).toBe("section,item,metric,value");
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("neutralises formula injection in user-written titles, and quotes it", () => {
    expect(csv).toContain(`"'=HYPERLINK(""x"")",rank,1`);
  });

  it("quotes values containing commas", () => {
    expect(csv).toContain(`impact_vs_effort,"Rooms, desks",impact,40`);
  });

  it("keeps a negative number as a number and writes 'no data' as an empty cell, never 0", () => {
    expect(csv).toContain("revisions,Balanced,median_composite_delta,-3.2");
    expect(csv).toContain("cycle_time,Submitted → first scored,median_days,\r\n");
  });
});

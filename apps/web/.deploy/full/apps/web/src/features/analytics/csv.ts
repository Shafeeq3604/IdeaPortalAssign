import type { AnalyticsResponse } from "@iep/contracts";

/**
 * The "reporting" half of P14: the page's own figures as one CSV a manager can take into
 * a spreadsheet or a slide. Built client-side from the exact response the page renders,
 * so the download can never disagree with what was on screen.
 *
 * One long table — `section, item, metric, value` — rather than one sheet per figure:
 * it opens cleanly anywhere and pivots in one step.
 */
export function analyticsCsv(data: AnalyticsResponse): string {
  const rows: (string | number | null)[][] = [["section", "item", "metric", "value"]];
  const add = (section: string, item: string, metric: string, value: string | number | null) =>
    rows.push([section, item, metric, value]);

  add("summary", "all", "submitted_ideas", data.totalIdeas);
  add("summary", "all", "generated_at", data.generatedAt);
  for (const s of data.statusBreakdown) add("status", s.status, "ideas", s.count);
  for (const m of data.submissionsByMonth) add("submissions_by_month", m.month, "ideas", m.count);
  for (const d of data.byDepartment) {
    add("department", d.name, "ideas", d.ideas);
    add("department", d.name, "contributors", d.contributors);
    add("department", d.name, "reviewed", d.reviewed);
    add("department", d.name, "advanced", d.advanced);
  }
  for (const c of data.byCategory) add("category", c.label, "ideas", c.ideas);
  for (const c of data.cycleTimes) {
    add("cycle_time", c.label, "median_days", c.medianDays);
    add("cycle_time", c.label, "sample_size", c.sampleSize);
  }
  const r = data.reviewActivity;
  add("review", "all", "reviews", r.reviews);
  add("review", "all", "score_overrides", r.scoreOverrides);
  add("review", "all", "leadership_decisions", r.leadershipDecisions);
  for (const d of r.byDecision) add("review_decision", d.decision, "reviews", d.count);
  const v = data.revisions;
  add("revisions", v.profileName ?? "", "revised_ideas", v.revisedIdeas);
  add("revisions", v.profileName ?? "", "improved", v.improved);
  add("revisions", v.profileName ?? "", "declined", v.declined);
  add("revisions", v.profileName ?? "", "unchanged", v.unchanged);
  add("revisions", v.profileName ?? "", "median_composite_delta", v.medianCompositeDelta);
  for (const p of data.impactVsEffort.points) {
    add("impact_vs_effort", p.title, "rank", p.rank);
    add("impact_vs_effort", p.title, "impact", p.impact);
    add("impact_vs_effort", p.title, "ease", p.ease);
  }
  return rows.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

/**
 * RFC 4180 quoting, plus a guard against spreadsheet formula injection: an idea title is
 * user-written text, and a cell starting with = + - @ is executed by Excel/Sheets.
 * Numbers are left alone, since a negative median change is a real value.
 */
function cell(value: string | number | null): string {
  if (value === null) return "";
  if (typeof value === "number") return String(value);
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

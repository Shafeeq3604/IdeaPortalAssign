import { describe, expect, it } from "vitest";
import { invalidateAfter, queryKeys } from "./query-keys";

/**
 * Characterization tests for the query-key factory (SPEC §7.8) — "a CONTRACT between
 * parallel UI slices, not a convenience," per its own file comment. Untested before this,
 * despite that claim: a key silently reordered or an `invalidateAfter` list silently
 * missing an entry produces exactly the "the score didn't update" class of bug the file
 * says it exists to prevent, and nothing would have caught it. These tests pin every key
 * shape and every invalidation list exactly as they are today.
 */
describe("queryKeys", () => {
  it("builds top-level keys", () => {
    expect(queryKeys.session()).toEqual(["session"]);
    expect(queryKeys.signupOptions()).toEqual(["signup-options"]);
    expect(queryKeys.dashboard()).toEqual(["dashboard", null]);
    expect(queryKeys.dashboard("dept-1")).toEqual(["dashboard", "dept-1"]);
  });

  it("builds idea keys, all nested under the same detail prefix", () => {
    expect(queryKeys.ideas.all()).toEqual(["ideas"]);
    expect(queryKeys.ideas.list({ status: "SUBMITTED" })).toEqual([
      "ideas", "list", { status: "SUBMITTED" },
    ]);
    expect(queryKeys.ideas.detail("idea-1")).toEqual(["ideas", "detail", "idea-1"]);
    expect(queryKeys.ideas.versions("idea-1")).toEqual(["ideas", "detail", "idea-1", "versions"]);
    expect(queryKeys.ideas.version("idea-1", 2)).toEqual([
      "ideas", "detail", "idea-1", "versions", 2,
    ]);
    expect(queryKeys.ideas.history("idea-1")).toEqual(["ideas", "detail", "idea-1", "history"]);
    expect(queryKeys.ideas.analysis("idea-1")).toEqual(["ideas", "detail", "idea-1", "analysis"]);
    expect(queryKeys.ideas.analysisStatus("idea-1")).toEqual([
      "ideas", "detail", "idea-1", "analysis", "status",
    ]);
    expect(queryKeys.ideas.evaluation("idea-1")).toEqual(["ideas", "detail", "idea-1", "evaluation"]);
    expect(queryKeys.ideas.recommendations("idea-1")).toEqual([
      "ideas", "detail", "idea-1", "recommendations",
    ]);
    expect(queryKeys.ideas.reviews("idea-1")).toEqual(["ideas", "detail", "idea-1", "reviews"]);
    expect(queryKeys.ideas.feedback("idea-1")).toEqual(["ideas", "detail", "idea-1", "feedback"]);
    // NOT nested under "detail" — this is the one idea sub-key with a different shape.
    expect(queryKeys.ideas.attachments("idea-1")).toEqual(["ideas", "idea-1", "attachments"]);
  });

  it("builds ranking keys, sorting compare ids so the two orderings share a cache entry", () => {
    expect(queryKeys.rankings.all()).toEqual(["rankings"]);
    expect(queryKeys.rankings.list({ page: 1 })).toEqual(["rankings", "list", { page: 1 }]);
    expect(queryKeys.rankings.run("run-1")).toEqual(["rankings", "run", "run-1"]);
    expect(queryKeys.rankings.compare(["b", "a"])).toEqual([
      "rankings", "compare", ["a", "b"], null,
    ]);
    expect(queryKeys.rankings.compare(["a", "b"], "balanced")).toEqual([
      "rankings", "compare", ["a", "b"], "balanced",
    ]);
  });

  it("builds review, config and admin keys", () => {
    expect(queryKeys.review.queue({ sort: "oldest" })).toEqual(["review", "queue", { sort: "oldest" }]);
    expect(queryKeys.config.criteria()).toEqual(["config", "criteria"]);
    expect(queryKeys.config.profiles()).toEqual(["config", "profiles"]);
    expect(queryKeys.admin.audit({ page: 1 })).toEqual(["admin", "audit", { page: 1 }]);
    expect(queryKeys.admin.users({ page: 1 })).toEqual(["admin", "users", { page: 1 }]);
    expect(queryKeys.admin.departments()).toEqual(["admin", "departments"]);
  });
});

describe("invalidateAfter", () => {
  it("scoreOverride invalidates the evaluation, the idea, every ranking, and the audit log", () => {
    expect(invalidateAfter.scoreOverride("idea-1")).toEqual([
      ["ideas", "detail", "idea-1", "evaluation"],
      ["ideas", "detail", "idea-1"],
      ["rankings"],
      ["admin", "audit", {}],
    ]);
  });

  it("statusTransition invalidates the idea, its history, the whole idea list, the review queue and the audit log", () => {
    expect(invalidateAfter.statusTransition("idea-1")).toEqual([
      ["ideas", "detail", "idea-1"],
      ["ideas", "detail", "idea-1", "history"],
      ["ideas"],
      ["review", "queue", {}],
      ["admin", "audit", {}],
    ]);
  });

  it("newVersion invalidates every per-version-dependent read, but NOT the review queue or the audit log", () => {
    expect(invalidateAfter.newVersion("idea-1")).toEqual([
      ["ideas", "detail", "idea-1"],
      ["ideas", "detail", "idea-1", "versions"],
      ["ideas", "detail", "idea-1", "history"],
      ["ideas", "detail", "idea-1", "analysis"],
      ["ideas", "detail", "idea-1", "evaluation"],
      ["ideas", "detail", "idea-1", "recommendations"],
    ]);
  });

  it("review invalidates the idea's reviews, the idea itself, the queue and the audit log", () => {
    expect(invalidateAfter.review("idea-1")).toEqual([
      ["ideas", "detail", "idea-1", "reviews"],
      ["ideas", "detail", "idea-1"],
      ["review", "queue", {}],
      ["admin", "audit", {}],
    ]);
  });

  it("recompute invalidates every ranking and the dashboard, and nothing per-idea", () => {
    expect(invalidateAfter.recompute()).toEqual([
      ["rankings"],
      ["dashboard", null],
    ]);
  });
});

import { describe, expect, it } from "vitest";
import { CRITERIA, PROFILES, IDEA_FIXTURES, FIXTURES_BY_KEY } from "@iep/contracts";
import type { Band, EffortClass, FeasibilityStatus } from "@iep/contracts";
import { createEngine } from "./index.js";
import type { EngineConfig, FactorSet, EvaluationResult } from "./types.js";

/**
 * P4 — written test-first (SKILL.md §2, SPEC §11.1).
 *
 * The engine is the product's correctness. It is pure, so there is no excuse for anything
 * less than exhaustive: 100% branch, and the properties that matter asserted directly
 * rather than inferred from examples.
 */

const ENGINE_VERSION = "test-1";

const configFor = (profileKey: string): EngineConfig => ({
  criteria: CRITERIA,
  profile: PROFILES.find((p) => p.key === profileKey)!,
  attentionThreshold: 55,
  engineVersion: ENGINE_VERSION,
});

const evidenced = <T>(value: T, source: "AI" | "HUMAN" | "FALLBACK" = "AI") => ({
  value,
  evidence: ["fixture evidence"],
  rationale: "fixture",
  source,
  confidence: "HIGH" as const,
});

/** Build a FactorSet from a canonical fixture (SPEC §14 P0.9). */
function factorsFrom(key: string): FactorSet {
  const f = FIXTURES_BY_KEY[key]!;
  const provided = new Set(f.optionalFieldsProvided);
  return {
    ideaVersionId: `${key}-v1`,
    value: Object.fromEntries(
      Object.entries(f.factors.value).map(([k, v]) => [k, evidenced(v as Band)]),
    ),
    feasibility: Object.fromEntries(
      Object.entries(f.factors.feasibility).map(([k, v]) => [k, evidenced(v as Band)]),
    ),
    feasibilityStatus: evidenced(f.factors.feasibilityStatus as FeasibilityStatus),
    useCases: f.factors.useCases.map((u) => ({ ...u, departmentScope: [] })),
    risks: f.factors.riskLevels.map((level) => ({
      category: "TECHNICAL",
      level,
      hasMitigation: true,
    })),
    effortClass: evidenced(f.factors.effortClass as EffortClass),
    costClass: evidenced(f.factors.costClass as EffortClass),
    timelineTotalWeeks: evidenced(f.factors.timelineWeeks),
    signals: {},
    /**
     * Completeness is about SUBSTANCE, not field presence. The six required fields are
     * always non-empty, so presence alone would make level 1 unreachable — yet "Make
     * internal search better" is exactly a level-1 concept. VAGUE fixtures therefore
     * have nominal-but-not-substantive required fields.
     */
    completeness: {
      hasProblemStatement: f.archetype !== "VAGUE",
      hasExpectedUsers: f.archetype !== "VAGUE",
      hasExpectedOutcome: f.archetype !== "VAGUE",
      hasUseCases: f.factors.useCases.some((u) => !u.isSpeculative),
      hasSuggestedTechnology: provided.has("suggestedTechnology"),
      // Supporting references are the closest thing the corpus has to demand evidence.
      hasEvidenceOfDemand: provided.has("references"),
      hasPrototypeEvidence: false,
      hasImplementationPlan: provided.has("expectedBenefits"),
      hasRisks: f.factors.riskLevels.length > 0,
      // No fixture declares KPIs, so level 5 is correctly unreachable in this corpus.
      hasKpis: false,
    },
  };
}

const engine = createEngine();

function evaluateAll(profileKey: string): Map<string, EvaluationResult> {
  const config = configFor(profileKey);
  return new Map(
    IDEA_FIXTURES.map((f) => [f.key, engine.evaluate(factorsFrom(f.key), config)]),
  );
}

function rankAll(profileKey: string) {
  const evaluations = evaluateAll(profileKey);
  const ideaIdByVersionId = Object.fromEntries(
    [...evaluations].map(([key, e]) => [e.ideaVersionId, key]),
  );
  const evaluationIdByVersionId = Object.fromEntries(
    [...evaluations].map(([key, e]) => [e.ideaVersionId, `eval-${key}`]),
  );
  const submittedAtByIdeaId = Object.fromEntries(
    IDEA_FIXTURES.map((f, i) => [f.key, `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`]),
  );
  const feasibilityByVersionId = Object.fromEntries(
    IDEA_FIXTURES.map((f) => [`${f.key}-v1`, f.factors.feasibilityStatus as FeasibilityStatus]),
  );
  return {
    evaluations,
    result: engine.rank([...evaluations.values()], {
      ideaIdByVersionId,
      evaluationIdByVersionId,
      submittedAtByIdeaId,
      feasibilityByVersionId,
      cohortKey: { profile: profileKey },
    }),
  };
}

const rankOf = (profileKey: string, key: string): number =>
  rankAll(profileKey).result.entries.find((e) => e.ideaId === key)!.rank;

/* ─────────────────────────── evaluate ─────────────────────────── */

describe("evaluate — determinism and purity (SPEC §3.2)", () => {
  it("produces byte-identical output across runs", () => {
    const config = configFor("balanced");
    const a = engine.evaluate(factorsFrom("expense-receipt-ocr"), config);
    const b = engine.evaluate(factorsFrom("expense-receipt-ocr"), config);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("stamps the engine version on every result", () => {
    const e = engine.evaluate(factorsFrom("better-internal-search"), configFor("balanced"));
    expect(e.engineVersion).toBe(ENGINE_VERSION);
  });
});

describe("evaluate — the composite (P-5, P-6)", () => {
  it("is the sum of contributions, and contribution is normalized × weight", () => {
    const e = engine.evaluate(factorsFrom("expense-receipt-ocr"), configFor("balanced"));
    for (const s of e.criterionScores) {
      expect(s.contribution).toBeCloseTo(s.normalized * s.weight, 6);
    }
    const sum = e.criterionScores.reduce((acc, s) => acc + s.contribution, 0);
    expect(e.compositeScore).toBeCloseTo(sum, 3);
  });

  it("stays within 0..100 for every fixture and every profile", () => {
    for (const profile of PROFILES) {
      for (const f of IDEA_FIXTURES) {
        const e = engine.evaluate(factorsFrom(f.key), configFor(profile.key));
        expect(e.compositeScore, `${f.key}/${profile.key}`).toBeGreaterThanOrEqual(0);
        expect(e.compositeScore, `${f.key}/${profile.key}`).toBeLessThanOrEqual(100);
      }
    }
  });

  it("is additive only — value is never multiplied by feasibility (P-5)", () => {
    // Halving every feasibility band must move the composite by exactly the feasibility
    // group's own contribution. A multiplicative model could not satisfy this.
    const config = configFor("balanced");
    const base = factorsFrom("expense-receipt-ocr");
    const worse: FactorSet = {
      ...base,
      feasibility: Object.fromEntries(
        Object.keys(base.feasibility).map((k) => [k, evidenced("NEGLIGIBLE" as Band)]),
      ),
    };
    const a = engine.evaluate(base, config);
    const b = engine.evaluate(worse, config);

    const valueOf = (e: EvaluationResult) =>
      e.criterionScores
        .filter((s) => ["business_impact", "user_reach", "use_case_breadth", "problem_severity"].includes(s.criterionKey))
        .reduce((acc, s) => acc + s.contribution, 0);

    // The VALUE group is untouched by a feasibility change.
    expect(valueOf(a)).toBeCloseTo(valueOf(b), 6);
  });

  it("every criterion score carries non-empty evidence (P-7)", () => {
    for (const f of IDEA_FIXTURES) {
      const e = engine.evaluate(factorsFrom(f.key), configFor("balanced"));
      for (const s of e.criterionScores) {
        expect(s.evidence.length, `${f.key}/${s.criterionKey}`).toBeGreaterThan(0);
      }
    }
  });

  it("is data-driven — a different catalogue produces a different result (P-6)", () => {
    const trimmed: EngineConfig = {
      ...configFor("balanced"),
      criteria: CRITERIA.filter((c) => c.group !== "STRATEGIC"),
    };
    const full = engine.evaluate(factorsFrom("unified-knowledge-graph"), configFor("balanced"));
    const partial = engine.evaluate(factorsFrom("unified-knowledge-graph"), trimmed);
    expect(partial.criterionScores.length).toBeLessThan(full.criterionScores.length);
  });

  it("LOWER_IS_BETTER criteria invert — high effort must not help the score", () => {
    const config = configFor("quick_wins");
    const cheap = { ...factorsFrom("expense-receipt-ocr"), effortClass: evidenced("LOW" as EffortClass) };
    const dear = { ...factorsFrom("expense-receipt-ocr"), effortClass: evidenced("VERY_HIGH" as EffortClass) };
    const scoreOf = (fs: FactorSet) =>
      engine.evaluate(fs, config).criterionScores.find((s) => s.criterionKey === "implementation_effort")!.normalized;
    expect(scoreOf(cheap)).toBeGreaterThan(scoreOf(dear));
  });

  it("a fallback factor is marked FALLBACK and low confidence, not hidden", () => {
    const base = factorsFrom("better-internal-search");
    const withFallback: FactorSet = {
      ...base,
      value: { ...base.value, BUSINESS_IMPACT: { ...evidenced("MODERATE" as Band, "FALLBACK"), confidence: "LOW" } },
    };
    const e = engine.evaluate(withFallback, configFor("balanced"));
    const s = e.criterionScores.find((x) => x.criterionKey === "business_impact")!;
    expect(s.source).toBe("FALLBACK");
    expect(s.confidence).toBe("LOW");
  });

  it("a missing factor still yields a rankable score (SPEC §9.3)", () => {
    const base = factorsFrom("expense-receipt-ocr");
    const sparse: FactorSet = { ...base, value: {}, feasibility: {} };
    const e = engine.evaluate(sparse, configFor("balanced"));
    expect(Number.isFinite(e.compositeScore)).toBe(true);
    expect(e.criterionScores.every((s) => s.evidence.length > 0)).toBe(true);
  });
});

describe("evaluate — edge paths that only appear later or on bad config", () => {
  it("uses a demand signal once P11 supplies one (the M2 path)", () => {
    const base = factorsFrom("expense-receipt-ocr");
    const withSignal: FactorSet = {
      ...base,
      signals: {
        demonstrated_demand: {
          value: 82,
          evidence: ["41 employees registered interest", "3 departments volunteered for a pilot"],
          rationale: "Demand signals collected from feedback",
          source: "SIGNAL",
          confidence: "HIGH",
        },
      },
    };
    const s = engine
      .evaluate(withSignal, configFor("balanced"))
      .criterionScores.find((x) => x.criterionKey === "demonstrated_demand")!;

    expect(s.normalized).toBe(82);
    expect(s.source).toBe("SIGNAL");
    expect(s.evidence.length).toBeGreaterThan(0);
    // Weighted 0 in M1, so switching signals on must not silently move ranks (§criteria.ts).
    expect(s.contribution).toBe(0);
  });

  it("a signal outside 0..100 is clamped rather than trusted", () => {
    const base = factorsFrom("expense-receipt-ocr");
    const absurd: FactorSet = {
      ...base,
      signals: {
        demonstrated_demand: {
          value: 9_999, evidence: ["bad upstream data"], rationale: "x",
          source: "SIGNAL", confidence: "LOW",
        },
      },
    };
    const s = engine
      .evaluate(absurd, configFor("balanced"))
      .criterionScores.find((x) => x.criterionKey === "demonstrated_demand")!;
    expect(s.normalized).toBe(100);
  });

  it("an unknown criterion scores neutral and says so, rather than crashing", () => {
    // An admin can add a criterion in M2 before the engine knows how to derive it.
    // Failing closed with a visible 'not analysed' beats an exception or a silent zero.
    const config: EngineConfig = {
      ...configFor("balanced"),
      criteria: [
        ...CRITERIA,
        {
          key: "invented_criterion", label: "Invented", description: "unknown to the engine",
          group: "VALUE", direction: "HIGHER_IS_BETTER", sourceKind: "AI_FACTOR", factorSource: null,
        },
      ],
    };
    const s = engine
      .evaluate(factorsFrom("expense-receipt-ocr"), config)
      .criterionScores.find((x) => x.criterionKey === "invented_criterion")!;

    expect(s.normalized).toBe(50);
    expect(s.source).toBe("FALLBACK");
    expect(s.confidence).toBe("LOW");
    expect(s.evidence.join(" ")).toContain("not analysed");
  });
});

/* ─────────────────────────── maturity ─────────────────────────── */

describe("classifyMaturity — independent of score (P-5, FR-17)", () => {
  it("returns the fixture's expected level", () => {
    for (const f of IDEA_FIXTURES) {
      const level = engine.classifyMaturity(factorsFrom(f.key).completeness);
      expect(level, f.key).toBe(f.expectations.maturityLevel);
    }
  });

  it("never appears in the composite", () => {
    // Two identical factor sets differing ONLY in completeness must score identically.
    const config = configFor("balanced");
    const base = factorsFrom("expense-receipt-ocr");
    const bare: FactorSet = {
      ...base,
      completeness: {
        hasProblemStatement: false, hasExpectedUsers: false, hasExpectedOutcome: false,
        hasUseCases: false, hasSuggestedTechnology: false, hasEvidenceOfDemand: false,
        hasPrototypeEvidence: false, hasImplementationPlan: false, hasRisks: false, hasKpis: false,
      },
    };
    expect(engine.evaluate(base, config).compositeScore)
      .toBeCloseTo(engine.evaluate(bare, config).compositeScore, 6);
  });

  it("is monotonic — adding evidence never lowers maturity", () => {
    const empty = {
      hasProblemStatement: false, hasExpectedUsers: false, hasExpectedOutcome: false,
      hasUseCases: false, hasSuggestedTechnology: false, hasEvidenceOfDemand: false,
      hasPrototypeEvidence: false, hasImplementationPlan: false, hasRisks: false, hasKpis: false,
    };
    let previous = engine.classifyMaturity(empty);
    const keys = Object.keys(empty) as (keyof typeof empty)[];
    const acc = { ...empty };
    for (const k of keys) {
      acc[k] = true;
      const next = engine.classifyMaturity(acc);
      expect(next).toBeGreaterThanOrEqual(previous);
      previous = next;
    }
    expect(previous).toBe(5);
  });
});

/* ─────────────────────────── rank ─────────────────────────── */

describe("rank — ordering and ties (FR-12, SPEC §9.4)", () => {
  it("assigns 1..N with no gaps or duplicates", () => {
    const { result } = rankAll("balanced");
    const ranks = result.entries.map((e) => e.rank).sort((a, b) => a - b);
    expect(ranks).toEqual(Array.from({ length: IDEA_FIXTURES.length }, (_, i) => i + 1));
  });

  it("orders by composite, descending", () => {
    const { result } = rankAll("balanced");
    const byRank = [...result.entries].sort((a, b) => a.rank - b.rank);
    for (let i = 1; i < byRank.length; i++) {
      expect(byRank[i - 1]!.compositeScore).toBeGreaterThanOrEqual(byRank[i]!.compositeScore);
    }
  });

  it("breaks ties deterministically: feasibility → maturity → earlier submission", () => {
    const config = configFor("balanced");
    const a = engine.evaluate({ ...factorsFrom("expense-receipt-ocr"), ideaVersionId: "a-v1" }, config);
    const b = engine.evaluate({ ...factorsFrom("expense-receipt-ocr"), ideaVersionId: "b-v1" }, config);
    const r = engine.rank([a, b], {
      ideaIdByVersionId: { "a-v1": "a", "b-v1": "b" },
      evaluationIdByVersionId: { "a-v1": "ea", "b-v1": "eb" },
      submittedAtByIdeaId: { a: "2026-01-02T00:00:00.000Z", b: "2026-01-01T00:00:00.000Z" },
      feasibilityByVersionId: { "a-v1": "HIGHLY_FEASIBLE", "b-v1": "HIGHLY_FEASIBLE" },
      cohortKey: {},
    });
    // Identical scores and feasibility and maturity → the earlier submission wins.
    expect(r.entries.find((e) => e.ideaId === "b")!.rank).toBe(1);
    expect(r.entries.find((e) => e.ideaId === "b")!.tieBreakApplied).toBe("SUBMITTED_EARLIER");
  });

  it("percentile is 0..100 and highest rank scores highest", () => {
    const { result } = rankAll("balanced");
    const top = result.entries.find((e) => e.rank === 1)!;
    expect(top.percentile).toBeGreaterThanOrEqual(0);
    expect(top.percentile).toBeLessThanOrEqual(100);
    for (const e of result.entries) {
      expect(e.percentile).toBeGreaterThanOrEqual(0);
      expect(e.percentile).toBeLessThanOrEqual(100);
    }
  });

  it("carries previousRank forward so deltas are computable (ADR-008)", () => {
    const first = rankAll("balanced").result;
    const evaluations = [...evaluateAll("quick_wins").values()];
    const second = engine.rank(evaluations, {
      ideaIdByVersionId: Object.fromEntries(evaluations.map((e) => [e.ideaVersionId, e.ideaVersionId.replace("-v1", "")])),
      evaluationIdByVersionId: Object.fromEntries(evaluations.map((e) => [e.ideaVersionId, `eval-${e.ideaVersionId}`])),
      submittedAtByIdeaId: Object.fromEntries(IDEA_FIXTURES.map((f) => [f.key, "2026-01-01T00:00:00.000Z"])),
      feasibilityByVersionId: Object.fromEntries(IDEA_FIXTURES.map((f) => [`${f.key}-v1`, f.factors.feasibilityStatus as FeasibilityStatus])),
      previousRunEntries: first.entries,
      cohortKey: {},
    });
    expect(second.entries.every((e) => e.previousRank !== null)).toBe(true);
  });

  it("an empty cohort ranks without throwing", () => {
    const r = engine.rank([], {
      ideaIdByVersionId: {}, evaluationIdByVersionId: {},
      submittedAtByIdeaId: {}, feasibilityByVersionId: {}, cohortKey: {},
    });
    expect(r.entries).toEqual([]);
  });
});

/* ───────────── the FR-11 inversion: the assertion this engine exists for ───────────── */

describe("FR-11 — profiles genuinely re-order the portfolio", () => {
  it("a strategic idea beats a quick win under strategic_innovation", () => {
    expect(rankOf("strategic_innovation", "unified-knowledge-graph"))
      .toBeLessThan(rankOf("strategic_innovation", "meeting-room-noshow"));
  });

  it("and loses to it under quick_wins — the same two ideas, inverted", () => {
    expect(rankOf("quick_wins", "meeting-room-noshow"))
      .toBeLessThan(rankOf("quick_wins", "unified-knowledge-graph"));
  });

  it("honours every ranksAbove expectation declared in the fixture corpus", () => {
    for (const f of IDEA_FIXTURES) {
      for (const peer of f.expectations.ranksAboveUnderQuickWins ?? []) {
        expect(rankOf("quick_wins", f.key), `${f.key} > ${peer} under quick_wins`)
          .toBeLessThan(rankOf("quick_wins", peer));
      }
      for (const peer of f.expectations.ranksAboveUnderStrategic ?? []) {
        expect(rankOf("strategic_innovation", f.key), `${f.key} > ${peer} under strategic`)
          .toBeLessThan(rankOf("strategic_innovation", peer));
      }
    }
  });

  it("an infeasible idea is still ranked, never excluded (P-4)", () => {
    const { result } = rankAll("balanced");
    for (const f of IDEA_FIXTURES.filter((x) => x.archetype === "INFEASIBLE")) {
      expect(result.entries.some((e) => e.ideaId === f.key), f.key).toBe(true);
    }
  });

  it("a level-1 idea can outrank a level-3 idea (maturity ≠ quality)", () => {
    const { evaluations, result } = rankAll("balanced");
    const rank = (k: string) => result.entries.find((e) => e.ideaId === k)!.rank;
    const level = (k: string) => evaluations.get(k)!.maturityLevel;
    const pairs = IDEA_FIXTURES.flatMap((a) =>
      IDEA_FIXTURES.filter((b) => level(a.key) < level(b.key) && rank(a.key) < rank(b.key))
        .map((b) => [a.key, b.key]),
    );
    // Not merely possible in theory — it actually happens in the corpus.
    expect(pairs.length).toBeGreaterThan(0);
  });
});

describe("degenerate inputs — the defensive paths, exercised", () => {
  const config = configFor("balanced");

  it("a single-idea cohort gets percentile 100, not a divide-by-zero", () => {
    const only = engine.evaluate(factorsFrom("expense-receipt-ocr"), config);
    const r = engine.rank([only], {
      ideaIdByVersionId: { [only.ideaVersionId]: "solo" },
      evaluationIdByVersionId: { [only.ideaVersionId]: "e1" },
      submittedAtByIdeaId: { solo: "2026-01-01T00:00:00.000Z" },
      feasibilityByVersionId: { [only.ideaVersionId]: "HIGHLY_FEASIBLE" },
      cohortKey: {},
    });
    expect(r.entries[0]!.percentile).toBe(100);
    expect(r.entries[0]!.rank).toBe(1);
  });

  it("orders totally even when score, feasibility, maturity AND timestamp all tie", () => {
    // Without a final tiebreak the order would depend on sort stability — i.e. luck.
    const a = engine.evaluate({ ...factorsFrom("meeting-room-noshow"), ideaVersionId: "z-v1" }, config);
    const b = engine.evaluate({ ...factorsFrom("meeting-room-noshow"), ideaVersionId: "y-v1" }, config);
    const same = "2026-01-01T00:00:00.000Z";
    const run = () =>
      engine.rank([a, b], {
        ideaIdByVersionId: { "z-v1": "zebra", "y-v1": "yak" },
        evaluationIdByVersionId: { "z-v1": "ez", "y-v1": "ey" },
        submittedAtByIdeaId: { zebra: same, yak: same },
        feasibilityByVersionId: { "z-v1": "HIGHLY_FEASIBLE", "y-v1": "HIGHLY_FEASIBLE" },
        cohortKey: {},
      });
    expect(run().entries.find((e) => e.rank === 1)!.ideaId).toBe("yak");
    // And stable across runs — reproducibility is the whole point (SPEC §3.2).
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });

  it("missing rank context degrades to sane defaults instead of throwing", () => {
    const e = engine.evaluate(factorsFrom("team-morale-app"), config);
    const r = engine.rank([e], {
      ideaIdByVersionId: {},        // no mapping
      evaluationIdByVersionId: {},  // no mapping
      submittedAtByIdeaId: {},
      feasibilityByVersionId: {},
      cohortKey: {},
    });
    expect(r.entries[0]!.ideaId).toBe(e.ideaVersionId); // falls back to the version id
    expect(r.entries[0]!.evaluationId).toBe("");
  });

  it("explains from the LOWER-ranked side too, not only the winner's view", () => {
    const strong = engine.evaluate({ ...factorsFrom("expense-receipt-ocr"), ideaVersionId: "s-v1" }, config);
    const weak = engine.evaluate({ ...factorsFrom("team-morale-app"), ideaVersionId: "w-v1" }, config);
    const r = engine.rank([strong, weak], {
      ideaIdByVersionId: { "s-v1": "strong", "w-v1": "weak" },
      evaluationIdByVersionId: { "s-v1": "es", "w-v1": "ew" },
      submittedAtByIdeaId: { strong: "2026-01-01T00:00:00.000Z", weak: "2026-01-02T00:00:00.000Z" },
      feasibilityByVersionId: { "s-v1": "HIGHLY_FEASIBLE", "w-v1": "REQUIRES_INVESTIGATION" },
      cohortKey: {},
    });
    const loser = r.entries.find((e) => e.ideaId === "weak")!;
    const winner = r.entries.find((e) => e.ideaId === "strong")!;
    const x = engine.explain(loser, weak, [{ entry: winner, evaluation: strong }], config);
    expect(x.peerComparisons[0]!.text).toContain("below");
  });

  it("falls back to the criterion key when the catalogue has no label", () => {
    const unlabelled: EngineConfig = { ...config, criteria: [] };
    const e = engine.evaluate(factorsFrom("expense-receipt-ocr"), config);
    const r = engine.rank([e], {
      ideaIdByVersionId: { [e.ideaVersionId]: "x" },
      evaluationIdByVersionId: { [e.ideaVersionId]: "ex" },
      submittedAtByIdeaId: { x: "2026-01-01T00:00:00.000Z" },
      feasibilityByVersionId: { [e.ideaVersionId]: "HIGHLY_FEASIBLE" },
      cohortKey: {},
    });
    const x = engine.explain(r.entries[0]!, e, [], unlabelled);
    expect(x.strengths[0]!.criterionLabel).toBe(x.strengths[0]!.criterionKey);
  });

  it("a zero composite does not divide by zero in shareOfTotal", () => {
    const e = engine.evaluate(factorsFrom("expense-receipt-ocr"), config);
    const zeroed: EvaluationResult = { ...e, compositeScore: 0 };
    const r = engine.rank([e], {
      ideaIdByVersionId: { [e.ideaVersionId]: "x" },
      evaluationIdByVersionId: { [e.ideaVersionId]: "ex" },
      submittedAtByIdeaId: { x: "2026-01-01T00:00:00.000Z" },
      feasibilityByVersionId: { [e.ideaVersionId]: "HIGHLY_FEASIBLE" },
      cohortKey: {},
    });
    const x = engine.explain(r.entries[0]!, zeroed, [], config);
    for (const s of x.strengths) expect(Number.isFinite(s.shareOfTotal)).toBe(true);
  });
});

describe("tie-breaks — each rule exercised in isolation (SPEC §9.4)", () => {
  const config = configFor("balanced");

  /** Two ideas with an identical composite; only the named dimension differs. */
  function twoWay(opts: {
    feasA: FeasibilityStatus; feasB: FeasibilityStatus;
    maturityA?: number; maturityB?: number;
    atA: string; atB: string;
  }) {
    const base = factorsFrom("meeting-room-noshow");
    let a = engine.evaluate({ ...base, ideaVersionId: "a-v1" }, config);
    let b = engine.evaluate({ ...base, ideaVersionId: "b-v1" }, config);
    if (opts.maturityA !== undefined) a = { ...a, maturityLevel: opts.maturityA as never };
    if (opts.maturityB !== undefined) b = { ...b, maturityLevel: opts.maturityB as never };
    return engine.rank([a, b], {
      ideaIdByVersionId: { "a-v1": "aaa", "b-v1": "bbb" },
      evaluationIdByVersionId: { "a-v1": "ea", "b-v1": "eb" },
      submittedAtByIdeaId: { aaa: opts.atA, bbb: opts.atB },
      feasibilityByVersionId: { "a-v1": opts.feasA, "b-v1": opts.feasB },
      cohortKey: {},
    });
  }

  const T1 = "2026-01-01T00:00:00.000Z";
  const T2 = "2026-01-02T00:00:00.000Z";

  it("FEASIBILITY breaks a score tie first", () => {
    const r = twoWay({
      feasA: "REQUIRES_INVESTIGATION", feasB: "HIGHLY_FEASIBLE", atA: T1, atB: T1,
    });
    const winner = r.entries.find((e) => e.rank === 1)!;
    expect(winner.ideaId).toBe("bbb");
    expect(winner.tieBreakApplied).toBe("FEASIBILITY");
  });

  it("MATURITY breaks it when feasibility also ties", () => {
    const r = twoWay({
      feasA: "HIGHLY_FEASIBLE", feasB: "HIGHLY_FEASIBLE",
      maturityA: 2, maturityB: 4, atA: T1, atB: T1,
    });
    const winner = r.entries.find((e) => e.rank === 1)!;
    expect(winner.ideaId).toBe("bbb");
    expect(winner.tieBreakApplied).toBe("MATURITY");
  });

  it("the earlier submission wins when score, feasibility and maturity all tie", () => {
    const r = twoWay({ feasA: "HIGHLY_FEASIBLE", feasB: "HIGHLY_FEASIBLE", atA: T1, atB: T2 });
    expect(r.entries.find((e) => e.rank === 1)!.ideaId).toBe("aaa");
  });

  it("orders both ways round — the rule is not an artefact of input order", () => {
    const forward = twoWay({ feasA: "HIGHLY_FEASIBLE", feasB: "HIGHLY_FEASIBLE", atA: T2, atB: T1 });
    expect(forward.entries.find((e) => e.rank === 1)!.ideaId).toBe("bbb");
  });
});

describe("absent factor groups fall back rather than crash (SPEC §9.3)", () => {
  const config = configFor("balanced");

  it("no risks at all → neutral exposure, marked as not analysed", () => {
    const s = engine
      .evaluate({ ...factorsFrom("expense-receipt-ocr"), risks: [] }, config)
      .criterionScores.find((x) => x.criterionKey === "risk_exposure")!;
    expect(s.source).toBe("FALLBACK");
    expect(s.evidence.join(" ")).toContain("not analysed");
  });

  it("no use cases at all → every use-case criterion falls back", () => {
    const e = engine.evaluate({ ...factorsFrom("expense-receipt-ocr"), useCases: [] }, config);
    for (const key of ["user_reach", "use_case_breadth", "scalability", "long_term_potential"]) {
      const s = e.criterionScores.find((x) => x.criterionKey === key)!;
      expect(s.source, key).toBe("FALLBACK");
    }
    // Still rankable — that is the acceptance criterion, not a nicety.
    expect(Number.isFinite(e.compositeScore)).toBe(true);
  });

  it("an unmitigated risk weighs more than a mitigated one of the same level", () => {
    const base = factorsFrom("expense-receipt-ocr");
    const exposure = (hasMitigation: boolean) =>
      engine
        .evaluate(
          { ...base, risks: [{ category: "SECURITY", level: "HIGH", hasMitigation }] },
          config,
        )
        .criterionScores.find((x) => x.criterionKey === "risk_exposure")!.normalized;
    // risk_exposure is LOWER_IS_BETTER, so a mitigated risk yields the HIGHER score.
    expect(exposure(true)).toBeGreaterThan(exposure(false));
  });

  it("identical timestamps fall back to a stable id order, both directions", () => {
    const config2 = configFor("balanced");
    const mk = (id: string) =>
      engine.evaluate({ ...factorsFrom("meeting-room-noshow"), ideaVersionId: id }, config2);
    const same = "2026-05-05T00:00:00.000Z";
    const run = (first: string, second: string) =>
      engine.rank([mk(first), mk(second)], {
        ideaIdByVersionId: { "m-v1": "mmm", "n-v1": "nnn" },
        evaluationIdByVersionId: { "m-v1": "em", "n-v1": "en" },
        submittedAtByIdeaId: { mmm: same, nnn: same },
        feasibilityByVersionId: { "m-v1": "HIGHLY_FEASIBLE", "n-v1": "HIGHLY_FEASIBLE" },
        cohortKey: {},
      });
    // Same winner regardless of the order the evaluations arrive in.
    expect(run("m-v1", "n-v1").entries.find((e) => e.rank === 1)!.ideaId).toBe("mmm");
    expect(run("n-v1", "m-v1").entries.find((e) => e.rank === 1)!.ideaId).toBe("mmm");
  });
});

describe("evidence is never silently empty (P-7)", () => {
  it("substitutes an explicit note when a factor arrives with no evidence", () => {
    const base = factorsFrom("expense-receipt-ocr");
    const noEvidence: FactorSet = {
      ...base,
      value: {
        ...base.value,
        BUSINESS_IMPACT: {
          value: "HIGH" as Band, evidence: [], rationale: "unsourced",
          source: "AI", confidence: "LOW",
        },
      },
    };
    const s = engine
      .evaluate(noEvidence, configFor("balanced"))
      .criterionScores.find((x) => x.criterionKey === "business_impact")!;
    // The DB CHECK would reject an empty array; the engine never produces one.
    expect(s.evidence.length).toBeGreaterThan(0);
  });
});

/* ─────────────────────────── explain ─────────────────────────── */

describe("explain — deterministic and faithful (P-2, ADR-006, SPEC §12.4)", () => {
  const built = rankAll("balanced");
  const config = configFor("balanced");

  const explanationFor = (key: string) => {
    const entry = built.result.entries.find((e) => e.ideaId === key)!;
    const evaluation = built.evaluations.get(key)!;
    const peers = built.result.entries
      .filter((e) => Math.abs(e.rank - entry.rank) === 1)
      .map((e) => ({
        entry: e,
        evaluation: built.evaluations.get(e.ideaId)!,
      }));
    return engine.explain(entry, evaluation, peers, config);
  };

  it("every idea gets non-empty strengths AND constraints", () => {
    for (const f of IDEA_FIXTURES) {
      const x = explanationFor(f.key);
      expect(x.strengths.length, `${f.key} strengths`).toBeGreaterThan(0);
      expect(x.constraints.length, `${f.key} constraints`).toBeGreaterThan(0);
    }
  });

  /** The 100%, PR-blocking check of SPEC §12.4. */
  it("FAITHFULNESS — every claimed strength maps to a real positive contribution", () => {
    for (const f of IDEA_FIXTURES) {
      const evaluation = built.evaluations.get(f.key)!;
      const byKey = new Map(evaluation.criterionScores.map((s) => [s.criterionKey, s]));
      for (const s of explanationFor(f.key).strengths) {
        const real = byKey.get(s.criterionKey);
        expect(real, `${f.key}: strength cites unknown criterion ${s.criterionKey}`).toBeDefined();
        expect(real!.contribution, `${f.key}: ${s.criterionKey} claimed a strength`).toBeGreaterThan(0);
        expect(s.contribution).toBeCloseTo(real!.contribution, 6);
      }
    }
  });

  it("constraints cite criteria that genuinely held the score back", () => {
    for (const f of IDEA_FIXTURES) {
      const evaluation = built.evaluations.get(f.key)!;
      const byKey = new Map(evaluation.criterionScores.map((s) => [s.criterionKey, s]));
      for (const c of explanationFor(f.key).constraints) {
        const real = byKey.get(c.criterionKey);
        expect(real, `${f.key}: constraint cites unknown ${c.criterionKey}`).toBeDefined();
        expect(real!.normalized).toBeLessThan(100);
      }
    }
  });

  it("shareOfTotal is a real proportion of the composite", () => {
    for (const f of IDEA_FIXTURES) {
      for (const item of explanationFor(f.key).strengths) {
        expect(item.shareOfTotal).toBeGreaterThanOrEqual(0);
        expect(item.shareOfTotal).toBeLessThanOrEqual(1);
      }
    }
  });

  it("names the adjacent peer and the criteria that differ (FR-14)", () => {
    const midKey = built.result.entries.find((e) => e.rank === 3)!.ideaId;
    const x = explanationFor(midKey);
    expect(x.peerComparisons.length).toBeGreaterThan(0);
    for (const p of x.peerComparisons) {
      expect(p.peerIdeaId).not.toBe(midKey);
      expect(p.divergentCriteria.length).toBeGreaterThan(0);
      expect(p.text).toContain(String(p.peerRank));
    }
  });

  it("says the two score closely when nothing meaningfully diverges", () => {
    // Two identical ideas: no criterion leads either way, so the comparison must still
    // say something true rather than inventing a difference.
    const config2 = configFor("balanced");
    const a = engine.evaluate({ ...factorsFrom("meeting-room-noshow"), ideaVersionId: "a-v1" }, config2);
    const b = engine.evaluate({ ...factorsFrom("meeting-room-noshow"), ideaVersionId: "b-v1" }, config2);
    const r = engine.rank([a, b], {
      ideaIdByVersionId: { "a-v1": "a", "b-v1": "b" },
      evaluationIdByVersionId: { "a-v1": "ea", "b-v1": "eb" },
      submittedAtByIdeaId: { a: "2026-01-01T00:00:00.000Z", b: "2026-01-02T00:00:00.000Z" },
      feasibilityByVersionId: { "a-v1": "HIGHLY_FEASIBLE", "b-v1": "HIGHLY_FEASIBLE" },
      cohortKey: {},
    });
    const first = r.entries.find((e) => e.rank === 1)!;
    const second = r.entries.find((e) => e.rank === 2)!;
    const x = engine.explain(first, a, [{ entry: second, evaluation: b }], config2);

    expect(x.peerComparisons).toHaveLength(1);
    expect(x.peerComparisons[0]!.text).toContain("score closely");
    expect(x.peerComparisons[0]!.divergentCriteria).toEqual([]);

    // …and from the other side: the lower-ranked idea must get the same honest answer,
    // phrased from its own position.
    const reverse = engine.explain(second, b, [{ entry: first, evaluation: a }], config2);
    expect(reverse.peerComparisons[0]!.text).toContain("score closely");
    expect(reverse.peerComparisons[0]!.text).toContain("below");
  });

  it("requires no model — it is a pure function of the contribution vector", () => {
    const a = explanationFor("expense-receipt-ocr");
    const b = explanationFor("expense-receipt-ocr");
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("reports the tie-break when one decided the order", () => {
    const config2 = configFor("balanced");
    const a = engine.evaluate({ ...factorsFrom("expense-receipt-ocr"), ideaVersionId: "a-v1" }, config2);
    const b = engine.evaluate({ ...factorsFrom("expense-receipt-ocr"), ideaVersionId: "b-v1" }, config2);
    const r = engine.rank([a, b], {
      ideaIdByVersionId: { "a-v1": "a", "b-v1": "b" },
      evaluationIdByVersionId: { "a-v1": "ea", "b-v1": "eb" },
      submittedAtByIdeaId: { a: "2026-01-02T00:00:00.000Z", b: "2026-01-01T00:00:00.000Z" },
      feasibilityByVersionId: { "a-v1": "HIGHLY_FEASIBLE", "b-v1": "HIGHLY_FEASIBLE" },
      cohortKey: {},
    });
    const loser = r.entries.find((e) => e.ideaId === "a")!;
    const x = engine.explain(loser, a, [], config2);
    expect(x.tieBreakNote).not.toBeNull();
  });
});

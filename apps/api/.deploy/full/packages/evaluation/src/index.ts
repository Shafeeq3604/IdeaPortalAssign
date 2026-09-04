/**
 * @iep/evaluation — the DB-bound half of the evaluation pipeline.
 *
 * `packages/scoring` is pure by design and cannot read a row; the worker runs after an
 * analysis and the API answers an explicit recompute request. Both need the same bridge
 * between them, so it lives here rather than in either app.
 *
 * Splitting this out also removed a real smell: the BDD suite was reaching into
 * `apps/worker/src` for logic the API needed too, which is a cross-app import wearing a
 * test's clothes.
 *
 * The rule the package exists to protect: **nothing here produces a number.** It moves
 * ordinal bands and classes into the engine and writes what the engine returns back out.
 */
export * from "./factors.js";
export * from "./evaluate.js";
export * from "./ranking.js";

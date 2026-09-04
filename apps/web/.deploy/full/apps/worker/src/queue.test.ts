import { describe, expect, it } from "vitest";
import { connectionFrom } from "./queue.js";

/**
 * Characterization test for `connectionFrom` — the one pure, already-exported function in
 * `apps/worker`, which otherwise had no test files at all despite running the analysis
 * pipeline BDD suite (tests/bdd/specs/f03-analysis-pipeline.spec.ts) already exercises
 * `runPipeline` itself thoroughly against a real database and the stub provider — that
 * coverage exists, just outside this package. `connectionFrom` had none anywhere: a wrong
 * port or a dropped password here means the worker silently connects to nothing.
 */
describe("connectionFrom", () => {
  it("parses host and an explicit port from a redis URL", () => {
    expect(connectionFrom("redis://localhost:6380")).toEqual({
      host: "localhost",
      port: 6380,
    });
  });

  it("defaults to port 6379 when the URL has none", () => {
    expect(connectionFrom("redis://localhost")).toEqual({
      host: "localhost",
      port: 6379,
    });
  });

  it("carries a password when the URL has one", () => {
    expect(connectionFrom("redis://:s3cret@localhost:6379")).toEqual({
      host: "localhost",
      port: 6379,
      password: "s3cret",
    });
  });

  it("omits the password field entirely when the URL has none, rather than sending an empty string", () => {
    const result = connectionFrom("redis://localhost:6379");
    expect(result).not.toHaveProperty("password");
  });
});

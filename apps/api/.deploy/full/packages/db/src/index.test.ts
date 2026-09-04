import { afterEach, describe, expect, it } from "vitest";
import { disconnectPrisma, getPrisma } from "./index.js";

/**
 * Characterization test for the process-wide Prisma singleton — `packages/db`'s only
 * hand-written logic (everything else is a Prisma re-export) and, per the audit that
 * found it, entirely untested. The singleton exists specifically so Vite/tsx hot-reload
 * does not open a new connection pool on every reload; these tests pin the identity
 * behavior that guarantee actually depends on, without needing a real database — merely
 * constructing a PrismaClient does not connect one.
 */
describe("getPrisma / disconnectPrisma", () => {
  afterEach(async () => {
    await disconnectPrisma();
  });

  it("returns the same instance on repeated calls", () => {
    expect(getPrisma()).toBe(getPrisma());
  });

  it("returns a fresh instance after disconnectPrisma clears the singleton", async () => {
    const first = getPrisma();
    await disconnectPrisma();
    const second = getPrisma();
    expect(second).not.toBe(first);
  });

  it("disconnectPrisma is safe to call when nothing has been created yet", async () => {
    await expect(disconnectPrisma()).resolves.toBeUndefined();
  });
});

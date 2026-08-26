import { PrismaClient } from "@prisma/client";

/**
 * @iep/db — the ONLY place the database client is constructed.
 *
 * `$queryRaw` is lint-banned outside this package (SPEC §4.3): parameterised queries
 * only, so SQL injection is a class of bug that has nowhere to live.
 */

export * from "@prisma/client";

let client: PrismaClient | undefined;

/**
 * Process-wide singleton. Vite/tsx hot-reload would otherwise open a new pool on every
 * reload and exhaust connections within a few minutes of development.
 */
export function getPrisma(): PrismaClient {
  client ??= new PrismaClient({
    log: process.env["NODE_ENV"] === "development" ? ["warn", "error"] : ["error"],
  });
  return client;
}

export async function disconnectPrisma(): Promise<void> {
  await client?.$disconnect();
  client = undefined;
}

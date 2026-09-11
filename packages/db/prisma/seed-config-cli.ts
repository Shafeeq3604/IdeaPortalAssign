import { PrismaClient } from "@prisma/client";
import { CRITERIA, PROFILES } from "@iep/contracts";
import { DEFAULT_ROUTES } from "@iep/ai";
import { seedEvaluationConfig } from "./seed-config.js";

/**
 * Standalone entrypoint for `seedEvaluationConfig` (see that file for why it exists
 * separately from `seed.ts`'s demo accounts/ideas). Run via `pnpm db:seed:config` or
 * directly in a container's startup command (see the Dockerfiles).
 */
async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await seedEvaluationConfig(prisma);
    console.log(
      `seeded config only: ${CRITERIA.length} criteria, ${PROFILES.length} profiles, ` +
        `${DEFAULT_ROUTES.length} model routes — no demo accounts, no demo ideas`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

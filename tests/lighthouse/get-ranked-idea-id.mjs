// Finds one real ranked idea and writes its id to .idea-id, so lighthouserc.cjs can build
// a URL for /ideas/:ideaId/evaluation — the route SPEC §11.6/§8.5 names cannot be audited
// against a placeholder id; the evaluation page 404s without a real, ranked idea behind it.
import { writeFileSync } from "node:fs";
import { PrismaClient } from "@iep/db";

const db = new PrismaClient();

const entry = await db.rankingEntry.findFirst({
  orderBy: { rank: "asc" },
  select: { ideaId: true },
});

if (!entry) {
  throw new Error(
    "no ranked idea found — run `pnpm db:seed && pnpm demo:data` before the Lighthouse audit",
  );
}

writeFileSync(new URL("./.idea-id", import.meta.url), entry.ideaId);
console.log(`lighthouse: auditing /ideas/${entry.ideaId}/evaluation`);

await db.$disconnect();

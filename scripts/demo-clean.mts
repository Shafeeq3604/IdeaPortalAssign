/**
 * `pnpm demo:clean` — remove what the E2E suite leaves in the development database.
 *
 * `pnpm test:e2e` drives the real dev server, so it writes to whatever database that
 * server is on — which is the demo one. It submits ideas and creates an account, and
 * those are still there afterwards. This removes exactly those and rebuilds the board.
 *
 * It matches E2E's OWN generated titles, and it TOUCHES NO ACCOUNTS AT ALL.
 *
 * An earlier version deleted every user not on `@example.invalid`, on the assumption that
 * the suite created accounts. It does not — it only visits the sign-up page — so the only
 * thing that rule ever deleted was a real person's account. A cleanup script that guesses
 * at what is disposable eventually deletes something that was not; this one deletes only
 * rows whose titles it generated itself.
 */
import { PrismaClient } from "@iep/db";
import { recomputeRankings } from "@iep/evaluation";

const db = new PrismaClient();

/** Exactly the titles the journeys generate. Nothing a person would type. */
const FIXTURE_TITLES = ["Attachment journey ", "Determinate stepper ", "Receipt OCR "];

const junk = await db.idea.findMany({
  where: { currentVersion: { OR: FIXTURE_TITLES.map((t) => ({ title: { startsWith: t } })) } },
  select: { id: true, currentVersion: { select: { title: true } } },
});

if (junk.length === 0) {
  console.log("nothing to clean");
} else {
  for (const i of junk) console.log(`  removing ${i.currentVersion?.title}`);
  // Runs first: their entries reference evaluations with onDelete: Restrict, so an idea
  // a run scored cannot be deleted underneath it. The board is rebuilt below.
  await db.rankingRun.deleteMany({});
  await db.idea.deleteMany({ where: { id: { in: junk.map((i) => i.id) } } });
  const run = await recomputeRankings(db, { triggerReason: "demo data prepared" });
  console.log(`board rebuilt with ${run?.cohortSize ?? 0} idea(s)`);
}

console.log(
  `demo db: ${await db.user.count()} users · ${await db.idea.count()} ideas · ` +
    `${await db.rankingRun.count()} ranking run(s)`,
);
await db.$disconnect();

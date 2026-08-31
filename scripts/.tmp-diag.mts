import { PrismaClient } from "@iep/db";
const db = new PrismaClient({ datasources: { db: { url: "postgresql://iep:iep@localhost:5433/iep" } } });
const idea = await db.idea.findFirst({
  where: { currentVersion: { title: { contains: "Resume Skill Gap" } } },
  include: {
    currentVersion: {
      select: { id: true, title: true, analyses: { select: { step: true, status: true, startedAt: true, finishedAt: true } } },
    },
  },
});
if (!idea) { console.log("idea not found"); } else {
  console.log(`status: ${idea.status}   submittedAt: ${idea.submittedAt?.toISOString() ?? "null"}`);
  console.log(`versionId: ${idea.currentVersion?.id}`);
  console.log(`analysis rows: ${idea.currentVersion?.analyses.length ?? 0}`);
  for (const a of idea.currentVersion?.analyses ?? []) console.log(`  ${a.step} ${a.status}`);
}
await db.$disconnect();

/**
 * `pnpm --filter @iep/load seed` — bring the database up to N evaluated ideas for the
 * k6 recompute test (SPEC §11.6: "full recompute of 3,000 ideas <= 30s").
 *
 * Additive, not `--fresh`: tops up whatever is already there rather than wiping it, so
 * this can run against the same long-lived load-test database repeatedly without redoing
 * work. Runs the REAL pipeline (StubProvider — free, synchronous, no network) rather than
 * hand-inserting CriterionScore rows, because a score is a derived, structured object with
 * real invariants (non-empty evidence, weights matching the active profile's criteria);
 * fabricating it directly risks producing rows recomputeRankings would reject or silently
 * mishandle, and the whole point of this fixture is that recompute sees real evaluations.
 */
import { PrismaClient } from "@iep/db";
import { StubProvider } from "@iep/ai";
import { evaluateVersion } from "@iep/evaluation";
import { runPipeline } from "@iep/worker/src/pipeline.js";
import { makeIdeaRepo } from "@iep/api/src/modules/idea/repo.js";

const TARGET = Number(process.argv[2] ?? 3000);
const CONCURRENCY = Number(process.argv[3] ?? 25);

const db = new PrismaClient();
const provider = new StubProvider();

const PROBLEM_DOMAINS = [
  "expense claims", "meeting scheduling", "onboarding paperwork", "support ticket triage",
  "inventory counts", "shift scheduling", "supplier invoices", "customer follow-ups",
  "warehouse routing", "compliance checklists",
];

async function pool<T>(items: T[], size: number, work: (item: T, index: number) => Promise<void>) {
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      await work(items[index] as T, index);
    }
  }
  await Promise.all(Array.from({ length: size }, worker));
}

async function main(): Promise<void> {
  const existing = await db.idea.count({ where: { status: { notIn: ["DRAFT"] } } });
  const remaining = TARGET - existing;
  console.log(`load-test fixtures: ${existing} evaluated-eligible idea(s) already present, target ${TARGET}`);
  if (remaining <= 0) {
    console.log("nothing to add");
    return;
  }

  const submitter = await db.user.findFirst({ select: { id: true } });
  if (!submitter) throw new Error("no seeded user found — run `pnpm db:seed` first");

  const indices = Array.from({ length: remaining }, (_, i) => existing + i);
  let done = 0;

  await pool(indices, CONCURRENCY, async (i) => {
    const domain = PROBLEM_DOMAINS[i % PROBLEM_DOMAINS.length];
    const fields = {
      title: `Load fixture: ${domain} #${i}`,
      description: `Synthetic load-test idea ${i} about streamlining ${domain}.`,
      problemStatement: `Handling ${domain} manually costs time and produces avoidable errors.`,
      expectedUsers: "Staff who currently do this by hand.",
      expectedOutcome: "Less manual work and fewer mistakes.",
    };

    const { ideaId, versionId } = await makeIdeaRepo(db).createWithFirstVersion({
      submitterId: submitter.id,
      departmentId: null,
      categoryId: null,
      submit: true,
      fields,
    });

    const version = await db.ideaVersion.findUniqueOrThrow({
      where: { id: versionId },
      select: { contentHash: true },
    });

    await runPipeline(
      { db, provider, budgetPerVersionUsd: 0.75, redactionEnabled: false },
      { ideaId, ideaVersionId: versionId, contentHash: version.contentHash },
    );
    await evaluateVersion(db, versionId);

    done += 1;
    if (done % 200 === 0) console.log(`  ${done}/${remaining}`);
  });

  console.log(`added ${done} evaluated idea(s)`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void db.$disconnect());

import { afterAll } from "vitest";
import { PrismaClient } from "@iep/db";

/**
 * P13 made notifications a side effect of events every older spec already exercises
 * (reviews, transitions, decisions). `notifications` has no FK to `ideas` — a P0-reserved,
 * relation-less table whose `entity_id` is generic — so a spec deleting its test ideas
 * leaves those rows behind, and the demo accounts' notification centres fill up with
 * links to ideas that no longer exist. One shared sweep after every spec file, instead of
 * teaching all twelve files the same cleanup line.
 */
afterAll(async () => {
  const db = new PrismaClient({
    datasources: { db: { url: process.env["DATABASE_URL"] ?? "postgresql://iep:iep@localhost:5433/iep" } },
  });
  try {
    await db.$executeRaw`DELETE FROM notifications n WHERE n.entity_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM ideas i WHERE i.id = n.entity_id)`;
  } catch {
    // Database unreachable: every spec's own guard already fails loudly for that.
  } finally {
    await db.$disconnect();
  }
});

-- Split out from 00000000000000_init on purpose (see that migration's git history).
--
-- `vector` is an untrusted Postgres extension, so a shared-server deployment that scopes
-- the app's own role down to its own schema (Azure Database for PostgreSQL, and likely any
-- similarly multi-tenant host) can only install it via a role with elevated access
-- (`azure_pg_admin` on Azure) — the app's own migration role cannot do this itself.
--
-- Both columns this migration adds are RESERVED at P0 for M2 duplicate detection
-- (ADR-012) and unpopulated in M1 (see schema.prisma) — nothing in the app reads or
-- writes them yet. That is what makes deferring them safe: every other table, and every
-- SPEC-mandated constraint in 00000000000001_spec_constraints, applies cleanly without
-- this migration ever running. Apply this one once elevated access is available; until
-- then the app runs fully without it.

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- AlterTable
ALTER TABLE "idea_versions" ADD COLUMN "embedding" vector(1536);

-- AlterTable
ALTER TABLE "existing_solutions" ADD COLUMN "embedding" vector(1536);

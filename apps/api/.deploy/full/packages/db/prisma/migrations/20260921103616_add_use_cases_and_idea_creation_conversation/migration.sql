-- AlterTable
ALTER TABLE "idea_versions" ADD COLUMN     "use_cases" TEXT[] DEFAULT ARRAY[]::TEXT[];

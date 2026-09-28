-- AlterTable
ALTER TABLE "kpi_definitions" ADD COLUMN     "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "created_by" UUID,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "direction" "CriterionDirection" NOT NULL DEFAULT 'HIGHER_IS_BETTER';

-- AlterTable
ALTER TABLE "kpi_measurements" ADD COLUMN     "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "recorded_by" UUID;

-- AlterTable
ALTER TABLE "pilot_records" ADD COLUMN     "outcome_notes" TEXT,
ADD COLUMN     "scope" TEXT,
ADD COLUMN     "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updated_by" UUID;

-- CreateTable
CREATE TABLE "delivery_updates" (
    "id" UUID NOT NULL,
    "idea_id" UUID NOT NULL,
    "stage" "IdeaStatus" NOT NULL,
    "note" TEXT NOT NULL,
    "author_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idea_financials" (
    "idea_id" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "investment_to_date" DECIMAL(14,2),
    "realized_benefit" DECIMAL(14,2),
    "basis_note" TEXT,
    "updated_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "idea_financials_pkey" PRIMARY KEY ("idea_id")
);

-- CreateIndex
CREATE INDEX "delivery_updates_idea_id_created_at_idx" ON "delivery_updates"("idea_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "kpi_measurements_definition_id_measured_at_idx" ON "kpi_measurements"("definition_id", "measured_at");

-- AddForeignKey
ALTER TABLE "kpi_definitions" ADD CONSTRAINT "kpi_definitions_idea_id_fkey" FOREIGN KEY ("idea_id") REFERENCES "ideas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pilot_records" ADD CONSTRAINT "pilot_records_idea_id_fkey" FOREIGN KEY ("idea_id") REFERENCES "ideas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_updates" ADD CONSTRAINT "delivery_updates_idea_id_fkey" FOREIGN KEY ("idea_id") REFERENCES "ideas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_financials" ADD CONSTRAINT "idea_financials_idea_id_fkey" FOREIGN KEY ("idea_id") REFERENCES "ideas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- [SPEC-adjacent, P16] ROI inputs are a person's entry, so the database refuses nonsense
-- rather than letting the ROI arithmetic silently run on it.
ALTER TABLE "idea_financials" ADD CONSTRAINT "idea_financials_currency_iso4217"
  CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "idea_financials" ADD CONSTRAINT "idea_financials_amounts_non_negative"
  CHECK (("investment_to_date" IS NULL OR "investment_to_date" >= 0)
     AND ("realized_benefit" IS NULL OR "realized_benefit" >= 0));

-- [P15] A pilot outcome is one of PilotOutcome (contracts), or not yet recorded.
ALTER TABLE "pilot_records" ADD CONSTRAINT "pilot_records_outcome_known"
  CHECK ("outcome" IS NULL OR "outcome" IN ('SUCCEEDED', 'MIXED', 'DID_NOT_SUCCEED'));

-- [P15] Delivery notes are not blank.
ALTER TABLE "delivery_updates" ADD CONSTRAINT "delivery_updates_note_not_blank"
  CHECK (length(btrim("note")) > 0);

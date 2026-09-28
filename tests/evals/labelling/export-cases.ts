import { writeFileSync } from "node:fs";
import { Band, FeasibilityStatus, RiskCategory, ValueDimension } from "@iep/contracts";
import { GOLDEN_CASES } from "../cases.js";

/**
 * Step 1 of rebuilding the labelling workbooks: dump the golden set and the label
 * vocabularies (read from @iep/contracts, so the dropdowns can never drift from the
 * enums the eval scores against) to JSON for build_labelling.py. See README.md.
 */
const target = process.argv[2] ?? "labelling/eval-cases.json";
writeFileSync(
  target,
  JSON.stringify(
    {
      vocab: {
        band: Band.options, feasibility: FeasibilityStatus.options,
        risk: RiskCategory.options, value: ValueDimension.options,
      },
      cases: GOLDEN_CASES.map((c, i) => ({
        index: i + 1, name: c.name, category: c.category, fields: c.fields, groundTruth: c.groundTruth ?? null,
      })),
    },
    null,
    2,
  ),
);
console.log(`wrote ${GOLDEN_CASES.length} cases to ${target}`);

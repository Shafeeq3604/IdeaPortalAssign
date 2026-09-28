# Golden-set labelling (SPEC §12.4)

> **Optional (SPEC §16.1 D-22, 2026-09-24).** The product owner dropped the two-annotator
> requirement: the AI is advisory and every output is human-reviewed, so the golden-set
> labels may stay single-author and `pnpm eval`'s accuracy metrics are reported, not
> release-blocking. These workbooks remain for if you ever want better labels.

SPEC §12.4 originally required the 40 non-adversarial golden-set cases to be
"human-labelled by two annotators with disagreements resolved." The `groundTruth` blocks in
`../cases.ts` are a single-author draft (and the 10 vague cases have no labels at all).

## Files

| File | Who gets it | What it is |
|---|---|---|
| `golden-set-annotator.xlsx` | Each of the two annotators, one copy each | The 40 ideas in a fixed shuffled order with neutral IDs (L01–L40), no SPEC group names and **no draft labels**, so neither the grouping nor the draft can bias the read. Dropdowns for every band/status/risk. |
| `golden-set-adjudication.xlsx` | The person resolving disagreements | Paste each annotator's returned Labels tab into "Annotator A"/"Annotator B"; the Compare tab lines up A, B and the draft per field, shades every disagreement, and derives the final label. The Key tab maps L-IDs back to case names and groups. |

## Process

1. Send one copy of `golden-set-annotator.xlsx` to each annotator. They work alone.
2. Paste both returned Labels tabs into a copy of `golden-set-adjudication.xlsx`.
3. Resolve every shaded row on the Compare tab (the "Differing rows still without an agreed
   label" counter reaches 0), and write the agreed use-case lists.
4. Return the adjudicated file; the "Final label" column replaces the draft `groundTruth`
   blocks in `../cases.ts`. (Making the metrics release-blocking again would also need D-22
   reversed.)

## Rebuilding (after cases.ts changes)

The shuffle is seeded, so a rebuild gives the same L-IDs as long as the case list is unchanged.

```bash
cd tests/evals
npx tsx labelling/export-cases.ts labelling/eval-cases.json
py -m pip install --user openpyxl   # once
py labelling/build_labelling.py labelling/eval-cases.json labelling
```

`eval-cases.json` is an intermediate file and is not committed.

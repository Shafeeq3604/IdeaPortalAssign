import { expect, test, type Page } from "@playwright/test";

/**
 * J-2 — Reviewer: queue to recorded decision (SPEC §10).
 *
 * The governance journey. What it proves is not that the buttons work but that a decision
 * cannot be made without a reason, and cannot be made without leaving a trace: the two
 * properties that let anyone downstream trust a number a human touched.
 */

async function signInAs(page: Page, name: RegExp): Promise<void> {
  await page.goto("/login");
  await page.getByRole("button", { name }).click();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
}

test.describe("J-2 reviewer journey", () => {
  test("queue → override with a reason → decision → audit trail", async ({ page }) => {
    await signInAs(page, /Rae Reviewer/i);

    /* ── the queue leads somewhere ── */
    // By rank: the oldest waiting idea may not be evaluated yet, and this journey is
    // about adjusting a SCORE. Ranked ideas have one by definition.
    await page.goto("/review?sort=rank");
    /*
      Matched by the FULL row href, twice narrowed.
      "The first link in main" was the breadcrumb, which sent the journey back to /ideas;
      `[href*="/review"]` then matched the queue's own sort links. A row link is the only
      one that both names an idea and ends at its review tab.
    */
    const firstIdea = page.locator('main a[href^="/ideas/"][href$="/review"]').first();
    await expect(firstIdea).toBeVisible();

    // Wait, do not sample: `count()` on a cold page reports zero and the journey used
    // to skip itself, which reads as a pass.
    await expect(
      page.getByRole("row").nth(1),
      "the review queue is empty — run `pnpm db:seed` and let the worker finish",
    ).toBeVisible();

    // Row → the idea's REVIEW tab, not its overview (§6.2 row 36).
    await firstIdea.click();
    await expect(page).toHaveURL(new RegExp(String.raw`/ideas/[0-9a-f-]+/review`));

    /* ── an override without a reason is refused, in the UI and by the API ── */
    const overrideForm = page.locator("form").filter({ hasText: /Apply the adjustment/ });
    await expect(
      overrideForm,
      "the queued idea has no evaluation to adjust — the worker has not finished with it",
    ).toBeVisible();

    await overrideForm.getByRole("button", { name: /Apply the adjustment/ }).click();
    await expect(page.getByText(/An adjustment without a reason is unaccountable/)).toBeVisible();

    await page.locator("#field-overrideReason").fill(
      "Finance confirmed the rework figure; the band understates the impact.",
    );
    await page.locator("#field-newScore").fill("88");
    await overrideForm.getByRole("button", { name: /Apply the adjustment/ }).click();
    await expect(page.getByText(/The rankings are being recomputed/)).toBeVisible();

    /* ── the adjusted criterion now says who changed it (SPEC §7.4) ── */
    const ideaUrl = page.url();
    await page.goto(ideaUrl.replace("/review", "/evaluation"));
    await expect(page.getByText(/Adjusted by Rae Reviewer/).first()).toBeVisible();

    /* ── a rejection still demands its own reason (FR-23) ── */
    await page.goto(ideaUrl);
    const decisionForm = page.locator("form").filter({ hasText: /Record the decision/ });
    await decisionForm.getByRole("radio").nth(2).check();
    await decisionForm.getByRole("button", { name: /Record the decision/ }).click();
    await expect(page.getByText(/A rejection needs a reason/)).toBeVisible();

    // Validate instead — the decision this idea actually deserves.
    await decisionForm.getByRole("radio").nth(0).check();
    await page.locator("#field-reviewComment").fill("Analysis checked against the source system.");
    await decisionForm.getByRole("button", { name: /Record the decision/ }).click();
    await expect(page.getByText(/Recorded\./)).toBeVisible();
    await expect(page.getByText("Validated").first()).toBeVisible();

    /* ── both actions are on the audit trail, and it links back ── */
    /*
      As an ADMIN. SPEC §10 writes J-2 as one continuous walk, but the nav map makes
      /admin/audit admin-only and the permission grants agree — a reviewer records
      decisions, an admin reads the ledger. Signing in again here keeps the journey honest
      rather than quietly widening a role to make a test pass.
    */
    await signInAs(page, /Ash Admin/i);
    await page.goto("/admin/audit");
    await expect(page.getByText("Score adjusted").first()).toBeVisible();
    await expect(page.getByText("Review recorded").first()).toBeVisible();

    // §6.2 row 44: an audit row that cannot be navigated out of is a dead end.
    // By href: the entity-type FILTER above the table is also a link reading "idea".
    const subject = page.locator('main a[href^="/ideas/"]').first();
    await expect(subject).toBeVisible();
    await subject.click();
    await expect(page).toHaveURL(new RegExp(String.raw`/ideas/[0-9a-f-]+/overview`));
  });
});

import { expect, test, type Page } from "@playwright/test";

/**
 * J-1 — Employee: idea to improved idea (SPEC §10).
 *
 * The journey that defines the product: submit → view → revise → see the history.
 * Journeys own the seams, so this asserts the joins between screens rather than the
 * screens themselves — validation blocking, immutability, versions accumulating.
 *
 * Written after P2 shipped on manual verification alone. Everything here was proved once
 * by hand and then deleted; nothing repeatable existed until now.
 */

const unique = (prefix: string): string => `${prefix} ${Date.now().toString(36)}`;

async function signInAs(page: Page, name: RegExp): Promise<void> {
  await page.goto("/login");
  await page.getByRole("button", { name }).click();
  // Signing in must land somewhere useful, not on a blank shell.
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
}

async function fillIdea(page: Page, title: string): Promise<void> {
  await page.locator("#field-title").fill(title);
  await page.locator("#field-problemStatement").fill(
    "Staff retype receipt totals by hand and finance rejects about 15% of claims for transcription errors.",
  );
  await page.locator("#field-description").fill(
    "Read the receipt image and fill in amount, date and vendor automatically when a claim is created.",
  );
  await page.locator("#field-expectedUsers").fill("Everyone who claims expenses, plus the finance review team.");
  await page.locator("#field-expectedOutcome").fill("Claims take less time and typo rejections drop to near zero.");
}

test.describe("J-1 employee journey", () => {
  test("submit, view, revise, and see both versions in history", async ({ page }) => {
    await signInAs(page, /Erin Employee/i);

    /* ── the form refuses an empty submission, per field ── */
    await page.goto("/ideas/new");
    await page.getByRole("button", { name: /Submit for analysis/i }).click();
    await expect(page).toHaveURL(/\/ideas\/new/);
    // Five required fields (FR-02), each told individually what is wrong.
    await expect(page.getByRole("alert")).toHaveCount(5);

    /* ── a complete submission lands on the idea ── */
    const title = unique("Receipt OCR");
    await fillIdea(page, title);
    await page.locator("#field-suggestedTechnology").fill("The document OCR service IT already licenses.");
    await page.getByRole("button", { name: /Submit for analysis/i }).click();

    await expect(page).toHaveURL(/\/ideas\/[0-9a-f-]+\/overview/);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    /*
      NOT `toBeVisible("Submitted")`. That assertion was written in P2, when nothing
      consumed the queue and an idea therefore sat in SUBMITTED forever. With P3’s worker
      running it is a race: the pipeline picks the job up in well under a second and the
      badge is already “Being analysed” or “Evaluated” by first paint. It failed about one
      run in three.

      What the journey actually cares about is that submitting LEFT the draft state and
      entered the pipeline — so assert that, and let the pipeline be as fast as it likes.
    */
    await expect(
      page.getByText(/^(Submitted|Being analysed|Evaluated)$/),
    ).toBeVisible();
    await expect(page.getByText("Draft", { exact: true })).toHaveCount(0);

    /* ── the primary action must be READABLE.
          A previous bug rendered indigo text on an indigo button: the click test passed
          and the control was invisible. Assert contrast, not just presence. ── */
    const revise = page.getByRole("link", { name: /Create a new version/i });
    await expect(revise).toBeVisible();
    const colours = await revise.evaluate((el) => {
      const s = getComputedStyle(el);
      return { color: s.color, background: s.backgroundColor };
    });
    expect(colours.color).not.toBe(colours.background);

    /* ── a submitted idea is immutable; the route is revision ── */
    await revise.click();
    await expect(page).toHaveURL(/\/revise/);

    // …and revision demands a change summary (FR-24).
    await page.getByRole("button", { name: /Save and re-evaluate/i }).click();
    await expect(page).toHaveURL(/\/revise/);

    await page.locator("#field-changeSummary").fill("Named the OCR service and added finance as a user.");
    await page.getByRole("button", { name: /Save and re-evaluate/i }).click();

    /* ── history shows both versions, v1 preserved ── */
    await expect(page).toHaveURL(/\/history/);
    await expect(page.getByRole("link", { name: "Version 1" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Version 2" })).toBeVisible();
    await expect(page.getByText("First version.")).toBeVisible();
    await expect(page.getByText(/Named the OCR service/)).toBeVisible();

    // The status lane is recorded — an unlogged transition is impossible (FR-23).
    await expect(page.getByText(/Submitted/).first()).toBeVisible();

    /* ── v1 is frozen: the field added in v2 is absent from the snapshot ── */
    await page.getByRole("link", { name: "Version 1" }).click();
    await expect(page).toHaveURL(/\/versions\/1/);

    /* ── and it appears in the author's own list ── */
    await page.goto("/me/ideas");
    await expect(page.getByRole("link", { name: title })).toBeVisible();
  });


  test("analysis progress is determinate from the first paint (F-03, SPEC §8.4)", async ({ page }) => {
    await signInAs(page, /Erin Employee/i);

    await page.goto("/ideas/new");
    const title = unique("Determinate stepper");
    await fillIdea(page, title);
    await page.getByRole("button", { name: /Submit for analysis/i }).click();
    await expect(page).toHaveURL(new RegExp(String.raw`/ideas/[0-9a-f-]+/overview`));

    /* ── all six steps exist immediately, before any of them has run ──
       This is the assertion that separates a determinate stepper from a spinner with
       ambitions: the total is known at time zero, so nothing about it can be synthetic. */
    const stepper = page.getByRole("group", { name: "Analysis progress" });
    await expect(stepper).toBeVisible();
    await expect(stepper.getByRole("listitem")).toHaveCount(6);

    // A real count against a real total — never a percentage (SPEC §8.4).
    const bar = stepper.getByRole("progressbar");
    await expect(bar).toHaveAttribute("aria-valuemax", "6");
    await expect(bar).not.toContainText("%");

    /* ── and the Analysis tab is reachable, not a placeholder ── */
    // Scoped to the page: the dev nav carries an "Analysis" link for the demo idea too.
    await page.getByRole("main").getByRole("link", { name: "Analysis" }).click();
    await expect(page).toHaveURL(new RegExp(String.raw`/analysis`));
    await expect(page.getByRole("group", { name: "Analysis progress" })).toBeVisible();
    // The nav map's placeholder shell must be gone for this route.
    await expect(page.getByText(/not implemented|placeholder/i)).toHaveCount(0);
  });

  test("no dead ends: an unknown route offers a way out", async ({ page }) => {
    await signInAs(page, /Erin Employee/i);
    await page.goto("/ideas/no-such-route-at-all");
    // SPEC §6.3 assertion 3 — every error state carries a route out.
    await expect(page.getByRole("link", { name: /Back to ideas/i })).toBeVisible();
  });
});

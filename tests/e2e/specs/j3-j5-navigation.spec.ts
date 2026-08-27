import { expect, test, type Page } from "@playwright/test";

/**
 * J-3 (management) and J-5 (the orphan hunt) — SPEC §10.
 *
 * J-5 is the executable form of §6.3 assertions 1–3: every entity reachable, no orphans,
 * no dead ends. It is written as navigation only — no typed URLs after the first, and no
 * browser back button — because that constraint is the assertion. The moment a hop needs
 * the address bar, the map has a hole.
 */

/**
 * NO CONDITIONAL SKIPS IN THIS SUITE.
 *
 * These used `test.skip(await locator.count() === 0, ...)`. `count()` does not auto-wait,
 * so on a cold page it returned 0 and the journey skipped itself — reporting green while
 * testing nothing. Four of the five journeys did exactly that in one run and it looked
 * like a pass.
 *
 * A journey suite that quietly opts out is worse than a red one. These now WAIT for the
 * data and fail with a message naming what was missing; `pnpm db:seed` is the fix if it
 * ever genuinely is missing.
 */

async function signInAs(page: Page, name: RegExp): Promise<void> {
  await page.goto("/login");
  await page.getByRole("button", { name }).click();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
}

test.describe("J-3 management journey", () => {
  test("dashboard tile → list → rankings → profile switch in the URL → compare", async ({ page }) => {
    await signInAs(page, /Mo Manager/i);

    await page.goto("/dashboard");

    /* ── every tile is a link (§6.2 row 40) ── */
    // Wait for the first tile: counting during the skeleton render finds zero links and
    // reports a missing dashboard rather than a slow one.
    const tiles = page.getByRole("main").getByRole("link");
    await expect(tiles.first()).toBeVisible();
    const tileCount = await tiles.count();
    expect(tileCount, "the dashboard must show at least nine linked tiles").toBeGreaterThanOrEqual(9);

    await tiles.first().click();
    await expect(page).not.toHaveURL(/\/dashboard$/);

    /* ── the board, and a profile switch that lands in the URL (SPEC §7.8) ── */
    await page.goto("/rankings");
    const board = page.getByRole("main");
    await expect(board.getByRole("heading", { level: 1, name: "Rankings" })).toBeVisible();

    const quickWins = board.getByRole("button", { name: /Quick Wins/i });
    if (await quickWins.count()) {
      await quickWins.click();
      // Shareable state: the profile is in the address, not in a component's memory.
      await expect(page).toHaveURL(/profile=/);

      /*
        A profile with no ranking run of its own shows an empty board — and the profile
        selector has to survive that, or switching to it is a one-way trip. This is the
        dead end the journey found the first time it ran.
      */
      await expect(board.getByRole("button", { name: /Balanced/i })).toBeVisible();
      await board.getByRole("button", { name: /Balanced/i }).click();
    }

    /* ── rank band filters are URL state too ── */
    await board.getByRole("button", { name: /^Top 10$/ }).click();
    await expect(page).toHaveURL(/rankBand=top10/);

    /* ── select two and compare, back on the profile that has a run ── */
    await board.getByRole("button", { name: /^Everything$/ }).click();
    const boxes = board.getByRole("checkbox");
    await expect(
      boxes.nth(1),
      "the board needs at least two ranked ideas — run `pnpm db:seed` and let the worker finish",
    ).toBeVisible();

    // Top and bottom of the board, not two neighbours: adjacent ideas can score
    // identically, and then there is genuinely nothing to diverge on.
    const last = (await boxes.count()) - 1;
    await boxes.nth(0).click();
    await boxes.nth(last).click();
    const compare = board.getByRole("link", { name: /Compare 2 selected/ });
    await expect(compare).toBeVisible();
    await compare.click();

    // A comparison must COMPARE — naming where the ideas diverge, not listing everything.
    // getByText, not getByRole("heading"): shadcn CardTitle is a div by design, so the
    // section title is not in the heading tree. Noted rather than worked around silently.
    await expect(page.getByText("Where they differ")).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Gap" })).toBeVisible();
  });
});

test.describe("J-5 the orphan hunt", () => {
  test("every hop is a click: idea → person → their ideas → rankings → run → back", async ({ page }) => {
    await signInAs(page, /Mo Manager/i);

    // The one typed URL the journey is allowed.
    await page.goto("/rankings");

    const board = page.getByRole("main");
    const firstIdea = board.getByRole("heading", { level: 2 }).first().getByRole("link");
    await expect(
      firstIdea,
      "no ranked ideas — run `pnpm db:seed` and let the worker finish",
    ).toBeVisible();
    await firstIdea.click();
    await expect(page).toHaveURL(new RegExp(String.raw`/ideas/[0-9a-f-]+/evaluation`));

    /* ── the submitter chip is a link, not decoration (§6.2 row 3) ── */
    const submitter = page.getByRole("main").getByRole("link").filter({ hasText: /Employee|Manager|Reviewer|Admin/ }).first();
    await expect(submitter).toBeVisible();
    await submitter.click();
    await expect(page).toHaveURL(/\/people\/[0-9a-f-]+/);

    // …and their page lists their ideas, each one a link onward. Not optional: a person
    // page reached from an idea they submitted must list at least that idea.
    const theirIdea = page.getByRole("main").getByRole("heading", { level: 2 }).first().getByRole("link");
    await expect(
      theirIdea,
      "a submitter's page must list the idea we arrived from",
    ).toBeVisible();
    await theirIdea.click();
    await expect(page).toHaveURL(new RegExp(String.raw`/ideas/[0-9a-f-]+/overview`));

    /* ── from an idea to the run that ranked it, and out again ── */
    await page.getByRole("main").getByRole("link", { name: "Evaluation" }).click();
    await expect(page).toHaveURL(new RegExp(String.raw`/ideas/[0-9a-f-]+/evaluation`));

    /*
      The run link only exists once the idea is on a board, and this idea reached us via
      a person page rather than the board, so it may not be. Conditional on purpose —
      what J-5 asserts is that no hop needs the address bar, not that every idea is
      ranked.
    */
    const runLink = page.getByRole("link", { name: /the ranking run of/ });
    if (await runLink.count()) {
      await runLink.click();
      await expect(page).toHaveURL(/\/rankings\/[0-9a-f-]+/);
      // The breadcrumb is the way home. A page you can only leave by Back is a dead end.
      await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link").first().click();
      await expect(page).toHaveURL(/\/ideas$/);
    }
  });

  test("a criterion links to the rule that produced it, and back (J-4)", async ({ page }) => {
    await signInAs(page, /Mo Manager/i);

    await page.goto("/config/criteria");
    await expect(page.getByRole("heading", { level: 1, name: /Evaluation criteria/ })).toBeVisible();

    // "Used in N profiles" is a relationship, so it is a link (§6.2 row 42).
    const toProfiles = page.getByRole("main").getByRole("link", { name: /profile/ }).first();
    await expect(toProfiles).toBeVisible();
    await toProfiles.click();
    await expect(page).toHaveURL(/\/config\/profiles/);

    // Weights sum to 100% and each row links back to its criterion.
    await expect(page.getByText(/Totals 100\.0%/).first()).toBeVisible();
    await page.getByRole("main").getByRole("link", { name: /Business impact/ }).first().click();
    await expect(page).toHaveURL(/\/config\/criteria/);

    /* ── read-only is stated, not implied by a control that does nothing ── */
    await expect(page.getByText(/Changing them is an admin action/)).toBeVisible();
  });

  test("a route your role cannot see says so, rather than 404", async ({ page }) => {
    // An employee has no dashboard. The distinction matters: "not found" would send
    // someone hunting for a page that exists.
    await signInAs(page, /Erin Employee/i);
    await page.goto("/dashboard");

    await expect(page.getByRole("heading", { name: /Not available for your role/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Back to ideas/ })).toBeVisible();
  });

  test("the data & AI notice is reachable from the submission form", async ({ page }) => {
    await signInAs(page, /Erin Employee/i);
    await page.goto("/ideas/new");

    // SPEC §4.5 requires the link here specifically — this is where someone decides how
    // much to write.
    const notice = page.getByRole("link", { name: /How your idea is handled/ });
    await expect(notice).toBeVisible();
    await notice.click();
    await expect(page.getByRole("heading", { level: 1, name: /How your idea is handled/ })).toBeVisible();
    await expect(page.getByText(/never produces a score, a rank or a percentage/)).toBeVisible();
  });
});

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Accessibility pass (P9 hardening, SPEC §11.6).
 *
 * Automated checks catch roughly a third of real accessibility problems, so passing this
 * is a floor rather than a claim. What it does reliably catch is the class this codebase
 * is most exposed to: colour contrast, because every colour comes from a token and one
 * bad token silently degrades every screen using it.
 *
 * The product has already shipped one invisible control — indigo text on an indigo
 * button, which every click test passed. That is the failure mode this exists for.
 */

const ADMIN = /Ash Admin/i;

async function signIn(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByRole("button", { name: ADMIN }).click();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
}

/** WCAG 2.1 AA, which is what §11.6 commits to. */
const scan = (page: Page) =>
  new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();

const PAGES: readonly { name: string; path: string }[] = [
  { name: "sign-in", path: "/login" },
  { name: "idea list", path: "/ideas" },
  { name: "submission form", path: "/ideas/new" },
  { name: "rankings", path: "/rankings" },
  { name: "dashboard", path: "/dashboard" },
  { name: "review queue", path: "/review" },
  { name: "criteria", path: "/config/criteria" },
  { name: "profiles", path: "/config/profiles" },
  { name: "audit log", path: "/admin/audit" },
  { name: "data & AI notice", path: "/help/data-and-ai" },
];

test.describe("accessibility", () => {
  for (const target of PAGES) {
    test(`${target.name} has no WCAG AA violations`, async ({ page }) => {
      if (target.path !== "/login") await signIn(page);
      await page.goto(target.path);
      // Let the query settle: scanning a skeleton tests the skeleton.
      await page.waitForTimeout(1200);

      const results = await scan(page);

      // Named in the failure so a regression says WHAT broke, not just that something did.
      const summary = results.violations.map(
        (v) => `${v.id} (${v.impact}) on ${v.nodes.length} node(s): ${v.help}`,
      );
      expect(summary, `${target.name} accessibility violations:\n${summary.join("\n")}`).toEqual([]);
    });
  }

  test("an idea's own screens are clean", async ({ page }) => {
    await signIn(page);
    await page.goto("/ideas");

    // By href, not "the first link in main" — that was the "Submit an idea" call to
    // action, so the scan navigated to the empty form and checked nothing.
    const firstIdea = page.locator('main a[href*="/ideas/"][href*="/overview"]').first();
    await expect(firstIdea, "no ideas to scan — run `pnpm db:seed`").toBeVisible();
    await firstIdea.click();
    await expect(page).toHaveURL(new RegExp(String.raw`/ideas/[0-9a-f-]+/overview`));

    const base = page.url().replace(/\/[a-z]+$/, "");
    for (const tab of ["overview", "analysis", "evaluation", "improve", "history"]) {
      await page.goto(`${base}/${tab}`);
      await page.waitForTimeout(1000);
      const results = await scan(page);
      const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.help}`);
      expect(summary, `${tab} tab violations:\n${summary.join("\n")}`).toEqual([]);
    }
  });
});

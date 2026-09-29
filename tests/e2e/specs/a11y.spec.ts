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
 *
 * Runs every page in both Light and Dark (Aurora) — not just whichever Playwright's
 * default `colorScheme` happens to be. The Aurora dark palette introduced translucent
 * glass surfaces (ADR/CONTRACT-LOG 2026-09-22), which is exactly the kind of change a
 * light-only sweep cannot see: a translucent card can pass here in light mode (where it
 * doesn't exist) while failing contrast in dark. Forcing `iep-theme` in `localStorage`
 * before each page loads (rather than relying on `prefers-color-scheme`) matches how the
 * app's own theme toggle persists a choice, so this is the same dark mode a real user with
 * the toggle set sees, not just the OS-preference fallback.
 */


/**
 * Sign-in credentials for the seeded demo accounts (ADR-023).
 *
 * These replaced the development user-picker, which had no password at all. The seed sets
 * the same password on all four accounts and RUNNING.md documents it; the value living in
 * the test suite as well is deliberate — a test that reads it from the environment fails
 * confusingly on a fresh clone.
 */
const DEMO_PASSWORD = "innovation-2026";

const EMAIL_BY_NAME: Record<string, string> = {
  "Erin Employee": "employee@example.invalid",
  "Rae Reviewer": "reviewer@example.invalid",
  "Ash Admin": "admin@example.invalid",
  "Mo Manager": "manager@example.invalid",
};

const THEMES = ["light", "dark"] as const;
type Theme = (typeof THEMES)[number];

/**
 * Forces the app's own theme mechanism (`localStorage["iep-theme"]`, read by
 * `apps/web/src/app/theme.tsx`) rather than `page.emulateMedia`, so this exercises the
 * same code path a user's explicit Light/Dark toggle choice does — not just the
 * `prefers-color-scheme: dark` system-default fallback.
 */
async function forceTheme(page: Page, theme: Theme): Promise<void> {
  await page.addInitScript((t) => window.localStorage.setItem("iep-theme", t), theme);
}

async function signIn(page: Page): Promise<void> {
  await page.goto("/login");
  await page.locator("#field-email").fill(EMAIL_BY_NAME["Ash Admin"]!);
  await page.locator("#field-password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: /^Sign in$/ }).click();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
}

/** WCAG 2.1 AA, which is what §11.6 commits to. */
const scan = (page: Page) =>
  new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();

const PAGES: readonly { name: string; path: string; public?: boolean }[] = [
  // The two signed-out screens use their own warm palette, so their contrast is not
  // covered by any other page in this list. They are the reason it is worth listing them.
  { name: "sign-in", path: "/login", public: true },
  { name: "sign-up", path: "/signup", public: true },
  { name: "idea list", path: "/ideas" },
  // Platform-transformation brief §7: `/ideas/new` is now the AI-native conversational
  // creation experience (the primary entry point); the unchanged direct form moved to
  // its own fallback route, which needs the same coverage it always had.
  { name: "idea creation (AI conversation)", path: "/ideas/new" },
  { name: "submission form (direct)", path: "/ideas/new/manual" },
  { name: "discovery agent", path: "/discovery" },
  { name: "rankings", path: "/rankings" },
  { name: "dashboard", path: "/dashboard" },
  { name: "review queue", path: "/review" },
  { name: "criteria", path: "/config/criteria" },
  { name: "profiles", path: "/config/profiles" },
  { name: "audit log", path: "/admin/audit" },
  { name: "people & access", path: "/admin/users" },
  { name: "data & AI notice", path: "/help/data-and-ai" },
  // M4 (P18/P20, SPEC §14): the role home, the two new routes, and the pages P20 changed
  // (Analytics' portfolio map; My ideas and Alerts carry the new impact lines and events).
  { name: "role home", path: "/" },
  { name: "swipe to weigh in", path: "/ideas/swipe" },
  { name: "boardroom", path: "/rankings/boardroom" },
  { name: "analytics", path: "/analytics" },
  { name: "my ideas", path: "/me/ideas" },
  { name: "notifications", path: "/notifications" },
];

for (const theme of THEMES) {
  test.describe(`accessibility (${theme})`, () => {
    for (const target of PAGES) {
      test(`${target.name} has no WCAG AA violations`, async ({ page }) => {
        await forceTheme(page, theme);
        if (!target.public) await signIn(page);
        await page.goto(target.path);
        // Let the query settle: scanning a skeleton tests the skeleton.
        await page.waitForTimeout(1200);

        const results = await scan(page);

        // Named in the failure so a regression says WHAT broke, not just that something did.
        const summary = results.violations.map(
          (v) => `${v.id} (${v.impact}) on ${v.nodes.length} node(s): ${v.help}`,
        );
        expect(
          summary,
          `${target.name} [${theme}] accessibility violations:\n${summary.join("\n")}`,
        ).toEqual([]);
      });
    }

    test("an idea's own screens are clean", async ({ page }) => {
      await forceTheme(page, theme);
      await signIn(page);
      await page.goto("/ideas");

      // By href, not "the first link in main" — that was the "Submit an idea" call to
      // action, so the scan navigated to the empty form and checked nothing.
      const firstIdea = page.locator('main a[href*="/ideas/"][href*="/overview"]').first();
      await expect(firstIdea, "no ideas to scan — run `pnpm db:seed`").toBeVisible();
      await firstIdea.click();
      await expect(page).toHaveURL(new RegExp(String.raw`/ideas/[0-9a-f-]+/overview`));

      const base = page.url().replace(/\/[a-z]+$/, "");
      // Overview carries the P18 comment thread and team; Delivery feeds P20's impact card.
      for (const tab of ["overview", "analysis", "evaluation", "improve", "history", "delivery"]) {
        await page.goto(`${base}/${tab}`);
        await page.waitForTimeout(1000);
        const results = await scan(page);
        const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.help}`);
        expect(summary, `${tab} tab [${theme}] violations:\n${summary.join("\n")}`).toEqual([]);
      }
    });
  });
}

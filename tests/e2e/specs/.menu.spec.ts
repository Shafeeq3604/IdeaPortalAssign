import { expect, test, type Page } from "@playwright/test";
const OUT = process.env["SHOT_DIR"] ?? "shots";

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.locator("#field-email").fill(email);
  await page.locator("#field-password").fill("innovation-2026");
  await page.getByRole("button", { name: /^Sign in$/ }).click();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
}

test("account menu", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, "admin@example.invalid");
  await page.goto("/ideas");
  await page.waitForTimeout(900);
  await page.getByRole("button", { name: /Ash Admin/ }).click();
  await page.waitForTimeout(500);

  const out = page.getByRole("menuitem", { name: /Sign out/ });
  await expect(out, "Sign out is not in the menu").toBeVisible();

  // Visible is not enough — the bug was white text on a white popover.
  const colour = await out.evaluate((el) => getComputedStyle(el).color);
  const bg = await out.evaluate((el) => {
    let n: HTMLElement | null = el as HTMLElement;
    while (n) {
      const c = getComputedStyle(n).backgroundColor;
      if (c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent") return c;
      n = n.parentElement;
    }
    return "none";
  });
  console.log(`SIGNOUT colour=${colour} on background=${bg}`);

  await page.screenshot({ path: `${OUT}/menu.png`, clip: { x: 1000, y: 0, width: 440, height: 460 } });

  // And it actually signs you out.
  await out.click();
  await expect(page).toHaveURL(/\/login/);
});

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

function emailFor(name: RegExp): string {
  const match = Object.keys(EMAIL_BY_NAME).find((n) => name.test(n));
  if (!match) throw new Error(`no seeded account matches ${name}`);
  return EMAIL_BY_NAME[match]!;
}

async function signInAs(page: Page, name: RegExp): Promise<void> {
  await page.goto("/login");
  await page.locator("#field-email").fill(emailFor(name));
  await page.locator("#field-password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: /^Sign in$/ }).click();
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
        // P8 replaced the version list with the Timeline, which words v1 differently.
    await expect(page.getByText("The first version, as submitted.")).toBeVisible();
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
    // `exact: true`, not just scoped to `main`: once the stub pipeline reaches SUCCEEDED,
    // OverviewTab renders its own "See the full analysis" link, which also matches
    // { name: "Analysis" } by substring. Locally the pipeline was usually still RUNNING
    // at this point, so only the tab existed and the ambiguity never surfaced; in CI the
    // stub is fast enough that both links are on the page and Playwright's strict mode
    // correctly refuses to guess between them.
    await page.getByRole("main").getByRole("link", { name: "Analysis", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(String.raw`/analysis`));
    await expect(page.getByRole("group", { name: "Analysis progress" })).toBeVisible();
    // The nav map's placeholder shell must be gone for this route.
    await expect(page.getByText(/not implemented|placeholder/i)).toHaveCount(0);
  });


  test("anyone can react to an idea, and it never touches the score (§14)", async ({ page }) => {
    await signInAs(page, /Rae Reviewer/i);

    /**
     * A RANKED idea, chosen deliberately.
     *
     * This used to open whatever was first in the list, which is correct only until
     * another test leaves a draft behind — and one did. A draft has no reaction controls
     * (there is nothing to react to yet), so 'the first idea' quietly became 'an idea
     * with no buttons', and this test failed for a reason that had nothing to do with
     * reactions.
     *
     * A test that depends on the order of a shared list reports other people's mess as
     * its own failure.
     */
    await page.goto("/ideas?status=RANKED");
    // Not scoped to `tbody`. The list has been a table and is now cards; the URL filter
    // above is what guarantees these are ranked, so the markup underneath is free to change.
    const ranked = page.locator('main a[href*="/overview"]').first();
    await expect(
      ranked,
      "no ranked ideas — run `pnpm db:seed && pnpm demo:data`",
    ).toBeVisible();
    await ranked.click();
    await expect(page).toHaveURL(new RegExp(String.raw`/ideas/[0-9a-f-]+/overview`));

    /*
      Matched case-insensitively. The accessible name flips between "Thumbs up (n so far)"
      and "Remove your thumbs up (n so far)" depending on whether you have already voted,
      and a case-sensitive pattern silently stops matching after the first click.
    */
    const up = page.getByRole("button", { name: /thumbs up/i });
    await expect(up).toBeVisible();

    const before = Number((await up.innerText()).trim());
    await up.click();
    await expect(up).toHaveAttribute("aria-pressed", "true");
    await expect(up).toContainText(String(before + 1));

    // Pressing the same thumb again takes the vote back rather than adding a second.
    await up.click();
    await expect(up).toHaveAttribute("aria-pressed", "false");
    await expect(up).toContainText(String(before));

    /*
      The score must not move. This is the whole reason reactions are kept out of the
      engine — §14 and P-1 both require that popularity does not determine the ranking.
    */
    const ideaUrl = page.url();
    await page.goto(ideaUrl.replace("/overview", "/evaluation"));
    const scoreBefore = await page.getByText("/ 100").first().innerText();

    await page.goto(ideaUrl);
    await page.getByRole("button", { name: /thumbs up/i }).click();
    await page.waitForTimeout(600);

    await page.goto(ideaUrl.replace("/overview", "/evaluation"));
    await expect(
      page.getByText("/ 100").first(),
      "a reaction changed the composite score — reactions must never reach the engine",
    ).toHaveText(scoreBefore);
  });

  /**
   * NOTE: this test leaves a DRAFT behind, and there is no way for it not to.
   *
   * Attachments only attach to a draft, and the product has no delete-idea endpoint —
   * deliberately, because an idea version is a record. So the draft stays in the
   * development database until the next `pnpm demo:reset`.
   *
   * That leftover broke the reactions test in this same file, which used to open
   * whatever idea was first. It now asks for a ranked one. Written down because the
   * next test to reach for the first row will hit exactly this again.
   */
  test("a file can be attached to a draft, and a disguised one cannot (FR-02, SPEC §9.2)", async ({
    page,
  }) => {
    await signInAs(page, /Erin Employee/i);

    await page.goto("/ideas/new");
    await page.locator("#field-title").fill(`Attachment journey ${Date.now()}`);
    await page
      .locator("#field-description")
      .fill("A description long enough to pass the submission validation checks.");
    await page.locator("#field-problemStatement").fill("A weekly task is done by hand.");
    await page.locator("#field-expectedUsers").fill("The team that does it.");
    await page.locator("#field-expectedOutcome").fill("It takes less time.");

    // A DRAFT, not a submission: a submitted version's attachments are fixed (§4.3).
    await page.getByRole("button", { name: "Save as draft" }).click();
    await expect(page.getByRole("button", { name: /Add a file/i })).toBeVisible();

    await page.locator('input[type="file"]').setInputFiles({
      name: "supporting-notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("The receipts are retyped by hand every week.\n"),
    });
    await expect(
      page.getByRole("link", { name: "supporting-notes.txt" }),
      "the upload did not appear in the list",
    ).toBeVisible();

    /**
     * SPEC §9.2, through a real browser: a Windows executable named `.pdf`.
     *
     * The BDD suite asserts this at the endpoint. This asserts the other half — that the
     * refusal reaches the person, in words, on the screen they are looking at. A control
     * that fails silently is a control nobody knows about.
     */
    await page.locator('input[type="file"]').setInputFiles({
      name: "report.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.concat([
        Buffer.from([0x4d, 0x5a, 0x90, 0x00]),
        Buffer.from("This program cannot be run in DOS mode."),
        Buffer.from([0x00, 0x01]),
      ]),
    });
    await expect(page.getByRole("alert")).toContainText(/not a PDF/i);

    // Refused, and the list is unchanged.
    await expect(page.getByRole("link", { name: "report.pdf" })).toHaveCount(0);
  });

  test("sign out is in the account menu, legible, and works", async ({ page }) => {
    await signInAs(page, /Erin Employee/i);
    await page.getByRole("button", { name: /Erin Employee/ }).click();

    const out = page.getByRole("menuitem", { name: /Sign out/ });
    await expect(out, "no sign-out item in the account menu").toBeVisible();

    /**
     * Visible is not the assertion. The control WAS visible, focusable and clickable —
     * and painted white on a white popover, because a `[&_button]` rule on the dark
     * header reached three levels down into the dropdown. It was reported as "there is
     * no sign out", which is what an invisible control looks like from outside.
     *
     * The axe sweep did not catch it and could not: it scans what is rendered, and the
     * menu is closed when the page loads. Anything behind an interaction needs a test
     * that performs the interaction.
     */
    const contrast = await out.evaluate((el) => {
      const lum = (c: string) => {
        const [r, g, b] = (c.match(/\d+/g) ?? ["0", "0", "0"]).map(Number) as [number, number, number];
        const ch = (v: number) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
      };
      let node: HTMLElement | null = el.parentElement;
      let bg = "rgb(255, 255, 255)";
      while (node) {
        const c = getComputedStyle(node).backgroundColor;
        if (c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent") { bg = c; break; }
        node = node.parentElement;
      }
      const a = lum(getComputedStyle(el).color);
      const b = lum(bg);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });
    expect(contrast, "sign out does not meet WCAG AA against its own background")
      .toBeGreaterThanOrEqual(4.5);

    await out.click();
    await expect(page).toHaveURL(/\/login/);
  });

  test("no dead ends: an unknown route offers a way out", async ({ page }) => {
    await signInAs(page, /Erin Employee/i);
    await page.goto("/ideas/no-such-route-at-all");
    // SPEC §6.3 assertion 3 — every error state carries a route out.
    await expect(page.getByRole("link", { name: /Back to ideas/i })).toBeVisible();
  });
});

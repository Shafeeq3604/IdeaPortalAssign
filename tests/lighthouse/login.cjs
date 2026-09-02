/**
 * LHCI `puppeteerScript` (SPEC §11.6): every audited route requires a session, so this
 * signs in once per run before LHCI navigates to the URL under test — same seeded
 * MANAGEMENT account and password RUNNING.md documents, reused from the E2E suite.
 *
 * LHCI calls this once per URL/run (9 times for 3 routes × 3 runs), and this is a real
 * password sign-in with Argon2id hashing behind it — deliberately slow. Logging in for
 * real 9 times per invocation is wasteful and risks tripping the rate limiter on a busy
 * machine, so the session cookie from the FIRST real login is cached at module scope
 * (this file is `require`d once per `lhci autorun` process) and reused for every call
 * after that via `page.setCookie`, skipping the form entirely.
 */
let cachedCookies = null;

module.exports = async function login(browser, context) {
  // LHCI passes the BROWSER, not a page — the audit itself reuses the browser's default
  // context, so a cookie set on any page here is present for the page Lighthouse drives.
  const origin = new URL(context.url).origin;
  const page = await browser.newPage();

  if (cachedCookies) {
    await page.setCookie(...cachedCookies);
    await page.close();
    return;
  }

  await page.goto(`${origin}/login`, { waitUntil: "networkidle0" });
  await page.type("#field-email", "manager@example.invalid");
  await page.type("#field-password", "innovation-2026");
  await page.click('form button[type="submit"]');

  // NOT page.waitForNavigation(): sign-in is a client-side route change (TanStack Query
  // mutation + React Router), not a browser navigation, so that event never fires and the
  // first version of this script hung until Puppeteer's own timeout. Waiting for the
  // authenticated shell's own nav landmark is the same signal the E2E suite waits on.
  await page.waitForSelector('nav[aria-label="Main"]', { timeout: 15000 });

  cachedCookies = await page.cookies();
  await page.close();
};

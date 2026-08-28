import { chromium } from "@playwright/test";
const OUT = process.env.SHOT_DIR;
const URL = "https://app-plain-dev.kindpebble-c36c5020.centralindia.azurecontainerapps.io/";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
const p = await ctx.newPage();
try {
  await p.goto(URL, { waitUntil: "networkidle", timeout: 45000 });
} catch (e) {
  console.log("nav note: " + String(e).slice(0, 120));
}
await p.waitForTimeout(2500);
console.log("TITLE " + (await p.title()));
console.log("URL   " + p.url());
await p.screenshot({ path: `${OUT}/ref-1-landing.png`, fullPage: true });
const text = await p.locator("body").innerText().catch(() => "");
console.log("WORDS " + text.split(/\s+/).filter(Boolean).length);
console.log("---- visible text (first 700 chars) ----");
console.log(text.slice(0, 700));
await b.close();

/**
 * A hostile walk of every route as every role.
 *
 * Records what a user would actually hit: console errors, failed requests, error states,
 * empty states, and how much text is on the page. Not a test — a survey.
 */
import { chromium } from "@playwright/test";

const ROLES = [
  { name: "Erin Employee", label: "employee" },
  { name: "Rae Reviewer", label: "reviewer" },
  { name: "Mo Manager", label: "manager" },
  { name: "Ash Admin", label: "admin" },
];

const b = await chromium.launch();
const findings = [];

for (const role of ROLES) {
  const ctx = await b.newContext({ viewport: { width: 1360, height: 1000 } });
  const page = await ctx.newPage();

  const consoleErrors = [];
  const badRequests = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 140)); });
  page.on("response", (r) => {
    if (r.status() >= 400 && !r.url().includes("favicon")) {
      badRequests.push(`${r.status()} ${r.url().replace("http://localhost:3001", "").slice(0, 70)}`);
    }
  });

  await page.goto("http://localhost:5173/login");
  await page.getByRole("button", { name: new RegExp(role.name, "i") }).click();
  await page.getByRole("navigation", { name: "Main" }).waitFor();

  // Discover an idea id to fill the parameterised routes.
  await page.goto("http://localhost:5173/ideas");
  await page.waitForTimeout(1200);
  const href = await page.locator('main a[href*="/overview"]').first().getAttribute("href").catch(() => null);
  const ideaId = href?.split("/")[2] ?? "none";

  const routes = [
    "/ideas", "/me/ideas", "/ideas/new",
    `/ideas/${ideaId}/overview`, `/ideas/${ideaId}/analysis`, `/ideas/${ideaId}/evaluation`,
    `/ideas/${ideaId}/improve`, `/ideas/${ideaId}/review`, `/ideas/${ideaId}/history`,
    `/ideas/${ideaId}/versions/1`, `/ideas/${ideaId}/revise`,
    "/rankings", "/review", "/dashboard",
    "/config/criteria", "/config/profiles",
    "/admin/audit", "/admin/users", "/help/data-and-ai",
  ];

  for (const route of routes) {
    consoleErrors.length = 0;
    badRequests.length = 0;
    await page.goto(`http://localhost:5173${route}`);
    await page.waitForTimeout(1400);

    const main = await page.getByRole("main").innerText().catch(() => "");
    const h1 = await page.getByRole("heading", { level: 1 }).first().innerText().catch(() => "(none)");

    const state =
      /Something went wrong/i.test(main) ? "CRASHED"
      : /Could not load|failing to load/i.test(main) ? "ERROR"
      : /Not available for your role/i.test(main) ? "role-blocked"
      : /Not found/i.test(main) ? "NOT FOUND"
      : main.trim().length < 120 ? "near-empty"
      : "ok";

    findings.push({
      role: role.label,
      route,
      h1: h1.split("\n")[0].slice(0, 40),
      state,
      words: main.split(/\s+/).filter(Boolean).length,
      consoleErrors: [...consoleErrors],
      badRequests: [...badRequests],
    });
  }
  await ctx.close();
}

await b.close();

const bad = findings.filter(
  (f) => !["ok", "role-blocked"].includes(f.state) || f.consoleErrors.length || f.badRequests.length,
);

console.log("=== PROBLEMS ===");
for (const f of bad) {
  console.log(`${f.role.padEnd(9)} ${f.route.padEnd(42)} ${f.state}`);
  for (const e of f.consoleErrors.slice(0, 2)) console.log(`             console: ${e}`);
  for (const r of f.badRequests.slice(0, 3)) console.log(`             request: ${r}`);
}
console.log(`\n${bad.length} problem(s) across ${findings.length} route visits`);

console.log("\n=== WORD COUNT per page (employee view) ===");
for (const f of findings.filter((x) => x.role === "employee" && x.state === "ok")) {
  console.log(`  ${String(f.words).padStart(4)}  ${f.route}`);
}

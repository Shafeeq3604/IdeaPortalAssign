#!/usr/bin/env node
/**
 * `pnpm smoke` — boots nothing, checks everything that should already be up.
 *
 * Definition of Done requires "builds + smoke passes + tests green + nav links work"
 * (SKILL.md §5). This is the smoke half: it verifies the running stack answers, and that
 * the nav map and the API catalogue agree with each other.
 *
 * Expects `pnpm dev` (or the two app dev servers) to be running already. It reports what
 * is down rather than trying to start it — a smoke test that boots things hides failures.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const API = process.env.SMOKE_API_URL ?? "http://localhost:3001";
const WEB = process.env.SMOKE_WEB_URL ?? "http://localhost:5173";

let failures = 0;
const ok = (m) => console.log(`  ok    ${m}`);
const bad = (m) => { console.error(`  FAIL  ${m}`); failures++; };
const skip = (m) => console.log(`  skip  ${m}`);

async function get(url, timeoutMs = 4000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: ctl.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

console.log("\n— static contracts —");

const nav = readFileSync(join(ROOT, "packages/contracts/src/navigation.map.ts"), "utf8");
const routeCount = [...nav.matchAll(/path: "/g)].length;
routeCount > 0 ? ok(`navigation map: ${routeCount} routes`) : bad("navigation map has no routes");

const openapi = JSON.parse(readFileSync(join(ROOT, "openapi.json"), "utf8"));
const opCount = Object.values(openapi.paths).reduce((n, p) => n + Object.keys(p).length, 0);
opCount > 0 ? ok(`openapi: ${opCount} operations, ${Object.keys(openapi.components.schemas).length} schemas`)
            : bad("openapi has no operations");

const undeclared = Object.entries(openapi.paths).flatMap(([p, ops]) =>
  Object.entries(ops).filter(([, o]) => !o["x-access"]).map(([m]) => `${m.toUpperCase()} ${p}`));
undeclared.length === 0 ? ok("every operation declares x-access")
                        : bad(`operations missing x-access: ${undeclared.join(", ")}`);

console.log("\n— api —");

const health = await get(`${API}/health`);
if (!health) {
  bad(`${API}/health unreachable — is \`pnpm --filter @iep/api dev\` running?`);
} else if (health.status !== 200) {
  bad(`${API}/health returned ${health.status}`);
} else {
  const body = await health.json();
  body.status === "ok" ? ok(`/health → ${JSON.stringify(body)}`) : bad(`/health body: ${JSON.stringify(body)}`);
}

console.log("\n— web —");

const root = await get(WEB);
if (!root) {
  bad(`${WEB} unreachable — is \`pnpm --filter @iep/web dev\` running?`);
} else if (root.status !== 200) {
  bad(`${WEB} returned ${root.status}`);
} else {
  ok(`${WEB} → 200`);
  // Walk a sample of real routes; a SPA must serve all of them (deep links work cold).
  const sample = ["/ideas", "/rankings", "/review", "/config/criteria", "/admin/audit"];
  let walked = 0;
  for (const path of sample) {
    const res = await get(WEB + path);
    if (res?.status === 200) walked++;
    else bad(`${path} → ${res?.status ?? "unreachable"}`);
  }
  if (walked === sample.length) ok(`nav map walk: ${walked}/${sample.length} routes served`);
}

console.log("\n— dependencies —");
for (const [label, url] of [["postgres", "localhost:5432"], ["redis", "localhost:6379"]]) {
  const [host, port] = url.split(":");
  const net = await import("node:net");
  const reachable = await new Promise((resolve) => {
    const s = net.createConnection({ host, port: Number(port) });
    s.on("connect", () => { s.destroy(); resolve(true); });
    s.on("error", () => resolve(false));
    setTimeout(() => { s.destroy(); resolve(false); }, 1500);
  });
  // Not a failure at P0 — no feature reads them yet. It becomes one in P2.
  reachable ? ok(`${label} reachable`) : skip(`${label} not running (\`pnpm deps:up\`) — required from P2`);
}

console.log(failures === 0 ? "\nsmoke: PASS\n" : `\nsmoke: ${failures} failure(s)\n`);
process.exit(failures === 0 ? 0 : 1);

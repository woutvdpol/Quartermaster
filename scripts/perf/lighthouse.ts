/*
 * Lighthouse (lab Core Web Vitals) for the main shop and admin pages, mobile + desktop.
 *
 *   npm run build && npm run start -- -p 3001
 *   npm run perf:lighthouse            # → table on stdout + JSON in .local/perf/
 *
 * Uses `npx lighthouse` with Playwright's Chromium (CHROME_PATH is set automatically). Each page runs
 * PERF_LH_RUNS times (default 3) per form factor; the median by LCP is reported. Admin pages get the
 * session cookie of a login through the real form (SEED_OWNER_* from .env, never printed).
 * INP needs real interaction; Lighthouse navigation mode reports TBT as its lab proxy.
 * Options: PERF_LH_RUNS, PERF_LH_FORM_FACTORS (mobile,desktop), PERF_LH_PAGES (comma-separated page
 * names, e.g. "home,product"), PERF_LH_KEEP (directory to keep every full report in),
 * PERF_LH_THROTTLING=devtools (applied throttling — the page really loads over a slowed network/CPU —
 * instead of Lighthouse's default simulation; see docs/perf/round2.md for why both are reported).
 */
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { BASE, adminLogin, cookieHeader, productLinks } from "./lib";

const RUNS = Number(process.env.PERF_LH_RUNS ?? 3);
const OUT_DIR = process.env.PERF_OUT_DIR ?? ".local/perf";
const LABEL = process.env.PERF_LABEL ?? new Date().toISOString().replace(/[:.]/g, "-");
const FORM_FACTORS = (process.env.PERF_LH_FORM_FACTORS ?? "mobile,desktop").split(",") as Array<"mobile" | "desktop">;

type Row = {
  page: string;
  path: string;
  formFactor: "mobile" | "desktop";
  score: number;
  fcp: number;
  lcp: number;
  cls: number;
  tbt: number;
  si: number;
  transferKb: number;
  jsKb: number;
  cssKb: number;
  fontKb: number;
  /** LCP element (selector/snippet) and phase breakdown (ms), when Lighthouse reports them. */
  lcpElement?: string;
  lcpPhases?: Record<string, number>;
};

const KEEP_DIR = process.env.PERF_LH_KEEP; // directory to keep the full Lighthouse JSON reports in

type Audit = { details?: { type?: string; items?: Array<Record<string, unknown>> } };
/** LCP element + phases from the Lighthouse 13 insight audit (falls back to the classic audit). */
function lcpDetails(a: Record<string, Audit>): Pick<Row, "lcpElement" | "lcpPhases"> {
  const insight = a["lcp-breakdown-insight"] ?? a["largest-contentful-paint-element"];
  const items = insight?.details?.items ?? [];
  let lcpElement: string | undefined;
  const lcpPhases: Record<string, number> = {};
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;
    if (n.type === "node" && typeof n.snippet === "string" && !lcpElement) lcpElement = n.snippet.slice(0, 140);
    if (typeof n.subpart === "string" && typeof n.duration === "number") lcpPhases[n.subpart] = Math.round(n.duration);
    if (typeof n.phase === "string" && typeof n.timing === "number") lcpPhases[n.phase] = Math.round(n.timing);
    for (const v of Object.values(n)) if (v && typeof v === "object") visit(v);
  };
  items.forEach(visit);
  return { lcpElement, lcpPhases: Object.keys(lcpPhases).length ? lcpPhases : undefined };
}

function lighthouse(url: string, formFactor: "mobile" | "desktop", cookie?: string): Row | null {
  const dir = mkdtempSync(join(tmpdir(), "qm-lh-"));
  const out = join(dir, "report.json");
  const args = [
    "-y",
    "lighthouse@13",
    url,
    "--quiet",
    "--only-categories=performance",
    "--output=json",
    `--output-path=${out}`,
    "--chrome-flags=--headless=new",
    ...(formFactor === "desktop" ? ["--preset=desktop"] : []),
    ...(process.env.PERF_LH_THROTTLING === "devtools" ? ["--throttling-method=devtools"] : []),
    ...(cookie ? [`--extra-headers=${JSON.stringify({ Cookie: cookie })}`] : []),
  ];
  try {
    execFileSync("npx", args, { stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, CHROME_PATH: chromium.executablePath() } });
  } catch (e) {
    console.warn(`! lighthouse failed for ${url} (${formFactor}): ${(e as Error).message.split("\n")[0]}`);
    return null;
  }
  const r = JSON.parse(readFileSync(out, "utf8"));
  if (KEEP_DIR) {
    mkdirSync(KEEP_DIR, { recursive: true });
    const slug = url.replace(BASE, "").replace(/[^a-z0-9]+/gi, "_").slice(0, 60) || "home";
    writeFileSync(join(KEEP_DIR, `${slug}-${formFactor}-${Date.now()}.json`), JSON.stringify(r));
  }
  const a = r.audits;
  const items: Array<{ resourceType?: string; transferSize?: number }> = a["network-requests"]?.details?.items ?? [];
  const sum = (filter: (i: { resourceType?: string }) => boolean) =>
    Math.round(items.filter(filter).reduce((s, i) => s + (i.transferSize ?? 0), 0) / 102.4) / 10;
  return {
    page: "",
    path: "",
    formFactor,
    score: Math.round((r.categories.performance.score ?? 0) * 100),
    fcp: Math.round(a["first-contentful-paint"].numericValue),
    lcp: Math.round(a["largest-contentful-paint"].numericValue),
    cls: Math.round(a["cumulative-layout-shift"].numericValue * 1000) / 1000,
    tbt: Math.round(a["total-blocking-time"].numericValue),
    si: Math.round(a["speed-index"].numericValue),
    transferKb: sum(() => true),
    jsKb: sum((i) => i.resourceType === "Script"),
    cssKb: sum((i) => i.resourceType === "Stylesheet"),
    fontKb: sum((i) => i.resourceType === "Font"),
    ...lcpDetails(a),
  };
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/shop`);
  const product = (await productLinks(page))[0];
  await adminLogin(page);
  const adminCookie = await cookieHeader(ctx);
  await browser.close();

  const pages: Array<{ page: string; path: string; cookie?: string }> = [
    { page: "home", path: "/" },
    { page: "shop", path: "/shop" },
    { page: "shop + q", path: "/shop?q=helmet" },
    { page: "product", path: product },
    { page: "cms page", path: "/shipping" },
    { page: "admin dashboard", path: "/admin/dashboard", cookie: adminCookie },
    { page: "admin inventory", path: "/admin/inventory", cookie: adminCookie },
  ];

  const only = process.env.PERF_LH_PAGES?.split(",").map((s) => s.trim());
  const rows: Row[] = [];
  for (const p of pages.filter((x) => !only || only.includes(x.page))) {
    for (const ff of FORM_FACTORS) {
      const runs: Row[] = [];
      for (let i = 0; i < RUNS; i++) {
        const r = lighthouse(BASE + p.path, ff, p.cookie);
        if (r) runs.push(r);
      }
      if (!runs.length) continue;
      runs.sort((a, b) => a.lcp - b.lcp);
      const median = { ...runs[Math.floor(runs.length / 2)], page: p.page, path: p.path };
      rows.push(median);
      process.stderr.write(`  ${p.page.padEnd(18)} ${ff.padEnd(7)} score ${median.score} LCP ${median.lcp} ms\n`);
    }
  }

  console.log(
    [
      `Base ${BASE} · Lighthouse 13 · mediaan van ${RUNS} runs · throttling ${process.env.PERF_LH_THROTTLING === "devtools" ? "devtools (toegepast)" : "simulate (standaard)"} · ${new Date().toISOString()}`,
      "",
      "| pagina | vorm | score | FCP (ms) | LCP (ms) | CLS | TBT (ms) | Speed Index (ms) | transfer (kB) | JS (kB) | CSS (kB) | fonts (kB) |",
      "|---|---|---|---|---|---|---|---|---|---|---|---|",
      ...rows.map(
        (r) =>
          `| ${r.page} | ${r.formFactor} | ${r.score} | ${r.fcp} | ${r.lcp} | ${r.cls} | ${r.tbt} | ${r.si} | ${r.transferKb} | ${r.jsKb} | ${r.cssKb} | ${r.fontKb} |`,
      ),
      "",
      "LCP-element en fasen (ms):",
      ...rows.map((r) => `- ${r.page} ${r.formFactor}: ${r.lcpElement ?? "?"} ${r.lcpPhases ? JSON.stringify(r.lcpPhases) : ""}`),
    ].join("\n"),
  );
  mkdirSync(OUT_DIR, { recursive: true });
  const file = `${OUT_DIR}/${LABEL}-lighthouse.json`;
  writeFileSync(file, JSON.stringify({ base: BASE, runs: RUNS, at: new Date().toISOString(), rows }, null, 2));
  console.log(`\nJSON: ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

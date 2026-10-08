/*
 * Repeatable performance measurement (docs/perf/baseline.md, docs/perf/results.md).
 *
 *   npm run build && npm run start -- -p 3001          # production build; demo tenant has domain localhost:3001
 *   npm run perf                                       # → table on stdout + JSON in .local/perf/
 *
 * Per route: server timing over PERF_RUNS sequential requests after a warm-up (TTFB = response headers,
 * total = full body), HTML size, JS referenced by the page (gzip), and — when PERF_PG_URL is set — the
 * number of SQL statements per request from pg_stat_statements.
 *
 * DB query counting: run the server with a dedicated database role (e.g. `qm_perf`, a member of the app
 * role) so only its statements are counted, and point PERF_PG_URL at a connection that may read and
 * reset pg_stat_statements (the extension must be in shared_preload_libraries — dev container only):
 *   DATABASE_URL=postgresql://qm_perf:…@127.0.0.1:54329/quartermaster npm run start -- -p 3001
 *   PERF_PG_URL=postgresql://quartermaster:…@127.0.0.1:54329/quartermaster PERF_PG_ROLE=qm_perf npm run perf
 *
 * Admin routes log in through the real login form (Playwright) with SEED_OWNER_EMAIL / SEED_OWNER_PASSWORD
 * from .env. The cart/checkout measurement reserves one item and removes it again at the end.
 * Read-only otherwise; never starts a payment. Values are never printed.
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { chromium } from "@playwright/test";
import pg from "pg";
import { BASE, adminLogin, cookieHeader, firstHref, productLinks, releaseCart } from "./lib";

const RUNS = Number(process.env.PERF_RUNS ?? 20);
const WARMUP = Number(process.env.PERF_WARMUP ?? 3);
const PG_URL = process.env.PERF_PG_URL;
const PG_ROLE = process.env.PERF_PG_ROLE ?? "qm_perf";
const PG_SCHEMA = process.env.PERF_PG_SCHEMA ?? "perf_stats";
const OUT_DIR = process.env.PERF_OUT_DIR ?? ".local/perf";
const LABEL = process.env.PERF_LABEL ?? new Date().toISOString().replace(/[:.]/g, "-");

type Target = { group: "shop" | "admin" | "search"; name: string; path: string; cookie?: string };
type Result = Target & {
  status: number;
  ttfbP50: number;
  ttfbP95: number;
  totalP50: number;
  totalP95: number;
  htmlBytes: number;
  htmlGzipBytes: number;
  jsFiles: number;
  jsGzipBytes: number;
  queriesPerRequest: number | null;
  /** pg_stat_statements rows of this route's measured requests (JSON only). */
  statements: unknown[];
};

function pct(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[idx] * 10) / 10;
}

async function timedGet(path: string, cookie?: string) {
  const start = performance.now();
  const res = await fetch(BASE + path, {
    redirect: "manual",
    headers: { "accept-encoding": "identity", ...(cookie ? { cookie } : {}) },
  });
  const ttfb = performance.now() - start;
  const body = await res.text();
  const total = performance.now() - start;
  return { status: res.status, ttfb, total, body };
}

const jsSizeCache = new Map<string, number>();
async function jsGzipSize(src: string): Promise<number> {
  const cached = jsSizeCache.get(src);
  if (cached !== undefined) return cached;
  const res = await fetch(BASE + src);
  const size = res.ok ? gzipSync(Buffer.from(await res.arrayBuffer())).length : 0;
  jsSizeCache.set(src, size);
  return size;
}

/** Script chunks the page loads: <script src> plus chunks referenced in the RSC payload / preloads. */
function scriptSources(html: string): string[] {
  // `<script noModule>` (legacy polyfills) is never downloaded by modern browsers.
  const noModule = new Set([...html.matchAll(/<script[^>]*src="([^"]+)"[^>]*noModule/gi)].map((m) => m[1]));
  const out = new Set<string>();
  for (const m of html.matchAll(/\/_next\/static\/[^"'\\\s)]+?\.js/g)) if (!noModule.has(m[0])) out.add(m[0]);
  return [...out];
}

class QueryCounter {
  private client: pg.Client | null = null;
  private roleOid: number | null = null;
  async init() {
    if (!PG_URL) return;
    this.client = new pg.Client({ connectionString: PG_URL });
    await this.client.connect();
    const r = await this.client.query("SELECT oid FROM pg_roles WHERE rolname = $1", [PG_ROLE]);
    this.roleOid = r.rows[0]?.oid ?? null;
    if (this.roleOid === null) throw new Error(`role ${PG_ROLE} not found`);
  }
  async reset() {
    if (!this.client) return;
    await this.client.query(`SELECT ${PG_SCHEMA}.pg_stat_statements_reset($1::oid, 0, 0)`, [this.roleOid]);
  }
  async count(): Promise<number | null> {
    if (!this.client) return null;
    const r = await this.client.query(
      `SELECT coalesce(sum(calls), 0)::int AS calls FROM ${PG_SCHEMA}.pg_stat_statements
        WHERE userid = $1 AND query NOT ILIKE 'BEGIN%' AND query NOT ILIKE 'COMMIT%' AND query NOT ILIKE 'ROLLBACK%'`,
      [this.roleOid],
    );
    return r.rows[0].calls;
  }
  async top(limit = 25) {
    if (!this.client) return [];
    const r = await this.client.query(
      `SELECT calls, round(total_exec_time::numeric, 1) AS total_ms, round(mean_exec_time::numeric, 2) AS mean_ms,
              left(regexp_replace(query, '\\s+', ' ', 'g'), 220) AS query
         FROM ${PG_SCHEMA}.pg_stat_statements WHERE userid = $1 ORDER BY total_exec_time DESC LIMIT $2`,
      [this.roleOid, limit],
    );
    return r.rows;
  }
  /** Ids for admin detail pages (newest product/order of the tenant serving BASE). */
  async adminIds(): Promise<{ product?: string; order?: string }> {
    if (!this.client) return {};
    const host = new URL(BASE).host;
    const r = await this.client.query(
      `SELECT (SELECT id FROM products p WHERE p."tenantId" = d."tenantId" ORDER BY p."createdAt" DESC LIMIT 1) AS product,
              (SELECT id FROM orders o WHERE o."tenantId" = d."tenantId" ORDER BY o."createdAt" DESC LIMIT 1) AS "order"
         FROM tenant_domains d WHERE d.host = $1`,
      [host],
    );
    return { product: r.rows[0]?.product ?? undefined, order: r.rows[0]?.order ?? undefined };
  }
  async close() {
    await this.client?.end();
  }
}

async function measure(target: Target, counter: QueryCounter): Promise<Result> {
  for (let i = 0; i < WARMUP; i++) await timedGet(target.path, target.cookie);
  await counter.reset();
  const ttfb: number[] = [];
  const total: number[] = [];
  let last = { status: 0, body: "" };
  for (let i = 0; i < RUNS; i++) {
    const r = await timedGet(target.path, target.cookie);
    ttfb.push(r.ttfb);
    total.push(r.total);
    last = r;
  }
  // Give fire-and-forget work (after(), background revalidation) a moment to land in the stats.
  await new Promise((r) => setTimeout(r, 300));
  const calls = await counter.count();
  const statements = await counter.top(40);
  const scripts = scriptSources(last.body);
  let js = 0;
  for (const s of scripts) js += await jsGzipSize(s);
  return {
    ...target,
    cookie: undefined,
    status: last.status,
    ttfbP50: pct(ttfb, 50),
    ttfbP95: pct(ttfb, 95),
    totalP50: pct(total, 50),
    totalP95: pct(total, 95),
    htmlBytes: Buffer.byteLength(last.body),
    htmlGzipBytes: gzipSync(last.body).length,
    jsFiles: scripts.length,
    jsGzipBytes: js,
    queriesPerRequest: calls === null ? null : Math.round((calls / RUNS) * 10) / 10,
    statements,
  };
}

function kb(bytes: number) {
  return (bytes / 1024).toFixed(1);
}

async function main() {
  const counter = new QueryCounter();
  await counter.init();
  const browser = await chromium.launch();
  const shopCtx = await browser.newContext();
  const adminCtx = await browser.newContext();
  const shopPage = await shopCtx.newPage();
  const adminPage = await adminCtx.newPage();
  const targets: Target[] = [];
  let cartCookie: string | undefined;

  try {
    // ── Discover URLs ───────────────────────────────────────────────────────
    await shopPage.goto(`${BASE}/shop`);
    const products = await productLinks(shopPage);
    const product = products[0];
    const filter = await shopPage.getByRole("complementary").locator('a[aria-pressed="false"]').first().getAttribute("href");
    const category = await firstHref(shopPage, "/", /^\/shop\/category\//);
    const cms = (await firstHref(shopPage, "/", /^\/(about|contact|shipping|returns|privacy|terms)$/)) ?? "/about";

    targets.push(
      { group: "shop", name: "home", path: "/" },
      { group: "shop", name: "shop", path: "/shop" },
      { group: "shop", name: "shop + filter", path: filter ?? "/shop?sort=price_desc" },
      { group: "shop", name: "shop + q", path: "/shop?q=helmet" },
      ...(category ? [{ group: "shop" as const, name: "category", path: category }] : []),
      { group: "shop", name: "product", path: product },
      { group: "shop", name: "cms page", path: cms },
      { group: "shop", name: "404 / redirect lookup", path: "/this/does/not/exist" },
    );

    // ── Cart with one reserved item ─────────────────────────────────────────
    for (const href of products.slice(0, 15)) {
      await shopPage.goto(BASE + href);
      const add = shopPage.getByRole("button", { name: "Add to cart", exact: true });
      if (!(await add.isVisible())) continue;
      await add.click();
      await shopPage.getByText(/Added to your cart|In your cart/).first().waitFor();
      cartCookie = await cookieHeader(shopCtx);
      break;
    }
    if (cartCookie) {
      targets.push(
        { group: "shop", name: "cart (1 item)", path: "/cart", cookie: cartCookie },
        { group: "shop", name: "checkout (1 item)", path: "/checkout", cookie: cartCookie },
      );
    } else {
      console.warn("! no purchasable product found — cart/checkout measured empty");
      targets.push({ group: "shop", name: "cart (empty)", path: "/cart" });
    }

    // ── Search ──────────────────────────────────────────────────────────────
    for (const q of ["helmet", "iron cross", "1944", "stahlhelm m35", "xyzzy"]) {
      targets.push({ group: "search", name: `q=${q}`, path: `/shop?q=${encodeURIComponent(q)}` });
    }

    // ── Admin ───────────────────────────────────────────────────────────────
    await adminLogin(adminPage);
    const adminCookie = await cookieHeader(adminCtx);
    const ids = await counter.adminIds();
    const productEdit = ids.product
      ? `/admin/inventory/${ids.product}`
      : await firstHref(adminPage, "/admin/inventory", /^\/admin\/inventory\/(?!new$)[^/?]+$/);
    const orderDetail = ids.order
      ? `/admin/orders/${ids.order}`
      : await firstHref(adminPage, "/admin/orders", /^\/admin\/orders\/[^/?]+$/);
    const customerDetail = await firstHref(adminPage, "/admin/customers", /^\/admin\/customers\/[^/?]+$/);
    const adminPaths: Array<[string, string | null]> = [
      ["dashboard", "/admin/dashboard"],
      ["inventory list", "/admin/inventory"],
      ["inventory search", "/admin/inventory?q=helmet"],
      ["product edit", productEdit],
      ["orders list", "/admin/orders"],
      ["order detail", orderDetail],
      ["customers", "/admin/customers"],
      ["customer detail", customerDetail],
      ["settings", "/admin/settings/general"],
    ];
    for (const [name, path] of adminPaths) {
      if (path) targets.push({ group: "admin", name, path, cookie: adminCookie });
    }

    // Park the browser pages: open admin/shop pages prefetch links in the background, which would
    // otherwise be counted as DB queries of the first measured routes.
    await shopPage.goto("about:blank");
    await adminPage.goto("about:blank");

    // ── Measure ─────────────────────────────────────────────────────────────
    const results: Result[] = [];
    for (const t of targets) {
      const r = await measure(t, counter);
      results.push(r);
      process.stderr.write(`  ${t.group.padEnd(6)} ${t.name.padEnd(24)} ${r.status} ttfb p50 ${r.ttfbP50} ms\n`);
    }

    // ── Report ──────────────────────────────────────────────────────────────
    const lines = [
      `Base ${BASE} · ${RUNS} runs (+${WARMUP} warm-up) · ${new Date().toISOString()}`,
      "",
      "| groep | route | pad | status | TTFB p50 | TTFB p95 | totaal p50 | totaal p95 | queries/req | HTML (kB, gzip) | JS (bestanden, kB gzip) |",
      "|---|---|---|---|---|---|---|---|---|---|---|",
      ...results.map(
        (r) =>
          `| ${r.group} | ${r.name} | \`${r.path.replace(/\/admin\/(inventory|orders|customers)\/[^/?]+/, "/admin/$1/[id]")}\` | ${r.status} | ${r.ttfbP50} | ${r.ttfbP95} | ${r.totalP50} | ${r.totalP95} | ${r.queriesPerRequest ?? "–"} | ${kb(r.htmlBytes)} (${kb(r.htmlGzipBytes)}) | ${r.jsFiles}, ${kb(r.jsGzipBytes)} |`,
      ),
    ];
    console.log(lines.join("\n"));
    mkdirSync(OUT_DIR, { recursive: true });
    const file = `${OUT_DIR}/${LABEL}.json`;
    writeFileSync(file, JSON.stringify({ base: BASE, runs: RUNS, at: new Date().toISOString(), results }, null, 2));
    console.log(`\nJSON: ${file}`);
  } finally {
    if (cartCookie) await releaseCart(shopPage).catch((e) => console.warn("! cart release failed", e));
    await browser.close();
    await counter.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

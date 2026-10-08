import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import type { ServiceContext } from "@/server/context";
import { createProduct } from "@/server/catalog/products";
import { createCategory } from "@/server/catalog/categories";
import { listFeedProducts, listIndexableProducts } from "@/server/seo/queries";
import { createTenantContext, resetDb } from "./helpers";

/*
 * SEO route handlers against a real database: tenant isolation (a shop's sitemaps, feed and llms.txt
 * only ever contain its own URLs), visibility rules (sensitive / compliance / sold / feed policy)
 * and the "coming soon" lockdown.
 */

// Outside Next there is no data cache; run cached reads directly.
vi.mock("next/cache", () => ({
  unstable_cache: (fn: () => unknown) => fn,
  revalidateTag: () => {},
  revalidatePath: () => {},
}));
// The request host decides the tenant; tests pick it directly.
const scope = vi.hoisted(() => ({ tenantId: null as string | null, host: "a.test" }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: scope.host }),
  cookies: async () => ({ get: () => undefined, has: () => false, getAll: () => [] }),
}));
vi.mock("@/server/theme/preview", () => ({ getThemePreview: async () => null }));
vi.mock("@/server/tenant", () => {
  const resolve = async () => {
    if (!scope.tenantId) return { kind: "unknown" as const };
    const { db: client } = await import("@/server/db");
    const tenant = await client.tenant.findUniqueOrThrow({ where: { id: scope.tenantId } });
    return { kind: "tenant" as const, tenant };
  };
  return {
    normalizeHost: (h: string | null | undefined) => (h ? h.trim().toLowerCase() : null),
    isPlatformHost: () => false,
    getRequestScope: resolve,
    getRequestTenant: async () => {
      const s = await resolve();
      return s.kind === "tenant" ? s.tenant : null;
    },
  };
});

let a: ServiceContext;
let b: ServiceContext;

async function withImage(ctx: ServiceContext, productId: string) {
  await db.productImage.create({
    data: { tenantId: ctx.tenantId, productId, storageKey: `${ctx.tenantId}/products/${productId}/i1.jpg`, variants: { card: { key: `${ctx.tenantId}/p/${productId}/card.webp` }, large: { key: `${ctx.tenantId}/p/${productId}/large.webp` } } },
  });
}

function asShop(ctx: ServiceContext, host: string) {
  scope.tenantId = ctx.tenantId;
  scope.host = host;
}

const locs = (xml: string) => [...xml.matchAll(/<(?:loc|g:link|image:loc|g:image_link)>([^<]+)</g)].map((m) => m[1]);

beforeEach(async () => {
  await resetDb();
  a = await createTenantContext({ slug: "a" });
  b = await createTenantContext({ slug: "b" });
});

describe("SEO data visibility", () => {
  it("indexable products: own tenant, not sensitive, not hidden in the shop country, sold only with the archive", async () => {
    const ok = await createProduct(a, { title: "Helmet", price: 1000, status: "ACTIVE" });
    await withImage(a, ok.id);
    await createProduct(a, { title: "Sensitive", price: 1000, status: "ACTIVE", blurred: true });
    const symbols = await createProduct(a, { title: "Symbols", price: 1000, status: "ACTIVE", restrictedSymbols: true });
    await withImage(a, symbols.id);
    const sold = await createProduct(a, { title: "Sold", price: 1000, status: "ACTIVE" });
    await db.product.update({ where: { id: sold.id }, data: { status: "SOLD" } });
    await createProduct(b, { title: "Other shop", price: 1000, status: "ACTIVE" });

    const titles = async (includeSold: boolean, country: string) => (await listIndexableProducts(a.tenantId, includeSold, country, 0)).map((r) => r.title).sort();
    expect(await titles(false, "NL")).toEqual(["Helmet", "Symbols"]);
    expect(await titles(true, "NL")).toEqual(["Helmet", "Sold", "Symbols"]);

    // A rule that hides restricted symbols in the shop's own country drops the item; a blur rule keeps it without photos.
    await db.complianceRule.create({ data: { tenantId: a.tenantId, name: "§86a", match: "RESTRICTED_SYMBOLS", action: "HIDE_PRODUCT", countries: ["DE"] } });
    expect(await titles(false, "DE")).toEqual(["Helmet"]);
    expect(await titles(false, "NL")).toEqual(["Helmet", "Symbols"]);
    await db.complianceRule.create({ data: { tenantId: a.tenantId, name: "blur", match: "RESTRICTED_SYMBOLS", action: "BLUR_IMAGES", countries: ["NL"] } });
    const rows = await listIndexableProducts(a.tenantId, false, "NL", 0);
    expect(rows.find((r) => r.title === "Symbols")?.images).toEqual([]);
    expect(rows.find((r) => r.title === "Helmet")?.images[0]).toMatch(/^\/uploads\/.+large\.webp$/);
  });

  it("merchant feed: only buyable items with a photo, never sensitive / restricted / age / deactivated / reserved", async () => {
    const ok = await createProduct(a, { title: "Buyable", price: 1000, status: "ACTIVE" });
    await withImage(a, ok.id);
    await createProduct(a, { title: "No photo", price: 1000, status: "ACTIVE" });
    for (const flag of ["blurred", "restrictedSymbols", "ageRestricted", "requiresDeactivationCert"] as const) {
      const p = await createProduct(a, { title: flag, price: 1000, status: "ACTIVE" });
      await db.product.update({ where: { id: p.id }, data: { [flag]: true } });
      await withImage(a, p.id);
    }
    const reserved = await createProduct(a, { title: "Reserved", price: 1000, status: "ACTIVE" });
    await db.product.update({ where: { id: reserved.id }, data: { status: "RESERVED" } });
    await withImage(a, reserved.id);
    const foreign = await createProduct(b, { title: "Foreign", price: 1000, status: "ACTIVE" });
    await withImage(b, foreign.id);
    expect((await listFeedProducts(a.tenantId, "NL", 0)).map((r) => r.title)).toEqual(["Buyable"]);
  });
});

describe("SEO routes: tenant isolation", () => {
  beforeEach(async () => {
    const cat = await createCategory(a, { title: "Helmets" });
    for (const [ctx, title] of [[a, "A helmet"], [a, "A tunic"], [b, "B helmet"]] as const) {
      const p = await createProduct(ctx, { title, price: 1000, status: "ACTIVE", ...(ctx === a ? { categoryId: cat.id } : {}) });
      await withImage(ctx, p.id);
    }
    await createCategory(b, { title: "B only category" });
  });

  it("sitemap index and files only list the request shop's URLs", async () => {
    const { GET: index } = await import("@/app/sitemap.xml/route");
    const { GET: file } = await import("@/app/sitemaps/[file]/route");
    asShop(a, "a.test");
    const idx = await (await index()).text();
    expect(idx).toContain("<sitemapindex");
    const files = locs(idx);
    expect(files.length).toBeGreaterThanOrEqual(3);
    const all: string[] = [];
    for (const url of files) {
      const name = url.split("/").pop()!;
      const res = await file(new Request(url), { params: Promise.resolve({ file: name }) });
      expect(res.status).toBe(200);
      all.push(...locs(await res.text()));
    }
    expect(all.length).toBeGreaterThan(3);
    for (const url of all) expect(url.startsWith("http://a.test/")).toBe(true);
    const joined = all.join("\n");
    expect(joined).toContain("a-helmet");
    expect(joined).not.toContain("b-helmet");
    expect(joined).not.toContain(b.tenantId);
    expect(joined).not.toContain("b-only-category");
  });

  it("feed and llms.txt only contain the request shop", async () => {
    const { GET: feed } = await import("@/app/feeds/google-merchant.xml/route");
    const { GET: llms } = await import("@/app/llms-full.txt/route");
    asShop(b, "b.test");
    const xml = await (await feed()).text();
    expect(xml).toContain("<g:title>B helmet</g:title>");
    expect(xml).not.toContain("A helmet");
    for (const url of locs(xml)) expect(url.startsWith("http://b.test/")).toBe(true);
    const txt = await (await llms()).text();
    for (const url of txt.match(/https?:\/\/[^\s)]+/g) ?? []) expect(url.startsWith("http://b.test/")).toBe(true);
    expect(txt).not.toContain("Helmets](");
  });

  it("unknown hosts get 404s; coming-soon shops publish nothing", async () => {
    const { GET: feed } = await import("@/app/feeds/google-merchant.xml/route");
    const { GET: index } = await import("@/app/sitemap.xml/route");
    const robots = (await import("@/app/robots")).default;
    scope.tenantId = null;
    expect((await feed()).status).toBe(404);
    expect((await index()).status).toBe(404);

    await db.tenant.update({ where: { id: a.tenantId }, data: { setupState: {}, setupCompletedAt: null } });
    asShop(a, "a.test");
    expect((await feed()).status).toBe(404);
    expect(await (await index()).text()).not.toContain("<loc>");
    expect(await robots()).toEqual({ rules: { userAgent: "*", disallow: "/" } });
  });

  it("product markdown alternate respects tenant and visibility", async () => {
    const { GET } = await import("@/app/md/product/[stockCode]/route");
    const mine = await db.product.findFirstOrThrow({ where: { tenantId: a.tenantId, title: "A helmet" } });
    const theirs = await db.product.findFirstOrThrow({ where: { tenantId: b.tenantId } });
    asShop(a, "a.test");
    const ok = await GET(new Request("http://a.test/x"), { params: Promise.resolve({ stockCode: String(mine.stockCode) }) });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toContain("text/markdown");
    expect(ok.headers.get("link")).toBe(`<http://a.test/product/${mine.stockCode}/${mine.slug}>; rel="canonical"`);
    const body = await ok.text();
    expect(body).toContain("# A helmet");
    expect(body).toContain(`- **No.:** ${mine.stockCode}`);
    if (theirs.stockCode !== mine.stockCode) {
      const other = await GET(new Request("http://a.test/x"), { params: Promise.resolve({ stockCode: String(theirs.stockCode) }) });
      // Stock codes are per tenant: B's code either 404s here or resolves to A's own product, never to B's.
      expect(other.status === 404 || !(await other.text()).includes("B helmet")).toBe(true);
    }
    await db.product.update({ where: { id: mine.id }, data: { blurred: true } });
    expect((await GET(new Request("http://a.test/x"), { params: Promise.resolve({ stockCode: String(mine.stockCode) }) })).status).toBe(404);
  });
});

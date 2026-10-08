import { expect, test, type Page } from "@playwright/test";

/*
 * SEO / GEO smoke checks (read-only) for a shop host: canonical + structured data on a product page,
 * robots.txt, the sitemap index, the merchant feed, llms.txt and the markdown alternate.
 */

type Node = Record<string, unknown>;

async function jsonLd(page: Page): Promise<Node[]> {
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  return blocks.map((b) => JSON.parse(b) as Node);
}

async function firstProductHref(page: Page): Promise<string> {
  await page.goto("/shop");
  const href = await page.locator('main a[href^="/product/"]').first().getAttribute("href");
  expect(href, "catalog has at least one product").toBeTruthy();
  return href!;
}

test("product page: canonical, markdown alternate, Product + Offer JSON-LD, one h1", async ({ page, baseURL }) => {
  const href = await firstProductHref(page);
  await page.goto(href);
  const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
  expect(canonical).toBe(new URL(href, baseURL).toString());
  const md = await page.locator('link[rel="alternate"][type="text/markdown"]').getAttribute("href");
  expect(md).toMatch(/\/product\/\d+\.md$/);
  await expect(page.locator("h1")).toHaveCount(1);

  const nodes = await jsonLd(page);
  const product = nodes.find((n) => n["@type"] === "Product");
  expect(product, "Product JSON-LD").toBeTruthy();
  expect(product!.name).toBeTruthy();
  expect(product!.url).toBe(canonical);
  const offer = product!.offers as Node | undefined;
  if (offer) {
    expect(offer.price).toMatch(/^\d+(\.\d+)?$/);
    expect(offer.priceCurrency).toMatch(/^[A-Z]{3}$/);
    expect(String(offer.availability)).toMatch(/^https:\/\/schema\.org\/(InStock|OutOfStock|SoldOut)$/);
    expect(offer.itemCondition).toBe("https://schema.org/UsedCondition");
  }
  expect(nodes.some((n) => n["@type"] === "BreadcrumbList")).toBe(true);
});

test("home page: Organization + WebSite JSON-LD", async ({ page }) => {
  await page.goto("/");
  const types = (await jsonLd(page)).map((n) => n["@type"]);
  expect(types).toContain("OnlineStore");
  expect(types).toContain("WebSite");
});

test("cart is noindex", async ({ page }) => {
  await page.goto("/cart");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
});

test("robots.txt, sitemap index, feed, llms.txt and markdown alternate", async ({ request, page }) => {
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toMatch(/Disallow: \/checkout/);
  expect(robots).toMatch(/Sitemap: .+\/sitemap\.xml/);

  const index = await request.get("/sitemap.xml");
  expect(index.headers()["content-type"]).toContain("xml");
  const indexXml = await index.text();
  expect(indexXml).toContain("<sitemapindex");
  const products = indexXml.match(/<loc>([^<]+products-1\.xml)<\/loc>/)?.[1];
  expect(products).toBeTruthy();
  expect(await (await request.get(new URL(products!).pathname)).text()).toContain("<url><loc>");

  const feed = await (await request.get("/feeds/google-merchant.xml")).text();
  expect(feed).toContain('xmlns:g="http://base.google.com/ns/1.0"');

  const llms = await request.get("/llms.txt");
  expect(llms.status()).toBe(200);
  expect(await llms.text()).toMatch(/^# .+\n\n> /);

  const href = await firstProductHref(page);
  const code = href.split("/")[2];
  const md = await request.get(`/product/${code}.md`);
  expect(md.status()).toBe(200);
  expect(md.headers()["content-type"]).toContain("text/markdown");
  expect(await md.text()).toContain(`- **No.:** ${code}`);
});

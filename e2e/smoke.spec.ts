import { expect, test, type Page } from "@playwright/test";

/*
 * Smoke tests for a deployed (or local) Quartermaster storefront. They only read, plus one
 * cart reservation that is removed again at the end. No payment is ever started.
 */

/** Product links on a catalog page (cards link to /product/<stockCode>). */
async function productLinks(page: Page): Promise<string[]> {
  const hrefs = await page.locator('main a[href^="/product/"]').evaluateAll((els) =>
    els.map((el) => el.getAttribute("href") ?? ""),
  );
  return [...new Set(hrefs.filter(Boolean))];
}

test("health endpoint answers ok", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ status: "ok" });
});

test("readiness endpoint reports the database", async ({ request }) => {
  const res = await request.get("/api/ready");
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ status: "ready" });
});

test("home page renders", async ({ page }) => {
  const res = await page.goto("/");
  expect(res?.status()).toBe(200);
  await expect(page.locator("header").first()).toBeVisible();
  await expect(page.locator("main")).toBeVisible();
  await expect(page.locator("footer").first()).toBeVisible();
});

test("catalog renders and a filter narrows the result", async ({ page }) => {
  await page.goto("/shop");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect((await productLinks(page)).length).toBeGreaterThan(0);

  // Desktop filter sidebar: pick the first facet/tag toggle (rendered as links with aria-pressed).
  const filters = page.getByRole("complementary").locator('a[aria-pressed="false"]');
  await expect(filters.first()).toBeVisible();
  await filters.first().click();
  await expect(page).toHaveURL(/[?&](f|tag)=/);
  await expect(page.getByRole("complementary").locator('a[aria-pressed="true"]').first()).toBeVisible();
  expect((await productLinks(page)).length).toBeGreaterThan(0);
});

test("product page renders", async ({ page }) => {
  await page.goto("/shop");
  const [first] = await productLinks(page);
  expect(first, "catalog has at least one product").toBeTruthy();
  const res = await page.goto(first);
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator('script[type="application/ld+json"]').first()).toBeAttached();
});

test("add to cart reserves the item, checkout renders", async ({ page }) => {
  await page.goto("/shop");
  const links = await productLinks(page);

  // Find a product that can be bought right now (not sold, not in someone else's cart).
  let added = false;
  for (const href of links.slice(0, 12)) {
    await page.goto(href);
    const add = page.getByRole("button", { name: "Add to cart", exact: true });
    if (!(await add.isVisible())) continue;
    await add.click();
    await expect(page.getByText(/Added to your cart|In your cart/)).toBeVisible();
    added = true;
    break;
  }
  test.skip(!added, "no purchasable product found in the first catalog page (all sold/reserved or login required)");

  try {
    await page.goto("/cart");
    await expect(page.getByRole("heading", { level: 1, name: "Your cart" })).toBeVisible();
    // The reservation countdown is shown for every reserved line.
    await expect(page.getByRole("main").getByText("Reserved for you").first()).toBeVisible();

    // Checkout page renders its form — never submitted, so no order or payment is created.
    await page.goto("/checkout");
    await expect(page.getByRole("heading", { level: 1, name: "Checkout" })).toBeVisible();
    await expect(page.getByRole("main").getByLabel("Email address").first()).toBeVisible();
  } finally {
    await releaseCart(page);
  }
});

/** Remove every cart line so the (unique) items are not held for 15 minutes. */
async function releaseCart(page: Page) {
  await page.goto("/cart");
  const remove = page.getByRole("button", { name: /^Remove .+ from your cart$/ });
  const empty = page.getByText("Your cart is empty");
  // Cart lines stream in after the shell; wait until either a line or the empty state shows.
  await expect(remove.first().or(empty)).toBeVisible();
  for (let i = 0; i < 10 && (await remove.count()) > 0; i++) {
    const before = await remove.count();
    await remove.first().click();
    await expect(remove).toHaveCount(before - 1);
  }
  await expect(empty).toBeVisible();
}

test("admin login page renders", async ({ page }) => {
  const res = await page.goto("/admin/login");
  expect(res?.status()).toBe(200);
  await expect(page.getByLabel(/email/i)).toBeVisible();
  await expect(page.getByLabel(/password/i)).toBeVisible();
});

// Theme builder preview (src/lib/theme-preview.ts): the preview flag alone must never show a draft.
test("theme preview is staff-only and never cached", async ({ page }) => {
  const res = await page.goto("/?qm-theme-preview=1");
  expect(res?.status()).toBe(200);
  expect(res?.headers()["cache-control"] ?? "").toMatch(/no-store/);
  await expect(page.locator(".shop-root")).toBeVisible();
  await expect(page.getByText("Theme preview", { exact: false })).toHaveCount(0);
  await page.goto("/?qm-theme-preview=0");
});

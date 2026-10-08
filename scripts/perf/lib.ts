/* Shared helpers for scripts/perf (measure.ts, lighthouse.ts). */
import type { BrowserContext, Page } from "@playwright/test";

export const BASE = (
  process.env.PERF_BASE_URL ?? (process.env.PERF_LH_THROTTLING === "packet" ? "https://localhost:3001" : "http://localhost:3001")
).replace(/\/$/, "");

export async function cookieHeader(ctx: BrowserContext): Promise<string> {
  return (await ctx.cookies(BASE)).map((c) => `${c.name}=${c.value}`).join("; ");
}

export async function productLinks(page: Page): Promise<string[]> {
  const hrefs = await page.locator('main a[href^="/product/"]').evaluateAll((els) =>
    els.map((el) => el.getAttribute("href") ?? ""),
  );
  return [...new Set(hrefs.filter(Boolean))];
}

export async function adminLogin(page: Page) {
  const email = process.env.SEED_OWNER_EMAIL;
  const password = process.env.SEED_OWNER_PASSWORD;
  if (!email || !password) throw new Error("SEED_OWNER_EMAIL / SEED_OWNER_PASSWORD missing in .env");
  await page.goto(`${BASE}/admin/login`);
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/admin/login"), { timeout: 30_000 }), page.getByRole("button", { name: /sign in|log in/i }).click()]);
}

export async function firstHref(page: Page, url: string, pattern: RegExp): Promise<string | null> {
  await page.goto(BASE + url);
  const hrefs = await page.locator("a[href]").evaluateAll((els) => els.map((el) => el.getAttribute("href") ?? ""));
  return hrefs.find((h) => pattern.test(h)) ?? null;
}

export async function releaseCart(page: Page) {
  await page.goto(`${BASE}/cart`);
  const remove = page.getByRole("button", { name: /^Remove .+ from your cart$/ });
  const empty = page.getByText("Your cart is empty");
  await remove.first().or(empty).waitFor();
  for (let i = 0; i < 10 && (await remove.count()) > 0; i++) {
    const before = await remove.count();
    await remove.first().click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('button[aria-label^="Remove "]').length < n,
      before,
      { timeout: 10_000 },
    ).catch(() => undefined);
  }
}

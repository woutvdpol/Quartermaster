import { expect, test } from "@playwright/test";

/*
 * Smart-search UI (docs/search.md § UI). Runs without the embedder (CI: lexical fallback); the
 * "Looks like this" rail needs product vectors — CI indexes them with `npm run search -- reindex
 * --all --fake` after seeding. Read-only.
 */

test("header search: typing shows suggestions, Enter opens the results page", async ({ page }) => {
  await page.goto("/");
  const box = page.getByRole("combobox", { name: "Search products" }).first();
  await box.click();
  await box.pressSequentially("helm", { delay: 40 });
  await expect(box).toHaveAttribute("aria-expanded", "true");
  const listbox = page.getByRole("listbox", { name: "Suggestions" }).first();
  await expect(listbox.locator('[role="option"][href^="/product/"]').first()).toBeVisible();
  await expect(listbox.getByRole("option", { name: /See all/ })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /suggestion/ }).first()).toHaveText(/\d+ suggestions? available/);

  // Arrow keys move the active option (aria-activedescendant); Escape closes and keeps the text.
  await box.press("ArrowDown");
  const active = await box.getAttribute("aria-activedescendant");
  expect(active).toBeTruthy();
  await expect(page.locator(`[id="${active}"]`)).toHaveAttribute("aria-selected", "true");
  await box.press("Escape");
  await expect(box).toHaveAttribute("aria-expanded", "false");
  await expect(box).toHaveValue("helm");

  // Enter without an active option submits the search.
  await box.press("Enter");
  await expect(page).toHaveURL(/\/shop\?q=helm$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("helm");
  await expect(page.locator('main a[href^="/product/"]').first()).toBeVisible();
});

test("header search: ArrowDown + Enter opens the highlighted product", async ({ page }) => {
  await page.goto("/");
  const box = page.getByRole("combobox", { name: "Search products" }).first();
  await box.click();
  await box.pressSequentially("helm", { delay: 40 });
  const firstProduct = page.getByRole("listbox", { name: "Suggestions" }).first().locator('[role="option"][href^="/product/"]').first();
  await expect(firstProduct).toBeVisible();
  const href = await firstProduct.getAttribute("href");
  // Walk down until the first product option is active.
  for (let i = 0; i < 8 && (await firstProduct.getAttribute("aria-selected")) !== "true"; i++) await box.press("ArrowDown");
  await box.press("Enter");
  await expect(page).toHaveURL(new RegExp(`${href!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
});

test("results page: understood filters are removable chips; literal search switch", async ({ page }) => {
  await page.goto("/shop?q=duitse+helm");
  const chip = page.getByRole("link", { name: /^Remove filter Country: / }).first();
  await expect(chip).toBeVisible();
  await expect(page.getByText(/We searched for/)).toBeVisible();
  await chip.click();
  await expect(page).toHaveURL(/\/shop\?q=helm$/);
  await expect(page.getByRole("link", { name: /^Remove filter Country: / })).toHaveCount(0);

  await page.goto("/shop?q=duitse+helm");
  await page.getByRole("link", { name: "Search the words literally instead" }).click();
  await expect(page).toHaveURL(/literal=1/);
  await expect(page.getByText(/Searched literally for/)).toBeVisible();
  await page.reload(); // metadata of a fresh load: search variants stay noindex
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
});

test("results page: zero results offer help", async ({ page }) => {
  // An explicit price bound no item reaches: empty with or without the language model.
  await page.goto("/shop?q=helm&min=9000000");
  await expect(page.getByRole("heading", { name: /Nothing found for/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Browse a category" })).toBeVisible();
});

test("photo search dialog opens and closes", async ({ page }) => {
  await page.goto("/shop?q=helm");
  await page.getByRole("button", { name: "Search by photo" }).last().click();
  const dialog = page.getByRole("dialog", { name: "Search by photo" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Choose photo" })).toBeVisible();
  await expect(dialog.getByText("Your photo is not stored.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("product page: 'Looks like this' rail renders similar items", async ({ page }) => {
  await page.goto("/shop");
  const hrefs = [...new Set(await page.locator('main a[href^="/product/"]').evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? "")))].slice(0, 4);
  let found = false;
  for (const href of hrefs) {
    await page.goto(href);
    const rail = page.getByTestId("similar-rail");
    if ((await rail.count()) === 0) continue;
    await expect(rail.getByRole("heading", { name: "Looks like this" })).toBeVisible();
    expect(await rail.locator('a[href^="/product/"]').count()).toBeGreaterThanOrEqual(3);
    found = true;
    break;
  }
  expect(found, "no product page showed the similar rail (are product vectors indexed?)").toBe(true);
});

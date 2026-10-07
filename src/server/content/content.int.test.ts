import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { ServiceError, type ServiceContext } from "@/server/context";
import { createTenantContext, resetDb } from "../../../tests/integration/helpers";
import {
  addBlock,
  createPage,
  deletePage,
  duplicatePage,
  ensureSystemPages,
  getHomePage,
  getPage,
  getPublishedPageBySlug,
  listPages,
  moveBlock,
  removeBlock,
  updateBlock,
  updatePage,
} from "./pages";
import { createMenuItem, deleteMenuItem, getPublicMenu, listMenu, reorderMenuItems, updateMenuItem } from "./menus";

async function expectError(p: Promise<unknown>, code: ServiceError["code"]) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ServiceError);
  expect((err as ServiceError).code).toBe(code);
  return err as ServiceError;
}

async function blockTypes(ctx: ServiceContext, pageId: string) {
  const page = await getPage(ctx, pageId);
  expect(page.blocks.map((b) => b.sortOrder)).toEqual(page.blocks.map((_, i) => i));
  return page.blocks.map((b) => b.type);
}

describe("content pages", () => {
  let ctx: ServiceContext;
  beforeEach(async () => {
    await resetDb();
    ctx = await createTenantContext();
  });

  it("creates pages with derived, unique slugs and blocks reserved/duplicate slugs", async () => {
    const a = await createPage(ctx, { title: "Opening hours" });
    expect(a.slug).toBe("opening-hours");
    expect(a.publishedAt).toBeNull();
    const b = await createPage(ctx, { title: "Opening hours" });
    expect(b.slug).toBe("opening-hours-2");
    await expectError(createPage(ctx, { title: "X", slug: "opening-hours" }), "CONFLICT");
    for (const slug of ["admin", "api", "uploads", "product", "shop", "cart", "checkout", "account", "Checkout"]) {
      await expectError(createPage(ctx, { title: "X", slug }), "INVALID");
    }
    const c = await createPage(ctx, { title: "Shop" }); // derived slug avoids reserved words
    expect(c.slug).toBe("shop-page");
    await expectError(updatePage(ctx, a.id, { slug: "admin" }), "INVALID");
    await expectError(updatePage(ctx, a.id, { slug: b.slug }), "CONFLICT");
    expect((await updatePage(ctx, a.id, { slug: "Hours & Days" })).slug).toBe("hours-and-days");
    await expectError(createPage(ctx, { title: "" }), "INVALID");
  });

  it("allows the same slug in another tenant and isolates tenants", async () => {
    const other = await createTenantContext();
    const mine = await createPage(ctx, { title: "About", slug: "story", published: true });
    const theirs = await createPage(other, { title: "About", slug: "story", published: true });
    expect(theirs.slug).toBe("story");
    await expectError(getPage(other, mine.id), "NOT_FOUND");
    await expectError(updatePage(other, mine.id, { title: "x" }), "NOT_FOUND");
    await expectError(deletePage(other, mine.id), "NOT_FOUND");
    await expectError(addBlock(other, mine.id, { type: "TEXT" }), "NOT_FOUND");
    const block = await addBlock(ctx, mine.id, { type: "TEXT" });
    await expectError(updateBlock(other, block.id, { isVisible: false }), "NOT_FOUND");
    await expectError(moveBlock(other, block.id, 0), "NOT_FOUND");
    await expectError(removeBlock(other, block.id), "NOT_FOUND");
    expect((await listPages(other)).map((p) => p.id)).toEqual([theirs.id]);
    expect((await getPublishedPageBySlug(other.tenantId, "story"))?.id).toBe(theirs.id);
  });

  it("publishes, updates SEO and duplicates with blocks", async () => {
    const page = await createPage(ctx, { title: "Events" });
    await addBlock(ctx, page.id, { type: "HERO" });
    await addBlock(ctx, page.id, { type: "TEXT", data: { markdown: "Hello" } });
    expect(await getPublishedPageBySlug(ctx.tenantId, "events")).toBeNull();
    const pub = await updatePage(ctx, page.id, { published: true, seoTitle: "Events", seoDescription: "" });
    expect(pub.publishedAt).toBeInstanceOf(Date);
    expect(pub.seoDescription).toBeNull();
    const again = await updatePage(ctx, page.id, { published: true });
    expect(again.publishedAt).toEqual(pub.publishedAt);

    const copy = await duplicatePage(ctx, page.id);
    expect(copy).toMatchObject({ title: "Events (copy)", slug: "events-copy", publishedAt: null, systemKey: null });
    expect(await blockTypes(ctx, copy.id)).toEqual(["HERO", "TEXT"]);
    expect((await duplicatePage(ctx, page.id)).slug).toBe("events-copy-2");

    const pub2 = await getPublishedPageBySlug(ctx.tenantId, "EVENTS");
    expect(pub2?.blocks.map((b) => b.type)).toEqual(["HERO", "TEXT"]);
    await updatePage(ctx, page.id, { published: false });
    expect(await getPublishedPageBySlug(ctx.tenantId, "events")).toBeNull();
  });

  it("keeps block order consistent on add/move/remove and enforces the hero rule", async () => {
    const page = await createPage(ctx, { title: "Blocks" });
    const t1 = await addBlock(ctx, page.id, { type: "TEXT" });
    const q = await addBlock(ctx, page.id, { type: "QUOTE" });
    const g = await addBlock(ctx, page.id, { type: "GALLERY", afterId: t1.id });
    expect(await blockTypes(ctx, page.id)).toEqual(["TEXT", "GALLERY", "QUOTE"]);
    await addBlock(ctx, page.id, { type: "CTA", afterId: null });
    expect(await blockTypes(ctx, page.id)).toEqual(["CTA", "TEXT", "GALLERY", "QUOTE"]);

    const hero = await addBlock(ctx, page.id, { type: "HERO", afterId: q.id });
    expect(hero.sortOrder).toBe(0);
    expect(await blockTypes(ctx, page.id)).toEqual(["HERO", "CTA", "TEXT", "GALLERY", "QUOTE"]);
    await expectError(addBlock(ctx, page.id, { type: "HERO" }), "CONFLICT");
    await addBlock(ctx, page.id, { type: "TEXT_HORIZONTAL", afterId: null }); // never above the hero
    expect(await blockTypes(ctx, page.id)).toEqual(["HERO", "TEXT_HORIZONTAL", "CTA", "TEXT", "GALLERY", "QUOTE"]);

    await expectError(moveBlock(ctx, hero.id, 2), "INVALID");
    await expectError(moveBlock(ctx, q.id, 0), "INVALID");
    await moveBlock(ctx, q.id, 1);
    expect(await blockTypes(ctx, page.id)).toEqual(["HERO", "QUOTE", "TEXT_HORIZONTAL", "CTA", "TEXT", "GALLERY"]);
    await moveBlock(ctx, q.id, 99); // clamped to the end
    expect(await blockTypes(ctx, page.id)).toEqual(["HERO", "TEXT_HORIZONTAL", "CTA", "TEXT", "GALLERY", "QUOTE"]);

    await removeBlock(ctx, g.id);
    await removeBlock(ctx, hero.id);
    expect(await blockTypes(ctx, page.id)).toEqual(["TEXT_HORIZONTAL", "CTA", "TEXT", "QUOTE"]);
    await expectError(addBlock(ctx, page.id, { type: "TEXT", afterId: "nope" }), "NOT_FOUND");
  });

  it("serialises concurrent block inserts", async () => {
    const page = await createPage(ctx, { title: "Race" });
    await Promise.all(Array.from({ length: 6 }, () => addBlock(ctx, page.id, { type: "TEXT" })));
    const types = await blockTypes(ctx, page.id); // also asserts sortOrder 0..n-1
    expect(types).toHaveLength(6);
  });

  it("validates block data and references on add/update", async () => {
    const other = await createTenantContext();
    const page = await createPage(ctx, { title: "Refs" });
    await expectError(addBlock(ctx, page.id, { type: "CTA", data: { title: "x", buttonLabel: "Go", href: "javascript:alert(1)" } }), "INVALID");
    await expectError(addBlock(ctx, page.id, { type: "NEW_ITEMS", data: { count: 30 } }), "INVALID");
    await expectError(addBlock(ctx, page.id, { type: "GALLERY", data: { imageKeys: [`${other.tenantId}/content/a.jpg`] } }), "INVALID");
    const gal = await addBlock(ctx, page.id, { type: "GALLERY", data: { imageKeys: [`${ctx.tenantId}/content/a.jpg`] } });
    expect(gal.data).toEqual({ title: "", imageKeys: [`${ctx.tenantId}/content/a.jpg`] });

    const theirProduct = await db.product.create({ data: { tenantId: other.tenantId, stockCode: 1, slug: "p", title: "P", price: 100 } });
    const myProduct = await db.product.create({ data: { tenantId: ctx.tenantId, stockCode: 1, slug: "p", title: "P", price: 100 } });
    const tp = await addBlock(ctx, page.id, { type: "TEXT_PRODUCT" });
    await expectError(updateBlock(ctx, tp.id, { data: { productId: theirProduct.id } }), "INVALID");
    const updated = await updateBlock(ctx, tp.id, { data: { markdown: "x", productId: myProduct.id }, isVisible: false });
    expect(updated).toMatchObject({ type: "TEXT_PRODUCT", isVisible: false, data: { productId: myProduct.id, markdown: "x" } });

    const theirCat = await db.category.create({ data: { tenantId: other.tenantId, title: "C", slug: "c" } });
    await expectError(addBlock(ctx, page.id, { type: "CATEGORIES", data: { categoryIds: [theirCat.id] } }), "INVALID");
    await expectError(addBlock(ctx, page.id, { type: "NOPE" as never }), "INVALID");
  });

  it("requires the newsletter feature for NEWSLETTER_SIGNUP blocks", async () => {
    const page = await createPage(ctx, { title: "N" });
    await expectError(addBlock(ctx, page.id, { type: "NEWSLETTER_SIGNUP" }), "FORBIDDEN");
    await db.setting.create({ data: { tenantId: ctx.tenantId, group: "platform", data: { newsletterEnabled: true } } });
    expect((await addBlock(ctx, page.id, { type: "NEWSLETTER_SIGNUP" })).type).toBe("NEWSLETTER_SIGNUP");
  });

  it("skips invalid stored blocks and hidden blocks on the public read", async () => {
    const page = await createPage(ctx, { title: "Public", published: true });
    const good = await addBlock(ctx, page.id, { type: "TEXT", data: { markdown: "ok" } });
    const hidden = await addBlock(ctx, page.id, { type: "QUOTE" });
    await updateBlock(ctx, hidden.id, { isVisible: false });
    const bad = await addBlock(ctx, page.id, { type: "CTA" });
    await db.contentBlock.update({ where: { id: bad.id }, data: { data: { title: "x", buttonLabel: "Go", href: "javascript:alert(1)" } } });
    const pub = await getPublishedPageBySlug(ctx.tenantId, "public");
    expect(pub?.blocks.map((b) => b.id)).toEqual([good.id]);
    const admin = await getPage(ctx, page.id);
    expect(admin.blocks.find((b) => b.id === bad.id)).toMatchObject({ valid: false });
  });
});

describe("system pages", () => {
  let ctx: ServiceContext;
  beforeEach(async () => {
    await resetDb();
    ctx = await createTenantContext();
  });

  it("ensureSystemPages is idempotent and creates unpublished drafts with starter blocks", async () => {
    await createPage(ctx, { title: "Old terms", slug: "terms" });
    const created = await ensureSystemPages(ctx.tenantId);
    expect(created.sort()).toEqual(["ABOUT", "CONTACT", "HOME", "PRIVACY", "TERMS"]);
    expect(await ensureSystemPages(ctx.tenantId)).toEqual([]);
    const pages = await listPages(ctx);
    expect(pages.slice(0, 5).map((p) => p.systemKey)).toEqual(["HOME", "TERMS", "PRIVACY", "CONTACT", "ABOUT"]);
    expect(pages.find((p) => p.systemKey === "TERMS")?.slug).toBe("terms-2");
    expect(pages.filter((p) => p.systemKey).every((p) => p.publishedAt === null && p.blockCount > 0)).toBe(true);
    await Promise.all([ensureSystemPages(ctx.tenantId), ensureSystemPages(ctx.tenantId)]);
    expect(await db.contentPage.count({ where: { tenantId: ctx.tenantId } })).toBe(6);

    expect(await getHomePage(ctx.tenantId)).toBeNull();
    const home = pages.find((p) => p.systemKey === "HOME")!;
    await updatePage(ctx, home.id, { published: true });
    const pub = await getHomePage(ctx.tenantId);
    expect(pub?.blocks[0].type).toBe("HERO");
  });

  it("protects system pages", async () => {
    await ensureSystemPages(ctx.tenantId);
    const pages = await listPages(ctx);
    const home = pages.find((p) => p.systemKey === "HOME")!;
    const terms = pages.find((p) => p.systemKey === "TERMS")!;
    await expectError(deletePage(ctx, home.id), "CONFLICT");
    await expectError(deletePage(ctx, terms.id), "CONFLICT");
    await expectError(updatePage(ctx, home.id, { slug: "start" }), "INVALID");
    await expectError(updatePage(ctx, terms.id, { systemKey: null }), "INVALID");
    await expectError(updatePage(ctx, terms.id, { systemKey: "PRIVACY" }), "INVALID");
    expect((await updatePage(ctx, terms.id, { slug: "conditions", title: "Conditions" })).slug).toBe("conditions");

    // Move the TERMS role to a new page; the old one becomes a regular, deletable page.
    const fresh = await createPage(ctx, { title: "New terms" });
    expect((await updatePage(ctx, fresh.id, { systemKey: "TERMS" })).systemKey).toBe("TERMS");
    expect((await getPage(ctx, terms.id)).systemKey).toBeNull();
    await deletePage(ctx, terms.id);
    await expectError(updatePage(ctx, fresh.id, { systemKey: "BOGUS" as never }), "INVALID");

    const copy = await duplicatePage(ctx, home.id);
    expect(copy.systemKey).toBeNull();
  });
});

describe("menus", () => {
  let ctx: ServiceContext;
  beforeEach(async () => {
    await resetDb();
    ctx = await createTenantContext();
  });

  it("enforces 7 header items and 4 footer columns", async () => {
    for (let i = 0; i < 7; i++) await createMenuItem(ctx, { location: "HEADER", label: `H${i}`, target: { kind: "route", route: "shop" } });
    const err = await expectError(createMenuItem(ctx, { location: "HEADER", label: "H8", target: { kind: "route", route: "shop" } }), "CONFLICT");
    expect(err.message).toMatch(/at most 7/);
    for (let i = 0; i < 4; i++) await createMenuItem(ctx, { location: "FOOTER", label: `F${i}` });
    await expectError(createMenuItem(ctx, { location: "FOOTER", label: "F5" }), "CONFLICT");
    // Sub-items do not count towards the root limit.
    const [root] = await listMenu(ctx, "HEADER");
    await createMenuItem(ctx, { location: "HEADER", label: "Sub", parentId: root.id, target: { kind: "url", url: "/shop?tag=helmets" } });
    expect((await listMenu(ctx, "HEADER"))[0].children).toHaveLength(1);
    // Other tenants have their own limits.
    const other = await createTenantContext();
    await createMenuItem(other, { location: "FOOTER", label: "F" });
  });

  it("validates targets and nesting", async () => {
    const other = await createTenantContext();
    const theirPage = await createPage(other, { title: "Theirs" });
    await expectError(createMenuItem(ctx, { location: "HEADER", label: "x" }), "INVALID"); // header needs a link
    await expectError(createMenuItem(ctx, { location: "HEADER", label: "x", target: { kind: "url", url: "javascript:alert(1)" } }), "INVALID");
    await expectError(createMenuItem(ctx, { location: "HEADER", label: "x", target: { kind: "url", url: "qm:route:shop" } }), "INVALID");
    await expectError(createMenuItem(ctx, { location: "HEADER", label: "x", target: { kind: "page", pageId: theirPage.id } }), "INVALID");
    await expectError(createMenuItem(ctx, { location: "HEADER", label: "x", target: { kind: "route", route: "admin" as never } }), "INVALID");

    const col = await createMenuItem(ctx, { location: "FOOTER", label: "Info" });
    expect(col.target).toBeNull();
    await expectError(createMenuItem(ctx, { location: "FOOTER", label: "x", parentId: col.id }), "INVALID"); // sub-item needs a link
    const sub = await createMenuItem(ctx, { location: "FOOTER", label: "Mail", parentId: col.id, target: { kind: "url", url: "mailto:a@b.nl" } });
    await expectError(createMenuItem(ctx, { location: "FOOTER", label: "x", parentId: sub.id, target: { kind: "route", route: "cart" } }), "INVALID");
    await expectError(createMenuItem(ctx, { location: "HEADER", label: "x", parentId: col.id, target: { kind: "route", route: "cart" } }), "INVALID");
    await expectError(createMenuItem(other, { location: "FOOTER", label: "x", parentId: col.id, target: { kind: "route", route: "cart" } }), "NOT_FOUND");
    await expectError(updateMenuItem(ctx, sub.id, { target: null }), "INVALID");
    await expectError(updateMenuItem(other, sub.id, { label: "hacked" }), "NOT_FOUND");
    await expectError(deleteMenuItem(other, sub.id), "NOT_FOUND");
  });

  it("reorders, deletes with renumbering and resolves public hrefs", async () => {
    const page = await createPage(ctx, { title: "Visit us", published: true });
    const draft = await createPage(ctx, { title: "Draft" });
    const cat = await db.category.create({ data: { tenantId: ctx.tenantId, title: "Helmets", slug: "helmets" } });
    const a = await createMenuItem(ctx, { location: "HEADER", label: "Shop", target: { kind: "route", route: "shop" } });
    const b = await createMenuItem(ctx, { location: "HEADER", label: "Helmets", target: { kind: "category", categoryId: cat.id } });
    const c = await createMenuItem(ctx, { location: "HEADER", label: "Visit", target: { kind: "page", pageId: page.id } });
    const d = await createMenuItem(ctx, { location: "HEADER", label: "Draft", target: { kind: "page", pageId: draft.id } });
    const e = await createMenuItem(ctx, { location: "HEADER", label: "Ext", target: { kind: "url", url: "https://example.com" } });

    await expectError(reorderMenuItems(ctx, "HEADER", null, [a.id, b.id]), "INVALID");
    await reorderMenuItems(ctx, "HEADER", null, [e.id, d.id, c.id, b.id, a.id]);
    expect((await listMenu(ctx, "HEADER")).map((m) => m.label)).toEqual(["Ext", "Draft", "Visit", "Helmets", "Shop"]);
    expect((await listMenu(ctx, "HEADER"))[3].target).toEqual({ kind: "category", categoryId: cat.id });

    const pub = await getPublicMenu(ctx.tenantId, "HEADER");
    expect(pub.map((m) => [m.label, m.href, m.external])).toEqual([
      ["Ext", "https://example.com", true],
      ["Visit", "/visit-us", false],
      ["Helmets", "/shop/category/helmets", false],
      ["Shop", "/shop", false],
    ]);

    await deleteMenuItem(ctx, d.id);
    expect((await listMenu(ctx, "HEADER")).map((m) => m.sortOrder)).toEqual([0, 1, 2, 3]);

    // Deleting a page removes menu links to it.
    await deletePage(ctx, page.id);
    expect((await listMenu(ctx, "HEADER")).map((m) => m.label)).toEqual(["Ext", "Helmets", "Shop"]);
    expect(await getPublicMenu((await createTenantContext()).tenantId, "HEADER")).toEqual([]);
  });
});

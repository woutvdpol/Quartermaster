import "server-only";
import { getHomePage, getPublishedPageBySlug, type PublicBlock, type PublicPage } from "@/server/content/pages";
import { getPublicMenu, type PublicMenuItem } from "@/server/content/menus";
import { contentPageHref } from "@/server/content/rules";
import { db } from "@/server/db";
import { shopCache } from "./cache";

/** A published CMS page as the shop renders it (cache-safe: dates as ISO strings). */
export type StorefrontPage = Omit<PublicPage, "updatedAt"> & { updatedAt: string; href: string };
export type { PublicBlock, PublicMenuItem };

function toStorefront(page: PublicPage | null): StorefrontPage | null {
  if (!page) return null;
  return { ...page, updatedAt: page.updatedAt.toISOString(), href: contentPageHref(page) };
}

export const getStorefrontHomePage = shopCache("home-page", "content", async (tenantId: string) => toStorefront(await getHomePage(tenantId)));

export const getStorefrontPage = shopCache("page-by-slug", "content", async (tenantId: string, slug: string) =>
  toStorefront(await getPublishedPageBySlug(tenantId, slug)),
);

export type ShopMenus = { header: PublicMenuItem[]; footer: PublicMenuItem[] };

/** Header and footer menus with resolved hrefs (unpublished targets dropped). */
export const getPublicMenus = shopCache("menus", "content", async (tenantId: string): Promise<ShopMenus> => {
  const [header, footer] = await Promise.all([getPublicMenu(tenantId, "HEADER"), getPublicMenu(tenantId, "FOOTER")]);
  return { header, footer };
});

export type LegalLink = { key: string; label: string; href: string };

/** Published system pages for the footer's legal row (terms, privacy, contact). */
export const getLegalLinks = shopCache("legal-links", "content", async (tenantId: string): Promise<LegalLink[]> => {
  const now = new Date();
  const rows = await db.contentPage.findMany({
    where: { tenantId, systemKey: { in: ["TERMS", "PRIVACY", "CONTACT"] }, publishedAt: { not: null, lte: now } },
    select: { slug: true, title: true, systemKey: true },
  });
  const order = ["TERMS", "PRIVACY", "CONTACT"];
  return rows
    .sort((a, b) => order.indexOf(a.systemKey!) - order.indexOf(b.systemKey!))
    .map((r) => ({ key: r.systemKey!, label: r.title, href: contentPageHref(r) }));
});

/** Published regular + system pages (not HOME) for the sitemap. */
export async function listPublishedPagesForSitemap(tenantId: string) {
  const rows = await db.contentPage.findMany({
    where: { tenantId, publishedAt: { not: null, lte: new Date() }, NOT: { systemKey: "HOME" } },
    select: { slug: true, systemKey: true, updatedAt: true },
  });
  return rows.map((r) => ({ href: contentPageHref(r), updatedAt: r.updatedAt }));
}

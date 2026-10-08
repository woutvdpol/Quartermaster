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

/** Regular pages (no system role) that also belong in the legal row: the setup wizard creates these. */
export const SERVICE_PAGE_SLUGS = { RETURNS: "returns", SHIPPING: "shipping" } as const;
const LEGAL_ORDER = ["TERMS", "PRIVACY", "RETURNS", "SHIPPING", "CONTACT"];

/**
 * Published pages for the footer's legal row: terms, privacy, returns, shipping, contact. Returns and
 * shipping are regular pages found by slug (wizard templates). Use `withoutMenuDuplicates` so a page the
 * shop already links from its footer menu is not shown twice.
 */
export const getLegalLinks = shopCache("legal-links", "content", async (tenantId: string): Promise<LegalLink[]> => {
  const now = new Date();
  const rows = await db.contentPage.findMany({
    where: {
      tenantId,
      publishedAt: { not: null, lte: now },
      OR: [
        { systemKey: { in: ["TERMS", "PRIVACY", "CONTACT"] } },
        { systemKey: null, slug: { in: Object.values(SERVICE_PAGE_SLUGS) } },
      ],
    },
    select: { slug: true, title: true, systemKey: true },
  });
  const keyOf = (r: { slug: string; systemKey: string | null }) =>
    r.systemKey ?? (r.slug === SERVICE_PAGE_SLUGS.RETURNS ? "RETURNS" : "SHIPPING");
  return rows
    .map((r) => ({ key: keyOf(r), label: r.title, href: contentPageHref(r) }))
    .sort((a, b) => LEGAL_ORDER.indexOf(a.key) - LEGAL_ORDER.indexOf(b.key));
});

/**
 * Drops the returns/shipping links when the footer menu already links those pages (pure). The system
 * links (terms, privacy, contact) always stay, as they always have.
 */
export function withoutMenuDuplicates(links: LegalLink[], menu: PublicMenuItem[]): LegalLink[] {
  const hrefs = new Set<string>();
  const walk = (items: PublicMenuItem[]) => {
    for (const i of items) {
      if (i.href) hrefs.add(i.href);
      walk(i.children);
    }
  };
  walk(menu);
  return links.filter((l) => !((l.key === "RETURNS" || l.key === "SHIPPING") && hrefs.has(l.href)));
}

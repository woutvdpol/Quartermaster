import "server-only";
import { db } from "@/server/db";
import { shopCache } from "@/server/storefront/cache";
import { getStorefrontPage } from "@/server/storefront/content";
import { toPublicImage } from "@/server/storefront-catalog/queries";
import type { PublicImage } from "@/server/storefront-catalog/types";
import { toShopImage } from "@/components/shop/catalog/to-card";
import type { LotCardImage } from "./LotCard";

/*
 * Read helpers for the shop's auction pages that the engine's public API (src/server/auctions) does
 * not cover: shop chrome (nav link, terms link) and presentation extras per lot (photo, category) and
 * per viewer (bidder number, lots bid on). Read-only; tenant-scoped like every shop read.
 */

/** Shop paths. */
export const AUCTIONS_PATH = "/auctions";
export const auctionHref = (slug: string) => `${AUCTIONS_PATH}/${slug}`;
export const lotHref = (slug: string, lotNumber: number) => `${AUCTIONS_PATH}/${slug}/lot/${lotNumber}`;
/** Built-in terms page (placeholder) — used while the shop has no CMS page with this slug. */
export const AUCTION_TERMS_SLUG = "auction-terms";
export const BUILTIN_TERMS_PATH = `${AUCTIONS_PATH}/terms`;

/**
 * Header/footer "Auctions" link: only while at least one auction is PUBLISHED or LIVE. Cached with the
 * catalog (60 s TTL; a publish that audits as `auction.*` should also revalidate the catalog tag).
 */
export const hasVisibleAuctions = shopCache(
  "auctions-visible",
  "catalog",
  async (tenantId: string): Promise<boolean> =>
    (await db.auction.count({ where: { tenantId, status: { in: ["PUBLISHED", "LIVE"] } } })) > 0,
);

/** The terms link: the shop's own CMS page `auction-terms` when published, else the built-in placeholder. */
export async function auctionTermsHref(tenantId: string): Promise<string> {
  const page = await getStorefrontPage(tenantId, AUCTION_TERMS_SLUG).catch(() => null);
  return page ? page.href : BUILTIN_TERMS_PATH;
}

export type LotExtra = { cover: PublicImage | null; blurred: boolean; category: { title: string; slug: string } | null };

/** Cover photo, sensitivity flag and category per product (lot cards, category chips). Cached with the catalog. */
export const lotExtras = shopCache(
  "auction-lot-extras",
  "catalog",
  async (tenantId: string, productIds: string[]): Promise<Record<string, LotExtra>> => {
    if (!productIds.length) return {};
    const rows = await db.product.findMany({
      where: { tenantId, id: { in: productIds.slice(0, 1000) } },
      select: {
        id: true,
        blurred: true,
        category: { select: { title: true, slug: true } },
        images: {
          select: { id: true, storageKey: true, variants: true, alt: true, width: true, height: true },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          take: 1,
        },
      },
    });
    return Object.fromEntries(
      rows.map((r) => [r.id, { cover: r.images[0] ? toPublicImage(r.images[0]) : null, blurred: r.blurred, category: r.category }]),
    );
  },
);

export type ViewerAuction = { bidderNumber: number | null; termsAccepted: boolean; bidLotIds: string[] };

/** The signed-in customer in one auction: bidder number, terms accepted, lots they bid on (not voided). Never cached. */
export async function viewerInAuction(tenantId: string, auctionId: string, customerId: string): Promise<ViewerAuction> {
  const [bidder, bids] = await Promise.all([
    db.auctionBidder.findUnique({ where: { auctionId_customerId: { auctionId, customerId } }, select: { number: true, tenantId: true, termsAcceptedAt: true } }),
    db.bid.findMany({
      where: { tenantId, customerId, voidedAt: null, lot: { auctionId } },
      select: { lotId: true },
      distinct: ["lotId"],
    }),
  ]);
  const own = bidder && bidder.tenantId === tenantId ? bidder : null;
  return { bidderNumber: own?.number ?? null, termsAccepted: Boolean(own?.termsAcceptedAt), bidLotIds: bids.map((b) => b.lotId) };
}

/** Product ids on the customer's wishlist among `productIds` ("Watching" filter). */
export async function watchedProductIds(tenantId: string, customerId: string, productIds: string[]): Promise<string[]> {
  if (!productIds.length) return [];
  const rows = await db.wishlistItem.findMany({
    where: { tenantId, customerId, productId: { in: productIds.slice(0, 1000) } },
    select: { productId: true },
  });
  return rows.map((r) => r.productId);
}

/** Slugs of the given auctions (single-lot links on the overview). */
export async function auctionSlugs(tenantId: string, auctionIds: string[]): Promise<Record<string, string>> {
  if (!auctionIds.length) return {};
  const rows = await db.auction.findMany({ where: { tenantId, id: { in: [...new Set(auctionIds)].slice(0, 500) } }, select: { id: true, slug: true } });
  return Object.fromEntries(rows.map((r) => [r.id, r.slug]));
}

/**
 * Card image of a lot with the shop's visibility rules: sensitive items are locked for guests when the
 * shop blurs them (no real URL is sent), a country rule that blurs photos sends only the tiny blur variant.
 */
export function lotCardImage(extra: LotExtra | undefined, title: string, opts: { lockSensitive: boolean; geoBlurred: boolean }): LotCardImage {
  const cover = extra?.cover ?? null;
  if (!cover) return { image: null, locked: false };
  if (extra?.blurred && opts.lockSensitive) return { image: { src: "", blurDataUrl: cover.blurDataUrl, alt: "" }, locked: true };
  if (opts.geoBlurred) return { image: { src: cover.blur, blurDataUrl: cover.blurDataUrl, alt: "", width: cover.width, height: cover.height }, locked: false };
  return { image: toShopImage(cover, title), locked: false };
}

/** Cover of each auction: its first lot's photo (overview cards). Cached with the catalog. */
export const auctionCovers = shopCache(
  "auction-covers",
  "catalog",
  async (tenantId: string, auctionIds: string[]): Promise<Record<string, LotExtra>> => {
    if (!auctionIds.length) return {};
    const rows = await db.auctionLot.findMany({
      where: { tenantId, auctionId: { in: auctionIds.slice(0, 200) }, status: { not: "CANCELLED" } },
      orderBy: [{ auctionId: "asc" }, { lotNumber: "asc" }],
      distinct: ["auctionId"],
      select: { auctionId: true, productId: true },
    });
    const extras = await lotExtras(tenantId, rows.map((r) => r.productId));
    return Object.fromEntries(rows.map((r) => [r.auctionId, extras[r.productId]]).filter(([, e]) => e));
  },
);

/** Sitemap entries: the overview and every published/live auction (lot pages are short-lived; not listed). */
export async function sitemapAuctionEntries(tenantId: string): Promise<{ path: string; lastmod: string | null }[]> {
  const rows = await db.auction.findMany({
    where: { tenantId, status: { in: ["PUBLISHED", "LIVE"] } },
    orderBy: { firstCloseAt: "asc" },
    select: { slug: true, updatedAt: true },
    take: 200,
  });
  if (!rows.length) return [];
  return [{ path: AUCTIONS_PATH, lastmod: null }, ...rows.map((r) => ({ path: auctionHref(r.slug), lastmod: r.updatedAt.toISOString() }))];
}

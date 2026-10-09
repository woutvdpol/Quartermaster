import { translatedProductTitles } from "@/server/storefront/translate";
import type { Metadata } from "next";
import { Suspense } from "react";
import { accountCopies } from "@/components/shop/account/_copy";
import { shopCopy } from "@/server/i18n/locale";
import { AccountShell } from "@/components/shop/account/AccountShell";
import { formatDate } from "@/components/shop/account/format";
import { WishlistButton } from "@/components/shop/account/WishlistButton";
import { ButtonLink } from "@/components/shop/ui/Button";
import { EmptyState } from "@/components/shop/ui/EmptyState";
import { ProductGrid } from "@/components/shop/ui/ProductGrid";
import type { ProductCardData } from "@/components/shop/ui/types";
import { ProductGridSkeleton } from "@/components/shop/ui/Skeleton";
import { requireShopCustomer } from "@/server/customer-auth";
import { requireShop } from "@/server/storefront/context";
import { listWishlist } from "@/server/wishlist";

export async function generateMetadata(): Promise<Metadata> {
  const t = (await shopCopy(accountCopies)).wishlist;
  return { title: t.title, robots: { index: false, follow: false } };
}

export default async function WishlistPage() {
  const t = (await shopCopy(accountCopies)).wishlist;
  return (
    <AccountShell active="wishlist" title={t.title}>
      <p className="-mt-3 mb-8 text-shop-ink-2 sm:-mt-5">{t.intro}</p>
      <Suspense fallback={<ProductGridSkeleton count={6} columns={3} />}>
        <Wishlist />
      </Suspense>
    </AccountShell>
  );
}

async function Wishlist() {
  const c = await requireShopCustomer("/wishlist");
  const items = await listWishlist({ tenantId: c.tenant.id, customerId: c.customer.id });
  const t = (await shopCopy(accountCopies)).wishlist;
  if (!items.length) {
    return (
      <EmptyState
        title={t.empty}
        action={
          <ButtonLink href="/" variant="primary">
            {t.browse}
          </ButtonLink>
        }
      >
        {t.emptyHint}
      </EmptyState>
    );
  }
  const shop = await requireShop();
  // Titles in the shop language (approved translations; docs/i18n.md).
  const titles = await translatedProductTitles(shop.tenant.id, shop.locale, items.map((it) => it.productId));
  const products: ProductCardData[] = items.map((it) => ({
    id: it.productId,
    stockCode: it.stockCode,
    title: titles.get(it.productId) ?? it.title,
    href: `/product/${it.stockCode}/${it.slug}`,
    priceCents: it.price,
    currency: c.tenant.currency,
    availability: it.availability,
    showPrice: it.availability !== "sold",
    onSale: it.onSale,
    // Signed-in customers always see the real image.
    locked: false,
    image: it.image ? { src: it.image.url, blurDataUrl: null, alt: it.image.alt ?? it.title, width: it.image.width, height: it.image.height } : null,
    eyebrow: `${t.addedOn} ${formatDate(it.addedAt, c.tenant.timezone, shop.locale)}`,
  }));
  return (
    <ProductGrid
      products={products}
      columns={3}
      locale={shop.locale}
      showStockCode={shop.settings.catalog.showStockCode}
      wishlistSlot={(p) => <WishlistButton productId={p.id} />}
      headingLevel={2}
    />
  );
}

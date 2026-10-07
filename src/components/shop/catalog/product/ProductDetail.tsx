import Link from "next/link";
import { Suspense } from "react";
import { Badge, Breadcrumbs, Container, LockedImg, Markdown, Price, ProductGrid, SectionHeading } from "@/components/shop/ui";
import { WishlistButton } from "@/components/shop/account/WishlistButton";
import type { ShopContext } from "@/server/storefront/context";
import { getShopViewer } from "@/server/storefront/viewer";
import { SHOP_PATH, categoryHref, getRelated, groupTags, liveReservedIds, tagHref, withLiveStatus } from "@/server/storefront-catalog";
import type { PublicProduct, PublicStatus } from "@/server/storefront-catalog/types";
import { toCardData } from "../to-card";
import { catalogCopy as copy } from "../_copy";
import { LockedPanel } from "./LockedPanel";
import { ProductBuyBox } from "./ProductBuyBox";
import { ProductGallery } from "./ProductGallery";
import { ShippingHint } from "./ShippingHint";

/**
 * Product page body (design "Productpagina"): gallery left, info right on desktop; gallery on top on
 * phones. Sensitive items for guests render only a blurred cover, the title and a login panel.
 */
export function ProductDetail({ shop, product, status, locked }: { shop: ShopContext; product: PublicProduct; status: PublicStatus; locked: boolean }) {
  const { catalog, legal, checkout, general } = shop.settings;
  const currency = shop.tenant.currency;
  const showPrice = status !== "sold" || catalog.showPriceWhenSold;
  const crumbs = [
    { label: copy.shop.title, href: SHOP_PATH },
    ...product.categoryPath.map((c) => ({ label: c.title, href: categoryHref(c.slug) })),
    { label: product.title },
  ];
  const tagGroups = groupTags(product.tags);
  const eyebrowTags = tagGroups.filter((g) => g.key !== "other").flatMap((g) => g.tags.map((t) => t.label)).slice(0, 3);
  const eyebrow = [...eyebrowTags, product.categoryPath.at(-1)?.title, copy.product.stockCode(product.stockCode)].filter(Boolean).join(" · ");

  return (
    <Container className="py-6 sm:py-10">
      <Breadcrumbs items={crumbs} jsonLdBase={shop.origin} />

      <div className="mt-5 grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:gap-12">
        <div className="min-w-0">
          {locked ? (
            <div className="relative aspect-[4/3] overflow-hidden rounded-shop bg-shop-sunken">
              <LockedImg blurDataUrl={product.images[0]?.blurDataUrl ?? null} />
            </div>
          ) : (
            <ProductGallery images={product.images} title={product.title} />
          )}
        </div>

        <div className="min-w-0">
          <p className="font-mono text-[0.72rem] tracking-[0.08em] text-shop-muted uppercase">{eyebrow}</p>
          <h1 className="mt-2 text-3xl text-shop-ink sm:text-4xl">{product.title}</h1>

          {locked ? (
            <div className="mt-6">
              <LockedPanel returnTo={product.href} />
            </div>
          ) : (
            <>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                {showPrice ? <Price cents={product.price} currency={currency} size="xl" /> : null}
                <StatusBadge status={status} />
                {product.onSale && status !== "sold" ? <Badge tone="accent">{copy.product.sale}</Badge> : null}
              </div>

              {status === "reserved" ? (
                <p className="mt-4 rounded-shop-sm border border-shop-warn/30 bg-shop-warn-soft px-3 py-2.5 text-sm text-shop-warn">{copy.product.reservedHint}</p>
              ) : status === "sold" ? (
                <p className="mt-4 text-sm text-shop-muted">{copy.product.soldHint}</p>
              ) : null}

              {status !== "sold" ? (
                <div className="mt-6 flex flex-col gap-3">
                  <ProductBuyBox product={product} available={status === "available"} />
                  <Suspense fallback={<p className="h-5" aria-hidden="true" />}>
                    <ShippingHint
                      tenantId={shop.tenant.id}
                      currency={currency}
                      weightGrams={product.weightGrams}
                      price={product.price}
                      shopCountry={general.address.country}
                      freeShippingThreshold={checkout.freeShippingThresholdCents}
                    />
                  </Suspense>
                  {product.ageRestricted ? <p className="text-sm text-shop-muted">{copy.product.ageRestricted(legal.minimumAge)}</p> : null}
                </div>
              ) : (
                <div className="mt-6">
                  <WishlistButton productId={product.id} variant="full" />
                </div>
              )}

              {product.restrictedSymbols ? (
                <p role="note" className="mt-6 rounded-shop-sm border border-shop-line bg-shop-sunken px-3 py-2.5 text-sm text-shop-ink-2">
                  {copy.product.restrictedNotice}
                </p>
              ) : null}

              {product.specifications.length ? (
                <section className="mt-8 border-t border-shop-line pt-5" aria-labelledby="pd-specs">
                  <h2 id="pd-specs" className="mb-3 text-lg text-shop-ink">
                    {copy.product.specifications}
                  </h2>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
                    {product.specifications.map((s, i) => (
                      <div key={`${i}-${s.label}`} className="contents">
                        <dt className="text-shop-muted">{s.label}</dt>
                        <dd className="text-shop-ink">{s.value}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ) : null}

              <aside className="mt-6 grid grid-cols-[2.75rem_1fr] items-center gap-3 rounded-shop border border-dashed border-shop-line-strong bg-shop-surface p-3 text-sm" aria-label={copy.product.provenanceTitle}>
                <span className="grid size-11 place-items-center rounded-shop-sm bg-shop-sunken text-shop-muted" aria-hidden="true">
                  <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M10 2.5l6 2.5v4.5c0 3.8-2.6 6.6-6 8-3.4-1.4-6-4.2-6-8V5z" strokeLinejoin="round" />
                    <path d="M7.5 10l2 2 3.5-4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <div>
                  <p className="font-medium text-shop-ink">{copy.product.provenanceTitle}</p>
                  <p className="text-shop-muted">{copy.product.provenanceBody}</p>
                </div>
              </aside>
            </>
          )}
        </div>
      </div>

      {!locked ? (
        <>
          {product.description ? (
            <section className="mt-12 max-w-3xl" aria-labelledby="pd-desc">
              <h2 id="pd-desc" className="mb-4 text-2xl text-shop-ink">
                {copy.product.description}
              </h2>
              <Markdown source={product.description} />
            </section>
          ) : null}

          {catalog.showTags && product.tags.length ? (
            <section className="mt-8" aria-labelledby="pd-tags">
              <h2 id="pd-tags" className="sr-only">
                {copy.product.tags}
              </h2>
              <ul className="flex flex-wrap gap-2" role="list">
                {product.tags.map((t) => (
                  <li key={t.id}>
                    <Link href={tagHref(t.slug)} className="inline-flex h-8 items-center rounded-full border border-shop-line-strong bg-shop-surface px-3 text-sm text-shop-ink-2 hover:border-shop-ink hover:text-shop-ink">
                      {t.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {legal.disclaimers.product ? <p className="mt-8 max-w-3xl text-xs text-shop-muted">{legal.disclaimers.product}</p> : null}

          {status !== "available" ? (
            <section className="mt-10 flex flex-col items-start justify-between gap-3 rounded-shop border border-dashed border-shop-accent/50 bg-shop-surface p-4 sm:flex-row sm:items-center" aria-labelledby="pd-notify">
              <div>
                <h2 id="pd-notify" className="font-shop-body text-base font-semibold text-shop-ink">
                  {copy.product.notifyTitle}
                </h2>
                <p className="text-sm text-shop-muted">{copy.product.notifyBody}</p>
              </div>
              {/* TODO(phase 5): saved searches / "notify me" (docs/analysis/03 §9 #4). */}
              <button type="button" disabled title={copy.product.notifyComingSoon} className="inline-flex h-10 items-center rounded-shop-sm border border-shop-line-strong px-4 text-sm font-medium text-shop-ink opacity-60">
                {copy.product.notifyCta}
              </button>
            </section>
          ) : null}
        </>
      ) : null}

      <Suspense fallback={null}>
        <RelatedProducts shop={shop} product={product} />
      </Suspense>
    </Container>
  );
}

function StatusBadge({ status }: { status: PublicStatus }) {
  if (status === "sold") return <Badge tone="sold">{copy.product.status.sold}</Badge>;
  if (status === "reserved") return <Badge tone="reserved">{copy.product.status.reserved}</Badge>;
  return <Badge tone="ok">{copy.product.status.available}</Badge>;
}

async function RelatedProducts({ shop, product }: { shop: ShopContext; product: PublicProduct }) {
  const tenantId = shop.tenant.id;
  const related = await getRelated(tenantId, { id: product.id, relatedIds: product.relatedIds, categoryId: product.categoryId, tagIds: product.tags.map((t) => t.id) }, 4);
  if (!related.length) return null;
  const [reserved, viewer] = await Promise.all([liveReservedIds(tenantId, related.map((r) => r.id)), getShopViewer(tenantId)]);
  const cards = withLiveStatus(related, reserved).map((c) =>
    toCardData(c, {
      currency: shop.tenant.currency,
      showPriceWhenSold: shop.settings.catalog.showPriceWhenSold,
      lockSensitive: shop.settings.legal.blurSensitiveForGuests && !viewer,
    }),
  );
  return (
    <section className="mt-16 border-t border-shop-line pt-10" aria-labelledby="pd-related">
      <SectionHeading title={<span id="pd-related">{copy.product.related}</span>} />
      <ProductGrid products={cards} columns={4} showStockCode={shop.settings.catalog.showStockCode} headingLevel={3} wishlistSlot={(p) => <WishlistButton productId={p.id} />} />
    </section>
  );
}

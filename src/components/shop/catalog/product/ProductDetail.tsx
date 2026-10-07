import Link from "next/link";
import { Suspense } from "react";
import { Badge, Breadcrumbs, Container, LockedImg, Markdown, Price, ProductGrid, SectionHeading } from "@/components/shop/ui";
import { WishlistButton } from "@/components/shop/account/WishlistButton";
import { NotifyMeButton } from "@/components/shop/alerts";
import { ProvenanceBlock } from "@/components/shop/provenance/ProvenanceBlock";
import { RecentlyViewed, RecentlyViewedTracker } from "@/components/shop/recent";
import type { DisplayCurrency } from "@/components/shop/ui/types";
import type { ShopContext } from "@/server/storefront/context";
import { getShopViewer } from "@/server/storefront/viewer";
import { SHOP_PATH, categoryHref, facetValueHref, getRelated, liveReservedIds, tagHref, withLiveStatus } from "@/server/storefront-catalog";
import { resolveCompliance } from "@/server/compliance";
import { countryName } from "@/server/shipping/countries";
import type { PublicProduct, PublicStatus } from "@/server/storefront-catalog/types";
import { applyGeoBlur, toCardData } from "../to-card";
import { catalogCopy as copy } from "../_copy";
import { LockedPanel } from "./LockedPanel";
import { ProductBuyBox } from "./ProductBuyBox";
import { OfferButton } from "@/components/shop/offers/OfferButton";
import { ProductGallery } from "./ProductGallery";
import { ShippingHint } from "./ShippingHint";

/** Visitor-country compliance for this product (src/server/compliance); null/absent = nothing applies. */
export type ProductGeo = { country: string | null; blurred: boolean; noShipping: boolean };

const EYEBROW_KINDS = ["PERIOD", "COUNTRY", "BRANCH"];

/**
 * Product page body (design "Productpagina"): gallery left, info right on desktop; gallery on top on
 * phones. Sensitive items for guests render only a blurred cover, the title and a login panel.
 * `geo` applies the visitor-country rules: blurred photos and a "can't be shipped" notice.
 * `display` is the visitor's indicative display currency (cookie; loaded by the page, never cached).
 */
export function ProductDetail({
  shop,
  product,
  status,
  locked,
  geo = null,
  display = null,
}: {
  shop: ShopContext;
  product: PublicProduct;
  status: PublicStatus;
  locked: boolean;
  geo?: ProductGeo | null;
  display?: DisplayCurrency | null;
}) {
  const { catalog, legal, checkout, general } = shop.settings;
  const currency = shop.tenant.currency;
  const showPrice = status !== "sold" || catalog.showPriceWhenSold;
  const crumbs = [
    { label: copy.shop.title, href: SHOP_PATH },
    ...product.categoryPath.map((c) => ({ label: c.title, href: categoryHref(c.slug) })),
    { label: product.title },
  ];
  const eyebrowFacets = EYEBROW_KINDS.flatMap((kind) => product.facets.filter((f) => f.facet.kind === kind).map((f) => f.values[0]?.name)).filter(Boolean).slice(0, 3);
  const eyebrow = [...eyebrowFacets, product.categoryPath.at(-1)?.title, copy.product.stockCode(product.stockCode)].filter(Boolean).join(" · ");
  const geoBlurred = Boolean(geo?.blurred) && !locked;
  // Facet values are the structured truth: free-text spec rows with the same label are not repeated.
  const facetLabels = new Set(product.facets.map((f) => f.facet.name.trim().toLowerCase()));
  const specs = product.specifications.filter((s) => !facetLabels.has(s.label.trim().toLowerCase()));

  return (
    <Container className="py-6 sm:py-10">
      <RecentlyViewedTracker productId={product.id} />
      <Breadcrumbs items={crumbs} jsonLdBase={shop.origin} />

      <div className="mt-5 grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:gap-12">
        <div className="min-w-0">
          {locked ? (
            <div className="relative aspect-[4/3] overflow-hidden rounded-shop bg-shop-sunken">
              <LockedImg blurDataUrl={product.images[0]?.blurDataUrl ?? null} />
            </div>
          ) : geoBlurred ? (
            <figure>
              <div className="relative aspect-[4/3] overflow-hidden rounded-shop bg-shop-sunken">
                <LockedImg blurDataUrl={product.images[0]?.blurDataUrl ?? null} />
              </div>
              <figcaption className="mt-2 text-sm text-shop-muted">{copy.product.geoBlurred}</figcaption>
            </figure>
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
                {showPrice ? <Price cents={product.price} currency={currency} display={display} size="xl" /> : null}
                <StatusBadge status={status} />
                {product.onSale && status !== "sold" ? <Badge tone="accent">{copy.product.sale}</Badge> : null}
              </div>

              {status === "reserved" ? (
                <p className="mt-4 rounded-shop-sm border border-shop-warn/30 bg-shop-warn-soft px-3 py-2.5 text-sm text-shop-warn">{copy.product.reservedHint}</p>
              ) : status === "sold" ? (
                <p className="mt-4 text-sm text-shop-muted">{copy.product.soldHint}</p>
              ) : null}

              {geo?.noShipping && geo.country && status !== "sold" ? (
                <p role="note" className="mt-4 rounded-shop-sm border border-shop-warn/30 bg-shop-warn-soft px-3 py-2.5 text-sm text-shop-warn">
                  {copy.product.noShipping(countryName(geo.country))}
                </p>
              ) : null}

              {status !== "sold" ? (
                <div className="mt-6 flex flex-col gap-3">
                  <ProductBuyBox product={product} available={status === "available"} />
                  {status === "available" ? (
                    <Suspense fallback={null}>
                      <OfferButton productId={product.id} />
                    </Suspense>
                  ) : null}
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

              {specs.length || product.facets.length ? (
                <section className="mt-8 border-t border-shop-line pt-5" aria-labelledby="pd-specs">
                  <h2 id="pd-specs" className="mb-3 text-lg text-shop-ink">
                    {copy.product.specifications}
                  </h2>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
                    {product.facets.map((f) => (
                      <div key={f.facet.id} className="contents">
                        <dt className="text-shop-muted">{f.facet.name}</dt>
                        <dd className="text-shop-ink">
                          {f.values.map((v, i) => (
                            <span key={v.id}>
                              {i > 0 ? ", " : null}
                              {f.facet.isFilterable ? (
                                <Link href={facetValueHref(f.facet.slug, v.slug)} className="underline decoration-shop-line-strong underline-offset-4 hover:decoration-shop-ink">
                                  {v.path.join(" › ")}
                                </Link>
                              ) : (
                                v.path.join(" › ")
                              )}
                            </span>
                          ))}
                        </dd>
                      </div>
                    ))}
                    {specs.map((s, i) => (
                      <div key={`${i}-${s.label}`} className="contents">
                        <dt className="text-shop-muted">{s.label}</dt>
                        <dd className="text-shop-ink">{s.value}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ) : null}
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

          <Suspense fallback={null}>
            <ProvenanceBlock productId={product.id} />
          </Suspense>

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
              <NotifyMeButton productId={product.id} fullWidth={false} />
            </section>
          ) : null}
        </>
      ) : null}

      <Suspense fallback={null}>
        <RelatedProducts shop={shop} product={product} country={geo?.country ?? null} display={display} />
      </Suspense>

      <RecentlyViewed
        exclude={product.id}
        limit={4}
        columns={catalog.gridColumns}
        display={display}
        showStockCode={catalog.showStockCode}
        className="mt-16"
      />
    </Container>
  );
}

function StatusBadge({ status }: { status: PublicStatus }) {
  if (status === "sold") return <Badge tone="sold">{copy.product.status.sold}</Badge>;
  if (status === "reserved") return <Badge tone="reserved">{copy.product.status.reserved}</Badge>;
  return <Badge tone="ok">{copy.product.status.available}</Badge>;
}

async function RelatedProducts({
  shop,
  product,
  country,
  display,
}: {
  shop: ShopContext;
  product: PublicProduct;
  country: string | null;
  display: DisplayCurrency | null;
}) {
  const tenantId = shop.tenant.id;
  const candidates = await getRelated(tenantId, { id: product.id, relatedIds: product.relatedIds, categoryId: product.categoryId, tagIds: product.tags.map((t) => t.id) }, 4);
  if (!candidates.length) return null;
  const ids = candidates.map((r) => r.id);
  const [reserved, viewer, verdicts] = await Promise.all([
    liveReservedIds(tenantId, ids),
    getShopViewer(tenantId),
    country ? resolveCompliance(tenantId, ids, country) : Promise.resolve({} as Awaited<ReturnType<typeof resolveCompliance>>),
  ]);
  const related = candidates.filter((c) => !verdicts[c.id]?.hidden);
  if (!related.length) return null;
  const cards = withLiveStatus(related, reserved).map((c) =>
    applyGeoBlur(
      toCardData(c, {
        currency: shop.tenant.currency,
        showPriceWhenSold: shop.settings.catalog.showPriceWhenSold,
        lockSensitive: shop.settings.legal.blurSensitiveForGuests && !viewer,
      }),
      c,
      verdicts[c.id]?.blurred ?? false,
    ),
  );
  return (
    <section className="mt-16 border-t border-shop-line pt-10" aria-labelledby="pd-related">
      <SectionHeading title={<span id="pd-related">{copy.product.related}</span>} />
      <ProductGrid products={cards} columns={4} display={display} showStockCode={shop.settings.catalog.showStockCode} headingLevel={3} wishlistSlot={(p) => <WishlistButton productId={p.id} />} />
    </section>
  );
}

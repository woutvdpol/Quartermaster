import Link from "next/link";
import { Suspense } from "react";
import { Badge, Breadcrumbs, Container, LockedImg, Markdown, Price, ProductCard, ProductGrid, SectionHeading } from "@/components/shop/ui";
import { getSimilarProducts } from "@/server/search";
import { searchCopy } from "@/components/shop/search/_copy";
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
import type { PublicImage, PublicProduct, PublicStatus } from "@/server/storefront-catalog/types";
import { applyGeoBlur, toCardData } from "../to-card";
import { catalogCopy as copy } from "../_copy";
import { LockedPanel } from "./LockedPanel";
import { ProductBuyBox } from "./ProductBuyBox";
import { OfferButton } from "@/components/shop/offers/OfferButton";
import { ProductGallery, type GalleryImage } from "./ProductGallery";
import { pickSources } from "@/lib/media/variants";
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
  inCart = false,
  locked,
  geo = null,
  display = null,
}: {
  shop: ShopContext;
  product: PublicProduct;
  status: PublicStatus;
  /** The visitor's own cart holds this item (buy box shows "In your cart"). */
  inCart?: boolean;
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
  const eyebrow = [product.categoryPath.at(-1)?.title, ...eyebrowFacets].filter(Boolean).join(" · ");
  const geoBlurred = Boolean(geo?.blurred) && !locked;
  // Facet values are the structured truth: free-text spec rows with the same label are not repeated.
  const facetLabels = new Set(product.facets.map((f) => f.facet.name.trim().toLowerCase()));
  const specs = product.specifications.filter((s) => !facetLabels.has(s.label.trim().toLowerCase()));
  const notice = "rounded-shop px-4 py-3 text-sm";

  return (
    <Container className="py-6 sm:py-10">
      <RecentlyViewedTracker productId={product.id} />
      <Breadcrumbs items={crumbs} jsonLdBase={shop.origin} />

      <div className="mt-6 grid gap-8 sm:mt-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:gap-14 xl:gap-20">
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
              <figcaption className="mt-3 text-sm text-shop-muted">{copy.product.geoBlurred}</figcaption>
            </figure>
          ) : (
            <ProductGallery images={galleryImages(product.images)} title={product.title} />
          )}
        </div>

        <div className="min-w-0 lg:sticky lg:top-24 lg:self-start">
          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 font-shop-mono text-[0.8rem] text-shop-muted">
            <span className="text-shop-accent">{copy.product.stockCode(product.stockCode)}</span>
            {eyebrow ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{eyebrow}</span>
              </>
            ) : null}
          </p>
          <h1 className="mt-3 text-[2rem] leading-[1.05] tracking-[-0.03em] text-shop-ink sm:text-[2.6rem]">{product.title}</h1>

          {locked ? (
            <div className="mt-8">
              <LockedPanel returnTo={product.href} />
            </div>
          ) : (
            <>
              <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-3">
                {showPrice ? <Price cents={product.price} currency={currency} display={display} size="xl" /> : null}
                <div className="flex flex-wrap gap-1.5">
                  <StatusBadge status={status} />
                  {product.onSale && status !== "sold" ? <Badge tone="accent">{copy.product.sale}</Badge> : null}
                </div>
              </div>

              {status === "reserved" ? (
                <p className={`mt-5 bg-shop-warn-soft text-shop-warn ${notice}`}>{copy.product.reservedHint}</p>
              ) : status === "sold" ? (
                <p className="mt-5 text-sm text-shop-muted">{copy.product.soldHint}</p>
              ) : null}

              {geo?.noShipping && geo.country && status !== "sold" ? (
                <p role="note" className={`mt-5 bg-shop-warn-soft text-shop-warn ${notice}`}>
                  {copy.product.noShipping(countryName(geo.country))}
                </p>
              ) : null}

              {status !== "sold" ? (
                <div className="mt-7 flex flex-col gap-3">
                  <ProductBuyBox product={product} available={status === "available" && !inCart} />
                  {status === "available" && !inCart ? (
                    <Suspense fallback={null}>
                      <OfferButton productId={product.id} />
                    </Suspense>
                  ) : null}
                  <div className="mt-1 flex flex-col gap-1.5">
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
                </div>
              ) : (
                <div className="mt-7">
                  <WishlistButton productId={product.id} variant="full" className="w-full" />
                </div>
              )}

              {product.restrictedSymbols ? (
                <p role="note" className={`mt-7 bg-shop-sunken text-shop-ink-2 ${notice}`}>
                  {copy.product.restrictedNotice}
                </p>
              ) : null}

              {specs.length || product.facets.length ? (
                <section className="mt-10" aria-labelledby="pd-specs">
                  <h2 id="pd-specs" className="mb-2 font-shop-body text-sm font-semibold tracking-normal text-shop-ink">
                    {copy.product.specifications}
                  </h2>
                  <dl className="divide-y divide-shop-line border-y border-shop-line text-sm">
                    {product.facets.map((f) => (
                      <div key={f.facet.id} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-6 py-3">
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
                      <div key={`${i}-${s.label}`} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-6 py-3">
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
        <div className="mt-16 grid gap-12 sm:mt-20 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:gap-14 xl:gap-20">
          <div className="flex min-w-0 flex-col gap-10 empty:hidden">
            {product.description ? (
              <section className="max-w-3xl" aria-labelledby="pd-desc">
                <h2 id="pd-desc" className="mb-5 text-2xl text-shop-ink sm:text-[1.75rem]">
                  {copy.product.description}
                </h2>
                <Markdown source={product.description} />
              </section>
            ) : null}

            {catalog.showTags && product.tags.length ? (
              <section aria-labelledby="pd-tags">
                <h2 id="pd-tags" className="sr-only">
                  {copy.product.tags}
                </h2>
                <ul className="flex flex-wrap gap-2" role="list">
                  {product.tags.map((t) => (
                    <li key={t.id}>
                      <Link
                        href={tagHref(t.slug)}
                        className="inline-flex h-8 items-center rounded-shop-control bg-shop-sunken px-3.5 text-sm font-medium text-shop-ink-2 transition-colors hover:bg-shop-line hover:text-shop-ink"
                      >
                        {t.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {legal.disclaimers.product ? <p className="max-w-3xl text-xs text-shop-muted">{legal.disclaimers.product}</p> : null}
          </div>

          <div className="flex min-w-0 flex-col gap-6 empty:hidden">
            {/* Not streamed: provenance is a key fact for search engines / AI crawlers that read raw
                HTML (docs/seo-geo.md). Its data is cached per tenant, so this costs no extra query. */}
            <ProvenanceBlock productId={product.id} />

            {status !== "available" ? (
              <section className="flex flex-col gap-4 rounded-shop border border-shop-line p-6" aria-labelledby="pd-notify">
                <div>
                  <h2 id="pd-notify" className="text-xl text-shop-ink">
                    {copy.product.notifyTitle}
                  </h2>
                  <p className="mt-1 text-sm text-shop-muted">{copy.product.notifyBody}</p>
                </div>
                <NotifyMeButton productId={product.id} />
              </section>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Below the fold and streamed: neither rail delays the product itself. */}
      {!locked ? (
        <Suspense fallback={null}>
          <SimilarProducts shop={shop} product={product} country={geo?.country ?? null} display={display} />
        </Suspense>
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
        className="mt-20 border-t border-shop-line pt-12"
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
    <section className="mt-20 border-t border-shop-line pt-12" aria-labelledby="pd-related">
      <SectionHeading title={<span id="pd-related">{copy.product.related}</span>} />
      <ProductGrid products={cards} columns={4} display={display} showStockCode={shop.settings.catalog.showStockCode} headingLevel={3} wishlistSlot={(p) => <WishlistButton productId={p.id} />} />
    </section>
  );
}

/** Fewer neighbours than this and the "Looks like this" rail is not shown. */
const SIMILAR_MIN = 3;

/**
 * "Looks like this" (smart search, docs/search.md): neighbours by photo and text embeddings, data-cached
 * per product (getSimilarProducts) — on a cache hit this costs the reservation/compliance lookups only.
 * Hidden when the shop has no embeddings yet or fewer than three items clearly look alike.
 */
async function SimilarProducts({ shop, product, country, display }: { shop: ShopContext; product: PublicProduct; country: string | null; display: DisplayCurrency | null }) {
  const tenantId = shop.tenant.id;
  const candidates = await getSimilarProducts(tenantId, product.id).catch(() => []);
  if (candidates.length < SIMILAR_MIN) return null;
  const ids = candidates.map((c) => c.id);
  const [reserved, viewer, verdicts] = await Promise.all([
    liveReservedIds(tenantId, ids),
    getShopViewer(tenantId),
    country ? resolveCompliance(tenantId, ids, country) : Promise.resolve({} as Awaited<ReturnType<typeof resolveCompliance>>),
  ]);
  const visible = candidates.filter((c) => !verdicts[c.id]?.hidden);
  if (visible.length < SIMILAR_MIN) return null;
  const cards = withLiveStatus(visible, reserved).map((c) =>
    applyGeoBlur(
      toCardData(c, { currency: shop.tenant.currency, showPriceWhenSold: shop.settings.catalog.showPriceWhenSold, lockSensitive: shop.settings.legal.blurSensitiveForGuests && !viewer }),
      c,
      verdicts[c.id]?.blurred ?? false,
    ),
  );
  return (
    <section className="mt-20 border-t border-shop-line pt-12" aria-labelledby="pd-similar" data-testid="similar-rail">
      <SectionHeading title={<span id="pd-similar">{searchCopy.similar.title}</span>} intro={searchCopy.similar.intro} />
      <div className="-mx-1 flex snap-x gap-4 overflow-x-auto px-1 pb-2 sm:gap-5 [scrollbar-width:thin]">
        {cards.map((p) => (
          <ProductCard
            key={p.id}
            product={p}
            display={display}
            showStockCode={shop.settings.catalog.showStockCode}
            headingLevel={3}
            sizes="(min-width: 640px) 15rem, 11.5rem"
            className="w-[11.5rem] flex-none snap-start sm:w-[15rem]"
          />
        ))}
      </div>
    </section>
  );
}

/**
 * Gallery props are serialised into the RSC payload: send only the widths the gallery can use (the
 * "wide" profile) instead of every stored variant.
 */
function galleryImages(images: PublicImage[]): GalleryImage[] {
  return images.map(({ id, alt, width, height, thumb, card, large, blurDataUrl, sources }) => ({
    id,
    alt,
    width,
    height,
    thumb,
    card,
    large,
    blurDataUrl,
    sources: sources?.length ? pickSources(sources, "wide") : null,
    thumbAvif: sources?.[0]?.avif ?? null,
  }));
}

import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, permanentRedirect } from "next/navigation";
import { resolveCompliance, visitorCountry } from "@/server/compliance";
import { JsonLd } from "@/components/shop/ui";
import { requireShop } from "@/server/storefront/context";
import { getShopViewer } from "@/server/storefront/viewer";
import { getVisitorDisplayCurrency } from "@/server/rates/display";
import { redirectOrNotFound } from "@/server/redirects/runtime";
import {
  getProduct,
  liveReservedIds,
  ownReservedIds,
  parseStockCode,
} from "@/server/storefront-catalog";
import type {
  PublicProduct,
  PublicStatus,
} from "@/server/storefront-catalog/types";
import {
  ProductDetail,
  type ProductGeo,
} from "@/components/shop/catalog/product/ProductDetail";
import { productJsonLd, shippingDetailsJsonLd } from "@/lib/seo/json-ld";
import { productMetaDescription, productOgImage, productOgTags, shopAlternates } from "@/lib/seo/metadata";
import { localizePath, type ShopLocale } from "@/lib/i18n/shop-locales";
import { metaTitle } from "@/lib/seo/text";
import { translateProduct } from "@/server/storefront/translate";
import { ORIGINAL_PARAM, wantsOriginal } from "@/components/shop/i18n/TranslatedNote";
import { blockedShippingCountries, deliveryCountries, loadSeoShop } from "@/server/seo";
import { priceVisible, soldPageNoindex } from "@/server/storefront-catalog/sold";

type Props = PageProps<"/product/[stockCode]/[[...slug]]">;

/**
 * Resolves the product or 404s. DRAFT / ARCHIVED / STOLEN products are never found, nor products a
 * compliance rule hides in the visitor's country (unknown country → no geo rules).
 */
async function load(raw: string, slug: string[] | undefined, original = false) {
  const shop = await requireShop();
  const code = parseStockCode(raw);
  const source = code === null ? null : await getProduct(shop.tenant.id, code);
  // Unknown / unpublished stock code: an owner or legacy redirect may cover the old URL.
  if (!source)
    return redirectOrNotFound([
      `/product/${raw}${slug?.length ? `/${slug.join("/")}` : ""}`,
      `/product/${raw}`,
    ]);
  // Texts in the shop language: approved translations only, English otherwise (docs/i18n.md).
  const { product, ...translated } = await translateProduct(shop.tenant.id, shop.locale, source, { original });
  const translation = { ...translated, original: original && translated.descriptionTranslatable };
  const country = visitorCountry(await headers());
  const verdict = country
    ? (await resolveCompliance(shop.tenant.id, [product.id], country))[
        product.id
      ]
    : undefined;
  if (verdict?.hidden) notFound();
  const geo: ProductGeo = {
    country,
    blurred: verdict?.blurred ?? false,
    noShipping: verdict?.noShipping ?? false,
  };
  return { shop, product, geo, translation };
}

/** Canonical URL is /product/{stockCode}/{slug}: anything else (no slug, old slug, extra segments) → 308 (same language). */
function ensureCanonical(product: PublicProduct, slug: string[] | undefined, locale: ShopLocale) {
  const given = slug?.length === 1 ? safeDecode(slug[0]) : null;
  if (given !== product.slug) permanentRedirect(localizePath(product.href, locale));
}

function safeDecode(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

async function isLocked(
  shopId: string,
  product: PublicProduct,
  blurForGuests: boolean,
) {
  if (!product.blurred || !blurForGuests) return false;
  return !(await getShopViewer(shopId));
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { stockCode, slug } = await params;
  const { shop, product, geo, translation } = await load(stockCode, slug, wantsOriginal((await searchParams)[ORIGINAL_PARAM]));
  ensureCanonical(product, slug, shop.locale);
  const locked = await isLocked(
    shop.tenant.id,
    product,
    shop.settings.legal.blurSensitiveForGuests,
  );
  const title = metaTitle(product.seoTitle, product.title);
  // Markdown alternate for AI assistants (/product/{No}.md → src/app/md/product).
  const alternates = shopAlternates(shop, product.href, { "text/markdown": `/product/${product.stockCode}.md` });
  if (locked) {
    // Sensitive item for a guest: no description, no image, not indexable.
    return {
      title,
      alternates: { canonical: alternates.canonical },
      robots: { index: false, follow: false },
    };
  }
  const { catalog } = shop.settings;
  const showPrice = priceVisible(product);
  const description = productMetaDescription(product, shop.shopName, showPrice ? shop.tenant.currency : null, shop.locale);
  // No preview image where a compliance rule blurs the photos; generated card when there are none.
  const image = geo.blurred ? null : productOgImage(product);
  // Sensitive items are never indexed (signed-in customers can still view them); sold items only
  // as part of the public archive, i.e. not hidden from it (docs/sold-archive.md, docs/seo-geo.md).
  // The English original of a translated page (?original=1) is not indexed; canonical = the translation.
  const noindex = soldPageNoindex(product, catalog.publicArchive) || translation.original;
  return {
    title,
    description,
    alternates,
    // Only set when needed: `robots: undefined` would also wipe the layout's noindex (coming soon / preview).
    ...(noindex ? { robots: { index: false, follow: true } } : {}),
    openGraph: {
      title,
      description,
      url: alternates.canonical,
      siteName: shop.shopName,
      images: [image ?? { url: `/og/product/${product.stockCode}`, width: 1200, height: 630, alt: product.title }],
    },
    twitter: { card: "summary_large_image", title, description },
    // og:type product + product:* tags (Next's openGraph types have no "product").
    other: productOgTags(product, shop.tenant.currency, showPrice),
  };
}

export default async function ProductPage({ params, searchParams }: Props) {
  const { stockCode, slug } = await params;
  const { shop, product, geo, translation } = await load(stockCode, slug, wantsOriginal((await searchParams)[ORIGINAL_PARAM]));
  ensureCanonical(product, slug, shop.locale);

  const live = product.status === "available";
  const [locked, reserved, own, display, seo] = await Promise.all([
    isLocked(
      shop.tenant.id,
      product,
      shop.settings.legal.blurSensitiveForGuests,
    ),
    live
      ? liveReservedIds(shop.tenant.id, [product.id])
      : Promise.resolve(new Set<string>()),
    live
      ? ownReservedIds(shop.tenant.id, [product.id])
      : Promise.resolve(new Set<string>()),
    getVisitorDisplayCurrency(shop.tenant.id),
    loadSeoShop(shop),
  ]);
  const blocked = await blockedShippingCountries(shop.tenant.id, product, deliveryCountries(seo.zones, ""));
  // Held by this visitor's own cart: shown as for sale, with "In your cart" in the buy box.
  const inCart = own.has(product.id);
  const status: PublicStatus =
    product.status === "available" && reserved.has(product.id)
      ? "reserved"
      : product.status;

  return (
    <>
      {!locked ? (
        <JsonLd
          data={productJsonLd(
            seo.seo,
            geo.blurred ? { ...product, images: [] } : product,
            status,
            {
              // Sold: an Offer with availability SoldOut only when the sold price is shown, else none.
              showPrice: priceVisible({ status, showSoldPrice: product.showSoldPrice }),
              shipping: status === "sold" ? [] : shippingDetailsJsonLd(seo.zones, {
                weightGrams: product.weightGrams,
                price: product.price,
                freeShippingThreshold: shop.settings.checkout.freeShippingThresholdCents,
                currency: shop.tenant.currency,
                blockedCountries: blocked,
              }),
              returns: seo.seo.returns,
              locale: shop.locale,
            },
          )}
        />
      ) : null}
      <ProductDetail
        shop={shop}
        product={product}
        status={status}
        inCart={inCart}
        locked={locked}
        geo={geo}
        display={display}
        translation={translation}
      />
    </>
  );
}

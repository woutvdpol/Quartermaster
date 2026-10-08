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
import { productMetaDescription, productOgImage, productOgTags } from "@/lib/seo/metadata";
import { metaTitle } from "@/lib/seo/text";
import { blockedShippingCountries, deliveryCountries, loadSeoShop } from "@/server/seo";

type Props = PageProps<"/product/[stockCode]/[[...slug]]">;

/**
 * Resolves the product or 404s. DRAFT / ARCHIVED / STOLEN products are never found, nor products a
 * compliance rule hides in the visitor's country (unknown country → no geo rules).
 */
async function load(raw: string, slug: string[] | undefined) {
  const shop = await requireShop();
  const code = parseStockCode(raw);
  const product = code === null ? null : await getProduct(shop.tenant.id, code);
  // Unknown / unpublished stock code: an owner or legacy redirect may cover the old URL.
  if (!product)
    return redirectOrNotFound([
      `/product/${raw}${slug?.length ? `/${slug.join("/")}` : ""}`,
      `/product/${raw}`,
    ]);
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
  return { shop, product, geo };
}

/** Canonical URL is /product/{stockCode}/{slug}: anything else (no slug, old slug, extra segments) → 308. */
function ensureCanonical(product: PublicProduct, slug: string[] | undefined) {
  const given = slug?.length === 1 ? safeDecode(slug[0]) : null;
  if (given !== product.slug) permanentRedirect(product.href);
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

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { stockCode, slug } = await params;
  const { shop, product, geo } = await load(stockCode, slug);
  ensureCanonical(product, slug);
  const locked = await isLocked(
    shop.tenant.id,
    product,
    shop.settings.legal.blurSensitiveForGuests,
  );
  const title = metaTitle(product.seoTitle, product.title);
  // Markdown alternate for AI assistants (/product/{No}.md → src/app/md/product).
  const alternates = { canonical: product.href, types: { "text/markdown": `/product/${product.stockCode}.md` } };
  if (locked) {
    // Sensitive item for a guest: no description, no image, not indexable.
    return {
      title,
      alternates: { canonical: product.href },
      robots: { index: false, follow: false },
    };
  }
  const { catalog } = shop.settings;
  const showPrice = product.status !== "sold" || catalog.showPriceWhenSold;
  const description = productMetaDescription(product, shop.shopName, showPrice ? shop.tenant.currency : null);
  // No preview image where a compliance rule blurs the photos; generated card when there are none.
  const image = geo.blurred ? null : productOgImage(product);
  // Sensitive items are never indexed (signed-in customers can still view them); sold items only
  // while the shop keeps a public archive (docs/seo-geo.md §Verkochte items).
  const noindex = product.blurred || (product.status === "sold" && !catalog.publicArchive);
  return {
    title,
    description,
    alternates,
    // Only set when needed: `robots: undefined` would also wipe the layout's noindex (coming soon / preview).
    ...(noindex ? { robots: { index: false, follow: true } } : {}),
    openGraph: {
      title,
      description,
      url: product.href,
      siteName: shop.shopName,
      images: [image ?? { url: `/og/product/${product.stockCode}`, width: 1200, height: 630, alt: product.title }],
    },
    twitter: { card: "summary_large_image", title, description },
    // og:type product + product:* tags (Next's openGraph types have no "product").
    other: productOgTags(product, shop.tenant.currency, showPrice),
  };
}

export default async function ProductPage({ params }: Props) {
  const { stockCode, slug } = await params;
  const { shop, product, geo } = await load(stockCode, slug);
  ensureCanonical(product, slug);

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
              showPrice: status !== "sold" || shop.settings.catalog.showPriceWhenSold,
              shipping: status === "sold" ? [] : shippingDetailsJsonLd(seo.zones, {
                weightGrams: product.weightGrams,
                price: product.price,
                freeShippingThreshold: shop.settings.checkout.freeShippingThresholdCents,
                currency: shop.tenant.currency,
                blockedCountries: blocked,
              }),
              returns: seo.seo.returns,
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
      />
    </>
  );
}

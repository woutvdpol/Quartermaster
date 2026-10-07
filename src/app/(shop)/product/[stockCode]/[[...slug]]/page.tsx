import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, permanentRedirect } from "next/navigation";
import { resolveCompliance, visitorCountry } from "@/server/compliance";
import { JsonLd } from "@/components/shop/ui";
import { requireShop } from "@/server/storefront/context";
import { getShopViewer } from "@/server/storefront/viewer";
import { getVisitorDisplayCurrency } from "@/server/rates/display";
import { markdownToPlainText } from "@/server/content/markdown";
import { getProduct, liveReservedIds, parseStockCode } from "@/server/storefront-catalog";
import type { PublicProduct, PublicStatus } from "@/server/storefront-catalog/types";
import { ProductDetail, type ProductGeo } from "@/components/shop/catalog/product/ProductDetail";
import { productJsonLd } from "@/components/shop/catalog/product/json-ld";

type Props = PageProps<"/product/[stockCode]/[[...slug]]">;

/**
 * Resolves the product or 404s. DRAFT / ARCHIVED / STOLEN products are never found, nor products a
 * compliance rule hides in the visitor's country (unknown country → no geo rules).
 */
async function load(raw: string) {
  const shop = await requireShop();
  const code = parseStockCode(raw);
  if (code === null) notFound();
  const product = await getProduct(shop.tenant.id, code);
  if (!product) notFound();
  const country = visitorCountry(await headers());
  const verdict = country ? (await resolveCompliance(shop.tenant.id, [product.id], country))[product.id] : undefined;
  if (verdict?.hidden) notFound();
  const geo: ProductGeo = { country, blurred: verdict?.blurred ?? false, noShipping: verdict?.noShipping ?? false };
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

async function isLocked(shopId: string, product: PublicProduct, blurForGuests: boolean) {
  if (!product.blurred || !blurForGuests) return false;
  return !(await getShopViewer(shopId));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { stockCode, slug } = await params;
  const { shop, product, geo } = await load(stockCode);
  ensureCanonical(product, slug);
  const locked = await isLocked(shop.tenant.id, product, shop.settings.legal.blurSensitiveForGuests);
  const title = product.seoTitle || product.title;
  if (locked) {
    // Sensitive item for a guest: no description, no image, not indexable.
    return { title, alternates: { canonical: product.href }, robots: { index: false, follow: false } };
  }
  const description = product.seoDescription || (product.description ? markdownToPlainText(product.description).slice(0, 160) : undefined);
  // No preview image where a compliance rule blurs the photos.
  const image = geo.blurred ? undefined : product.images[0];
  return {
    title,
    description,
    alternates: { canonical: product.href },
    // Sensitive items are never indexed (signed-in customers can still view them).
    robots: product.blurred ? { index: false, follow: false } : undefined,
    openGraph: {
      title,
      description,
      url: product.href,
      ...(image ? { images: [{ url: image.large, width: image.width ?? undefined, height: image.height ?? undefined, alt: image.alt ?? product.title }] } : {}),
    },
    twitter: { card: image ? "summary_large_image" : "summary" },
  };
}

export default async function ProductPage({ params }: Props) {
  const { stockCode, slug } = await params;
  const { shop, product, geo } = await load(stockCode);
  ensureCanonical(product, slug);

  const [locked, reserved, display] = await Promise.all([
    isLocked(shop.tenant.id, product, shop.settings.legal.blurSensitiveForGuests),
    product.status === "available" ? liveReservedIds(shop.tenant.id, [product.id]) : Promise.resolve(new Set<string>()),
    getVisitorDisplayCurrency(shop.tenant.id),
  ]);
  const status: PublicStatus = product.status === "available" && reserved.has(product.id) ? "reserved" : product.status;

  return (
    <>
      {!locked ? <JsonLd data={productJsonLd(shop, geo.blurred ? { ...product, images: [] } : product, status)} /> : null}
      <ProductDetail shop={shop} product={product} status={status} locked={locked} geo={geo} display={display} />
    </>
  );
}


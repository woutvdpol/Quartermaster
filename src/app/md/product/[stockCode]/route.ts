import { headers } from "next/headers";
import { resolveCompliance, visitorCountry } from "@/server/compliance";
import { getPublicProvenance } from "@/server/provenance/public";
import { getSeoScope, notFoundResponse, textResponse } from "@/server/seo/http";
import { shippingLines } from "@/lib/seo/shipping-lines";
import { getShopQuoteZones } from "@/server/storefront/shipping";
import { getShopViewer } from "@/server/storefront/viewer";
import { getProduct, liveReservedIds, parseStockCode } from "@/server/storefront-catalog";
import type { PublicStatus } from "@/server/storefront-catalog/types";
import { productMarkdown, returnsSummary } from "@/lib/seo/markdown-alternate";

/*
 * Markdown alternate of a product page: /product/{No}.md (rewrite in next.config.ts). Same visibility
 * as the HTML page: unknown / unpublished / compliance-hidden → 404, sensitive items only for
 * signed-in customers (when the shop blurs them), blurred-by-rule photos left out.
 * The HTML page is canonical (Link header); sold items outside the public archive are noindex.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ stockCode: string }> }) {
  const scope = await getSeoScope();
  if (scope.kind !== "shop") return notFoundResponse();
  const { shop } = scope;
  const id = shop.tenant.id;
  const code = parseStockCode((await ctx.params).stockCode);
  const product = code === null ? null : await getProduct(id, code);
  if (!product) return notFoundResponse();

  const country = visitorCountry(await headers());
  const verdict = country ? (await resolveCompliance(id, [product.id], country))[product.id] : undefined;
  if (verdict?.hidden) return notFoundResponse();
  if (product.blurred && shop.settings.legal.blurSensitiveForGuests && !(await getShopViewer(id))) return notFoundResponse();

  const [reserved, provenance, zones] = await Promise.all([
    product.status === "available" ? liveReservedIds(id, [product.id]) : Promise.resolve(new Set<string>()),
    getPublicProvenance(id, product.id),
    getShopQuoteZones(id).catch(() => []),
  ]);
  const status: PublicStatus = product.status === "available" && reserved.has(product.id) ? "reserved" : product.status;
  const { catalog, checkout, general, legal } = shop.settings;
  const body = productMarkdown({
    shop: { name: shop.shopName, origin: shop.origin, currency: shop.tenant.currency, country: general.address.country },
    product,
    status,
    showPrice: status !== "sold" || catalog.showPriceWhenSold,
    showImages: !verdict?.blurred,
    provenance: provenance
      ? { text: provenance.provenance, certificateIncluded: provenance.certificateIncluded, authenticityGuaranteed: provenance.authenticityGuaranteed }
      : null,
    shippingLines:
      status === "sold"
        ? []
        : shippingLines(zones, { weightGrams: product.weightGrams, price: product.price, freeShippingThreshold: checkout.freeShippingThresholdCents, currency: shop.tenant.currency }),
    returnsLine: status === "sold" ? null : returnsSummary(legal.returns),
    disclaimer: legal.disclaimers.product || null,
  });
  const canonical = new URL(product.href, shop.origin).toString();
  const noindex = product.blurred || (status === "sold" && !catalog.publicArchive);
  return textResponse(body, "text/markdown", {
    Link: `<${canonical}>; rel="canonical"`,
    ...(noindex ? { "X-Robots-Tag": "noindex" } : {}),
    // Availability changes when someone reserves the item: never keep it in a shared cache for long.
    "Cache-Control": "public, max-age=0, s-maxage=60",
    Vary: "Cookie, CF-IPCountry",
  });
}

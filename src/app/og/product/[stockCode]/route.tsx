import { getSeoScope, notFoundResponse } from "@/server/seo/http";
import { ogCard } from "@/server/seo/og-card";
import { getProduct, parseStockCode } from "@/server/storefront-catalog";

/** Generated OG card for a product without photos (product metadata links here only then). */
export async function GET(_req: Request, ctx: { params: Promise<{ stockCode: string }> }) {
  const scope = await getSeoScope();
  if (scope.kind !== "shop") return notFoundResponse();
  const { shop } = scope;
  const code = parseStockCode((await ctx.params).stockCode);
  const product = code === null ? null : await getProduct(shop.tenant.id, code);
  // Sensitive items never get a preview.
  if (!product || product.blurred) return notFoundResponse();
  return ogCard({ shopName: shop.shopName, title: product.title, eyebrow: `No. ${product.stockCode}`, color: shop.settings.appearance.colors.primary });
}

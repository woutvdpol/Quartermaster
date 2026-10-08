import { getSeoScope, notFoundResponse } from "@/server/seo/http";
import { ogCard } from "@/server/seo/og-card";
import { shopDescription } from "@/server/seo";

/** Generated OG card for a shop without a banner image (default og:image of every shop page). */
export async function GET() {
  const scope = await getSeoScope();
  if (scope.kind !== "shop") return notFoundResponse();
  const { shop } = scope;
  return ogCard({ shopName: shop.shopName, title: shopDescription(shop), color: shop.settings.appearance.colors.primary });
}

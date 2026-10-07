import type { MetadataRoute } from "next";
import { getRequestScope } from "@/server/tenant";
import { getShopContext } from "@/server/storefront/context";

/** Per-host robots.txt: shops are crawlable (minus private areas); the platform host is not. */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const scope = await getRequestScope();
  if (scope.kind !== "tenant") return { rules: { userAgent: "*", disallow: "/" } };
  const shop = await getShopContext();
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/api/", "/cart", "/checkout", "/account", "/login", "/register", "/forgot-password", "/*?*sort=", "/*?*q="],
    },
    ...(shop ? { sitemap: new URL("/sitemap.xml", shop.origin).toString(), host: shop.origin } : {}),
  };
}

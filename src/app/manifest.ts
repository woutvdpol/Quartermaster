import type { MetadataRoute } from "next";
import { getShopContext } from "@/server/storefront/context";

/** Web app manifest per shop (name + theme colour from appearance settings). */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const shop = await getShopContext();
  if (!shop) return { name: "Quartermaster", short_name: "Quartermaster", start_url: "/admin", display: "browser" };
  const { appearance } = shop.settings;
  return {
    name: shop.shopName,
    short_name: shop.shopName.slice(0, 12),
    start_url: "/",
    display: "browser",
    theme_color: appearance.colors.primary,
    background_color: "#fffdf8",
    ...(appearance.logoPath ? { icons: [{ src: appearance.logoPath, sizes: "any" }] } : {}),
  };
}

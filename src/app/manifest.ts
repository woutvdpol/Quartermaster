import type { MetadataRoute } from "next";
import { getShopContext } from "@/server/storefront/context";

/** Web app manifest per shop (name + theme colour from appearance settings). */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const shop = await getShopContext();
  if (!shop) return { name: "Quartermaster", short_name: "Quartermaster", start_url: "/admin", display: "browser" };
  const { appearance } = shop.settings;
  // Installable ("Add to Home Screen"): standalone + square PNG icons. On iPhone web push only works
  // from the home-screen app (docs/push.md). Icons are generated from the shop logo (src/app/pwa-icon).
  return {
    id: "/",
    name: shop.shopName,
    short_name: shop.shopName.slice(0, 12),
    start_url: "/",
    scope: "/",
    display: "standalone",
    theme_color: appearance.colors.primary,
    background_color: "#fffdf8",
    icons: [
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

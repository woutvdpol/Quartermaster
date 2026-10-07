import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense, type CSSProperties } from "react";
import { getRequestScope } from "@/server/tenant";
import { getShopContext } from "@/server/storefront/context";
import { getLegalLinks, getPublicMenus } from "@/server/storefront/content";
import { hasConfirmedAge } from "@/server/storefront/age";
import { shopThemeVars } from "@/server/storefront/theme";
import { shopFontFamily, shopThemeFontFamilies } from "@/components/shop/layout/fonts";
import { Header } from "@/components/shop/layout/Header";
import { Footer } from "@/components/shop/layout/Footer";
import { HeaderCountsProvider } from "@/components/shop/layout/HeaderCounts";
import { ServerHeaderCounts } from "@/components/shop/layout/ServerHeaderCounts";
import { AgeGate } from "@/components/shop/layout/AgeGate";
import { AnalyticsBeacon } from "@/components/shop/layout/AnalyticsBeacon";
import { layoutCopy } from "@/components/shop/layout/_copy";
import "./shop.css";

/*
 * Storefront shell for every route in the (shop) group.
 *  - tenant host  → themed shop chrome (header, footer, age gate, analytics)
 *  - platform host → children unwrapped (only `/` renders there: the Quartermaster landing page;
 *                   every other shop page calls `requireShop()` and 404s)
 *  - unknown host → 404
 */

export async function generateMetadata(): Promise<Metadata> {
  const shop = await getShopContext();
  if (!shop) return {};
  const banner = shop.settings.appearance.bannerPath;
  return {
    metadataBase: new URL(shop.origin),
    title: { template: `%s · ${shop.shopName}`, default: shop.shopName },
    description: `${shop.shopName} — online shop`,
    applicationName: shop.shopName,
    openGraph: {
      type: "website",
      siteName: shop.shopName,
      locale: "en",
      ...(banner ? { images: [{ url: banner }] } : {}),
    },
    twitter: { card: banner ? "summary_large_image" : "summary" },
    ...(shop.settings.appearance.logoPath ? { icons: { icon: shop.settings.appearance.logoPath } } : {}),
  };
}

export default async function ShopLayout({ children }: LayoutProps<"/">) {
  const scope = await getRequestScope();
  if (scope.kind === "platform") return children;
  const shop = await getShopContext();
  if (!shop) notFound();

  const { appearance, legal, analytics } = shop.settings;
  const [menus, legalLinks, ageOk] = await Promise.all([
    getPublicMenus(shop.tenant.id),
    getLegalLinks(shop.tenant.id),
    legal.ageVerification === "popup" ? hasConfirmedAge(legal.minimumAge) : Promise.resolve(true),
  ]);

  const themeFonts = shopThemeFontFamilies(appearance.theme);
  const style = shopThemeVars({
    colors: appearance.colors,
    headingFontFamily: shopFontFamily(appearance.headingFont),
    textFontFamily: shopFontFamily(appearance.textFont),
    accentFontFamily: themeFonts.accent,
    monoFontFamily: themeFonts.mono,
  }) as CSSProperties;

  return (
    <HeaderCountsProvider>
      <div className="shop-root flex min-h-dvh flex-col" data-shop-theme={appearance.theme} style={style}>
        <a
          href="#main"
          className="sr-only z-50 rounded-shop-sm bg-shop-surface px-4 py-2 text-shop-ink shadow-shop-pop focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
        >
          {layoutCopy.skipToContent}
        </a>
        <Header tenantId={shop.tenant.id} shopName={shop.shopName} logoPath={appearance.logoPath} menu={menus.header} />
        <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
          {children}
        </main>
        <Footer shop={shop} menu={menus.footer} legalLinks={legalLinks} />
        {!ageOk ? <AgeGate shopName={shop.shopName} minimumAge={legal.minimumAge} /> : null}
        <Suspense fallback={null}>
          <ServerHeaderCounts tenantId={shop.tenant.id} />
        </Suspense>
        {analytics.provider === "own" ? (
          <Suspense fallback={null}>
            <AnalyticsBeacon />
          </Suspense>
        ) : null}
      </div>
    </HeaderCountsProvider>
  );
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense, type CSSProperties } from "react";
import { getRequestScope } from "@/server/tenant";
import { isNetworkHostRequest } from "@/server/network/request";
import { getShopContext } from "@/server/storefront/context";
import { getLegalLinks, getPublicMenus, withoutMenuDuplicates } from "@/server/storefront/content";
import { getLaunchState } from "@/server/storefront/launch";
import { NotLiveRibbon, OpeningSoon } from "@/components/shop/layout/OpeningSoon";
import { hasConfirmedAge } from "@/server/storefront/age";
import {
  shopAppearanceStyle,
  shopFontTables,
} from "@/components/shop/layout/fonts";
import { AgeGate, ThemePreviewBridge } from "@/components/shop/layout/lazy";
import { ShopFonts } from "@/components/shop/layout/ShopFonts";
import { Header } from "@/components/shop/layout/Header";
import { Footer } from "@/components/shop/layout/Footer";
import { HeaderCountsProvider } from "@/components/shop/layout/HeaderCounts";
import { ServerHeaderCounts } from "@/components/shop/layout/ServerHeaderCounts";
import { AnalyticsBeacon } from "@/components/shop/layout/AnalyticsBeacon";
import { TurnstileSiteKeyProvider } from "@/components/shop/turnstile/TurnstileSiteKey";
import { layoutCopy } from "@/components/shop/layout/_copy";
import { shopDescription } from "@/server/seo";
import { metaDescription } from "@/lib/seo/text";
import { shopOgDefaults } from "@/lib/seo/metadata";
import "./shop.css";

/*
 * Storefront shell for every route in the (shop) group.
 *  - tenant host  → themed shop chrome (header, footer, age gate, analytics)
 *  - platform host → children unwrapped (only `/` renders there: the Quartermaster landing page;
 *                   every other shop page calls `requireShop()` and 404s; plus /network, the network)
 *  - NETWORK_HOST  → children unwrapped (only the network pages render there)
 *  - unknown host → 404
 */

export async function generateMetadata(): Promise<Metadata> {
  const shop = await getShopContext();
  if (!shop) return {};
  // "Coming soon" shops and staff theme previews stay out of search engines
  // (src/server/storefront/launch.ts; previews also get X-Robots-Tag from src/proxy.ts).
  const launch = await getLaunchState();
  const hidden = launch.prelaunch || shop.themePreview !== null;
  return {
    ...(hidden ? { robots: { index: false, follow: false } } : {}),
    metadataBase: new URL(shop.origin),
    title: { template: `%s · ${shop.shopName}`, default: shop.shopName },
    description: metaDescription(shopDescription(shop)),
    applicationName: shop.shopName,
    openGraph: shopOgDefaults(shop),
    twitter: { card: "summary_large_image" },
    // Home-screen icon (iOS ignores manifest icons) + standalone web app: needed for web push on iPhone (docs/push.md).
    icons: { ...(shop.settings.appearance.logoPath ? { icon: shop.settings.appearance.logoPath } : {}), apple: "/pwa-icon/180" },
    appleWebApp: { capable: true, title: shop.shopName, statusBarStyle: "default" },
  };
}

export default async function ShopLayout({ children }: LayoutProps<"/">) {
  const scope = await getRequestScope();
  // Network pages on NETWORK_HOST (src/app/(shop)/network, docs/network.md) bring their own chrome too.
  if (scope.kind === "platform" || (await isNetworkHostRequest())) return children;
  const shop = await getShopContext();
  if (!shop) notFound();

  const { appearance, legal, analytics } = shop.settings;
  const launch = await getLaunchState();
  const style = shopAppearanceStyle(appearance) as CSSProperties;
  // Not live yet: visitors get the "Opening soon" page instead of any shop page; staff see the shop.
  if (launch.prelaunch && !launch.staff) {
    return (
      <TurnstileSiteKeyProvider siteKey={process.env.TURNSTILE_SITE_KEY || process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || undefined}>
        <div className="shop-root flex min-h-dvh flex-col" data-shop-theme={appearance.theme} style={style}>
          <ShopFonts appearance={appearance} />
          <OpeningSoon shop={shop} />
        </div>
      </TurnstileSiteKeyProvider>
    );
  }
  const notLive = launch.prelaunch;
  const [menus, allLegalLinks, ageOk] = await Promise.all([
    getPublicMenus(shop.tenant.id),
    getLegalLinks(shop.tenant.id),
    legal.ageVerification === "popup"
      ? hasConfirmedAge(legal.minimumAge)
      : Promise.resolve(true),
  ]);
  // Pages the footer menu already links (e.g. a "Service" column) are not repeated in the legal row.
  const legalLinks = withoutMenuDuplicates(allLegalLinks, menus.footer);

  return (
    <TurnstileSiteKeyProvider
      siteKey={
        process.env.TURNSTILE_SITE_KEY ||
        process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ||
        undefined
      }
    >
      <HeaderCountsProvider>
        <div
          className="shop-root flex min-h-dvh flex-col"
          data-shop-theme={appearance.theme}
          style={style}
        >
          <ShopFonts appearance={appearance} />
          <a
            href="#main"
            className="sr-only z-50 rounded-shop-sm bg-shop-surface px-4 py-2 text-shop-ink shadow-shop-pop focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
          >
            {layoutCopy.skipToContent}
          </a>
          <Header
            tenantId={shop.tenant.id}
            shopName={shop.shopName}
            logoPath={appearance.logoPath}
            menu={menus.header}
          />
          <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
            {children}
          </main>
          <Footer shop={shop} menu={menus.footer} legalLinks={legalLinks} />
          {!ageOk ? (
            <AgeGate shopName={shop.shopName} minimumAge={legal.minimumAge} />
          ) : null}
          <Suspense fallback={null}>
            <ServerHeaderCounts tenantId={shop.tenant.id} />
          </Suspense>
          {notLive && !shop.themePreview ? <NotLiveRibbon /> : null}
          {shop.themePreview ? (
            <ThemePreviewBridge
              hasDraft={shop.themePreview.hasDraft}
              notLive={notLive}
              {...shopFontTables()}
            />
          ) : null}
          {analytics.provider === "own" && !shop.themePreview && !notLive ? (
            <Suspense fallback={null}>
              <AnalyticsBeacon />
            </Suspense>
          ) : null}
        </div>
      </HeaderCountsProvider>
    </TurnstileSiteKeyProvider>
  );
}

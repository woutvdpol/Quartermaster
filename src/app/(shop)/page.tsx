import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getRequestScope } from "@/server/tenant";
import { requireShop, getShopContext } from "@/server/storefront/context";
import { getStorefrontHomePage } from "@/server/storefront/content";
import { getShopViewer } from "@/server/storefront/viewer";
import { markdownToPlainText } from "@/server/content/markdown";
import type { PublicBlock } from "@/server/content/pages";
import { BlockRenderer } from "@/components/shop/blocks/BlockRenderer";
import { blockContext } from "@/components/shop/blocks/context";
import { JsonLd } from "@/components/shop/ui/JsonLd";
import { PlatformLanding } from "./_platform/PlatformLanding";
import { platformCopy } from "./_platform/_copy";
import { organizationJsonLd, websiteJsonLd } from "@/lib/seo/json-ld";
import { shopOgDefaults } from "@/lib/seo/metadata";
import { metaDescription } from "@/lib/seo/text";
import { loadSeoShop, shopDescription } from "@/server/seo";
import { shopPageCopy } from "./_copy";

const t = shopPageCopy.home;

export async function generateMetadata(): Promise<Metadata> {
  const shop = await getShopContext();
  if (!shop) return { title: { absolute: platformCopy.name }, description: platformCopy.metaDescription, alternates: { canonical: "/" } };
  const page = await getStorefrontHomePage(shop.tenant.id);
  const firstText = page?.blocks.find((b) => b.type === "TEXT" || b.type === "TEXT_IMAGE" || b.type === "TEXT_HORIZONTAL");
  const description = metaDescription(
    page?.seoDescription,
    shop.settings.content.seo.description,
    page?.blocks[0]?.type === "HERO" && page.blocks[0].data.subtitle,
    firstText && "markdown" in firstText.data ? markdownToPlainText(firstText.data.markdown) : null,
    shopDescription(shop),
  );
  const title = page?.seoTitle || shop.shopName;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: "/" },
    openGraph: { ...shopOgDefaults(shop), url: "/", title, description },
  };
}

/** Shown when the HOME page is unpublished or empty: hero with the shop name + new arrivals. */
function fallbackBlocks(shopName: string): PublicBlock[] {
  return [
    { id: "fallback-hero", type: "HERO", data: { title: shopName, subtitle: t.fallbackSubtitle, imageKey: null, cta: { label: t.fallbackCta, href: "/shop" } } },
    { id: "fallback-new", type: "NEW_ITEMS", data: { title: t.newItems, count: 8, cta: { label: t.viewAll, href: "/shop" } } },
  ];
}

export default async function HomePage() {
  const scope = await getRequestScope();
  if (scope.kind === "platform") return <PlatformLanding />;
  const shop = await requireShop();
  if (shop.settings.content.homeRedirectsToShop) redirect("/shop");

  const [page, viewer, { seo }] = await Promise.all([getStorefrontHomePage(shop.tenant.id), getShopViewer(shop.tenant.id), loadSeoShop(shop)]);
  const blocks = page?.blocks.length ? page.blocks : fallbackBlocks(shop.shopName);
  const ctx = blockContext(shop, { viewerSignedIn: !!viewer, withBanner: shop.settings.content.bannerOnHome });
  const heroFirst = blocks[0]?.type === "HERO";

  // Organization (OnlineStore) + WebSite: the shop's entity for search engines and AI assistants.
  const org = organizationJsonLd(seo);
  const site = websiteJsonLd(seo);

  return (
    <>
      <JsonLd data={org} />
      <JsonLd data={site} />
      {heroFirst ? null : <h1 className="sr-only">{page?.title && page.title !== "Home" ? page.title : shop.shopName}</h1>}
      <BlockRenderer blocks={blocks} ctx={ctx} heroIsTitle={heroFirst} />
    </>
  );
}

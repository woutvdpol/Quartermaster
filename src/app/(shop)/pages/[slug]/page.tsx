import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { requireShop, getShopContext } from "@/server/storefront/context";
import { getStorefrontPage } from "@/server/storefront/content";
import { getShopViewer } from "@/server/storefront/viewer";
import { markdownToPlainText } from "@/server/content/markdown";
import { BlockRenderer } from "@/components/shop/blocks/BlockRenderer";
import { blockContext } from "@/components/shop/blocks/context";
import { Breadcrumbs } from "@/components/shop/ui/Breadcrumbs";
import { Container } from "@/components/shop/ui/Container";
import { cn } from "@/components/shop/ui/cn";

/*
 * Published CMS pages. Canonical public URL is `/{slug}` (contentPageHref; menus link there): a
 * fallback rewrite in next.config.ts maps `/{slug}` → `/pages/{slug}` when no other route matches.
 * `/pages/{slug}` itself also works and declares `/{slug}` canonical.
 */

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

async function load(slugParam: string) {
  const shop = await getShopContext();
  if (!shop || !SLUG.test(slugParam)) return { shop, page: null };
  return { shop, page: await getStorefrontPage(shop.tenant.id, slugParam) };
}

export async function generateMetadata({ params }: PageProps<"/pages/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const { page } = await load(slug);
  if (!page) return {};
  const textBlock = page.blocks.find((b) => "markdown" in b.data && typeof b.data.markdown === "string" && b.data.markdown);
  const description =
    page.seoDescription ||
    (textBlock && "markdown" in textBlock.data ? markdownToPlainText(textBlock.data.markdown as string).slice(0, 160) : undefined);
  return {
    title: page.seoTitle || page.title,
    description,
    alternates: { canonical: page.href },
    openGraph: { type: "article", url: page.href, title: page.seoTitle || page.title, description, modifiedTime: page.updatedAt },
  };
}

export default async function CmsPage({ params }: PageProps<"/pages/[slug]">) {
  const { slug } = await params;
  const shop = await requireShop();
  const { page } = await load(slug);
  if (!page) notFound();
  if (page.systemKey === "HOME") permanentRedirect("/");

  const viewer = await getShopViewer(shop.tenant.id);
  const withBanner = shop.settings.content.bannerOnPages;
  const ctx = blockContext(shop, { viewerSignedIn: !!viewer, withBanner });
  const heroFirst = page.blocks[0]?.type === "HERO";
  const banner = withBanner ? shop.settings.appearance.bannerPath : null;

  return (
    <article>
      {heroFirst ? (
        <h1 className="sr-only">{page.title}</h1>
      ) : (
        <header className={cn("relative isolate overflow-hidden", banner ? "bg-shop-ink text-white" : "border-b border-shop-line")}>
          {banner ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- stored branding asset */}
              <img src={banner} alt="" className="absolute inset-0 -z-10 h-full w-full object-cover" />
              <div aria-hidden="true" className="absolute inset-0 -z-10 bg-black/55" />
            </>
          ) : null}
          <Container size="narrow" className={banner ? "py-20 sm:py-28" : "py-10 sm:py-14"}>
            <Breadcrumbs items={[{ label: page.title }]} className={cn("mb-4", banner && "text-white/80 [&_a:hover]:text-white [&_span]:text-white/80")} jsonLdBase={shop.origin} />
            <h1 className="text-4xl sm:text-5xl">{page.title}</h1>
          </Container>
        </header>
      )}
      {page.blocks.length ? <BlockRenderer blocks={page.blocks} ctx={ctx} heroIsTitle={false} /> : null}
    </article>
  );
}

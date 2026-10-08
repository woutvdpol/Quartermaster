import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";
import { requireShop, getShopContext } from "@/server/storefront/context";
import { getStorefrontPage } from "@/server/storefront/content";
import { getShopViewer } from "@/server/storefront/viewer";
import { markdownToPlainText } from "@/server/content/markdown";
import { redirectOrNotFound } from "@/server/redirects/runtime";
import { BlockRenderer } from "@/components/shop/blocks/BlockRenderer";
import { blockContext } from "@/components/shop/blocks/context";
import { Breadcrumbs } from "@/components/shop/ui/Breadcrumbs";
import { Container } from "@/components/shop/ui/Container";
import { shopOgDefaults } from "@/lib/seo/metadata";
import { metaDescription, metaTitle } from "@/lib/seo/text";

/*
 * Published CMS pages. Canonical public URL is `/{slug}` (contentPageHref; menus link there): a
 * fallback rewrite in next.config.ts maps `/{slug}` → `/pages/{slug}` when no other route matches.
 * `/pages/{slug}` itself also works and declares `/{slug}` canonical.
 */

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const titleClass = "text-[2.25rem] leading-[1.05] tracking-[-0.03em] text-shop-ink sm:text-[3rem]";

async function load(slugParam: string) {
  const shop = await getShopContext();
  if (!shop || !SLUG.test(slugParam)) return { shop, page: null };
  return { shop, page: await getStorefrontPage(shop.tenant.id, slugParam) };
}

export async function generateMetadata({ params }: PageProps<"/pages/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const { shop, page } = await load(slug);
  if (!shop || !page) return {};
  const textBlock = page.blocks.find((b) => "markdown" in b.data && typeof b.data.markdown === "string" && b.data.markdown);
  const hero = page.blocks[0]?.type === "HERO" ? page.blocks[0].data.subtitle : null;
  const description = metaDescription(
    page.seoDescription,
    textBlock && "markdown" in textBlock.data ? markdownToPlainText(textBlock.data.markdown as string) : null,
    hero,
  );
  const title = metaTitle(page.seoTitle, page.title);
  return {
    title,
    description,
    // Markdown alternate for AI assistants (/{slug}.md → src/app/md/page).
    alternates: { canonical: page.href, types: { "text/markdown": `${page.href}.md` } },
    openGraph: { ...shopOgDefaults(shop), type: "article", url: page.href, title, description, modifiedTime: page.updatedAt },
  };
}

export default async function CmsPage({ params, searchParams }: PageProps<"/pages/[slug]">) {
  const { slug } = await params;
  const shop = await requireShop();
  const { page } = await load(slug);
  // Unknown slug: `/{slug}` reaches this page through the fallback rewrite, so it may be an old URL.
  if (!page) return redirectOrNotFound(`/${slug}`, await searchParams);
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
        <header className="pt-4 sm:pt-6">
          {banner ? (
            // Banner as a rounded image with the title card overlaid (same frame as the HERO block).
            <Container>
              <div className="relative isolate flex min-h-[300px] items-end overflow-hidden rounded-shop bg-shop-sunken sm:min-h-[380px]">
                {/* eslint-disable-next-line @next/next/no-img-element -- stored branding asset */}
                <img src={banner} alt="" className="absolute inset-0 -z-10 h-full w-full object-cover" />
                <div className="m-3 max-w-[560px] rounded-shop bg-shop-surface p-6 sm:m-6 sm:px-8 sm:py-7">
                  <Breadcrumbs items={[{ label: page.title }]} className="mb-3" jsonLdBase={shop.origin} />
                  <h1 className={titleClass}>{page.title}</h1>
                </div>
              </div>
            </Container>
          ) : (
            <Container size="narrow" className="pt-6 sm:pt-10">
              <Breadcrumbs items={[{ label: page.title }]} className="mb-4" jsonLdBase={shop.origin} />
              <h1 className={titleClass}>{page.title}</h1>
            </Container>
          )}
        </header>
      )}
      {page.blocks.length ? <BlockRenderer blocks={page.blocks} ctx={ctx} heroIsTitle={false} /> : null}
    </article>
  );
}

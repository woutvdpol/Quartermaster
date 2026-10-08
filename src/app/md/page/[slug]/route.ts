import { getSeoScope, notFoundResponse, textResponse } from "@/server/seo/http";
import { getStorefrontPage } from "@/server/storefront/content";
import { pageMarkdown } from "@/lib/seo/markdown-alternate";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Markdown alternate of a published CMS page: /{slug}.md (rewrite in next.config.ts). */
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const scope = await getSeoScope();
  const { slug } = await ctx.params;
  if (scope.kind !== "shop" || !SLUG.test(slug)) return notFoundResponse();
  const { shop } = scope;
  const page = await getStorefrontPage(shop.tenant.id, slug);
  if (!page || page.systemKey === "HOME") return notFoundResponse();
  const url = new URL(page.href, shop.origin).toString();
  return textResponse(pageMarkdown({ title: page.title, url, blocks: page.blocks, shopName: shop.shopName }), "text/markdown", {
    Link: `<${url}>; rel="canonical"`,
  });
}

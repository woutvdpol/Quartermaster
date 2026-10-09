import { Suspense, type ReactNode } from "react";
import type { BlockData } from "@/server/content/blocks";
import type { PublicBlock } from "@/server/content/pages";
import { Container } from "@/components/shop/ui/Container";
import { CategoryTilesSkeleton, ProductGridSkeleton, Skeleton } from "@/components/shop/ui/Skeleton";
import { cn } from "@/components/shop/ui/cn";
import { JsonLd } from "@/components/shop/ui/JsonLd";
import { faqPageJsonLd } from "@/lib/seo/json-ld";
import type { BlockContext } from "./context";
import { CategoriesBlock, NewItemsBlock, NewsletterBlock, TextProductBlock } from "./ShopBlocks";
import {
  CtaBlock,
  FaqBlock,
  GalleryBlock,
  HeroBlock,
  QuoteBlock,
  TestimonialsBlock,
  TextBlock,
  TextCarouselBlock,
  TextHorizontalBlock,
  TextImageBlock,
} from "./TextBlocks";

type Group = { kind: "single"; block: PublicBlock } | { kind: "testimonials"; id: string; items: BlockData<"TESTIMONIAL">[] };

/** Consecutive TESTIMONIAL blocks are merged into one slider (block catalog rule). */
function group(blocks: PublicBlock[]): Group[] {
  const out: Group[] = [];
  for (const b of blocks) {
    const last = out[out.length - 1];
    if (b.type === "TESTIMONIAL") {
      if (last?.kind === "testimonials") last.items.push(b.data);
      else out.push({ kind: "testimonials", id: b.id, items: [b.data] });
    } else out.push({ kind: "single", block: b });
  }
  return out;
}

/**
 * Renders a CMS page's blocks (all 14 types). Server component; product/category blocks fetch
 * their own (cached) data and stream in behind skeletons. The first HERO renders the page's h1
 * when `heroIsTitle` is set (otherwise the page renders its own h1). When the page has FAQ blocks,
 * one FAQPage JSON-LD covering all of them is emitted here (once per page).
 */
export function BlockRenderer({ blocks, ctx, heroIsTitle = false }: { blocks: PublicBlock[]; ctx: BlockContext; heroIsTitle?: boolean }) {
  // A disabled newsletter feature hides its sign-up blocks entirely (no empty section).
  const shown = ctx.newsletterEnabled ? blocks : blocks.filter((b) => b.type !== "NEWSLETTER_SIGNUP");
  const groups = group(shown);
  const faq = faqPageJsonLd(
    shown.flatMap((b) => (b.type === "FAQ" ? b.data.items : [])),
    ctx.origin,
  );
  return (
    // A plain block flow (not flex) so the sections' vertical margins collapse into one gap.
    <div>
      {faq ? <JsonLd data={faq} /> : null}
      {groups.map((g, i) => {
        if (g.kind === "testimonials") {
          return (
            <Section key={g.id}>
              <TestimonialsBlock items={g.items} locale={ctx.locale} />
            </Section>
          );
        }
        const b = g.block;
        if (b.type === "HERO") {
          return <HeroBlock key={b.id} data={b.data} fallbackImage={ctx.bannerPath} shopName={ctx.shopName} isFirst={i === 0 && heroIsTitle} />;
        }
        return (
          <Section key={b.id} tone={b.type === "QUOTE" || b.type === "TEXT_IMAGE" ? "sunken" : undefined}>
            {renderBlock(b, ctx, i)}
          </Section>
        );
      })}
    </div>
  );
}

/** ~72px between sections on desktop (margins collapse); "sunken" = full-bleed tinted band. */
function Section({ children, tone }: { children: ReactNode; tone?: "sunken" }) {
  return <section className={cn("my-shop-section last:mb-0! lg:my-shop-section-lg", tone === "sunken" && "bg-shop-sunken py-shop-section lg:py-shop-section-lg")}>{children}</section>;
}

function renderBlock(b: PublicBlock, ctx: BlockContext, index: number): ReactNode {
  switch (b.type) {
    case "TEXT":
      return <TextBlock data={b.data} />;
    case "TEXT_HORIZONTAL":
      return <TextHorizontalBlock data={b.data} />;
    case "TEXT_IMAGE":
      return <TextImageBlock data={b.data} />;
    case "TEXT_CAROUSEL":
      return <TextCarouselBlock data={b.data} blockId={b.id} locale={ctx.locale} />;
    case "QUOTE":
      return <QuoteBlock data={b.data} />;
    case "CTA":
      return <CtaBlock data={b.data} />;
    case "GALLERY":
      return <GalleryBlock data={b.data} locale={ctx.locale} />;
    case "TEXT_PRODUCT":
      return (
        <Suspense fallback={<Container><Skeleton className="h-72 w-full" /></Container>}>
          <TextProductBlock data={b.data} ctx={ctx} />
        </Suspense>
      );
    case "NEW_ITEMS":
      return (
        <Suspense fallback={<Container><ProductGridSkeleton count={Math.min(b.data.count, 8)} columns={ctx.gridColumns} /></Container>}>
          <NewItemsBlock data={b.data} ctx={ctx} priority={index <= 1} />
        </Suspense>
      );
    case "CATEGORIES":
      return (
        <Suspense fallback={<Container><CategoryTilesSkeleton heading={!!b.data.title} /></Container>}>
          <CategoriesBlock data={b.data} ctx={ctx} />
        </Suspense>
      );
    case "NEWSLETTER_SIGNUP":
      return <NewsletterBlock data={b.data} ctx={ctx} />;
    case "FAQ":
      return <FaqBlock data={b.data} blockId={b.id} />;
    case "HERO":
    case "TESTIMONIAL":
      return null; // handled by BlockRenderer
  }
}

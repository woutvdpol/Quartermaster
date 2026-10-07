import Link from "next/link";
import type { BlockData } from "@/server/content/blocks";
import { getCategoryTiles, getNewItems, getProductsByIds, liveReservedIds, toProductCardData } from "@/server/storefront/products";
import { Container } from "@/components/shop/ui/Container";
import { EmptyState } from "@/components/shop/ui/EmptyState";
import { Markdown } from "@/components/shop/ui/Markdown";
import { ProductCard } from "@/components/shop/ui/ProductCard";
import { ProductGrid } from "@/components/shop/ui/ProductGrid";
import { SectionHeading } from "@/components/shop/ui/SectionHeading";
import { ShopImg } from "@/components/shop/ui/ShopImg";
import { NewsletterForm } from "@/components/shop/layout/NewsletterForm";
import type { BlockContext } from "./context";
import { emphasis, stripEmphasis } from "./Emphasis";
import { blocksCopy } from "./_copy";

export async function TextProductBlock({ data, ctx }: { data: BlockData<"TEXT_PRODUCT">; ctx: BlockContext }) {
  const rows = data.productId ? await getProductsByIds(ctx.tenantId, [data.productId]) : [];
  const reserved = await liveReservedIds(ctx.tenantId, rows.map((r) => r.id));
  const product = rows[0] ? toProductCardData(rows[0], { ...ctx.card, reservedIds: reserved }) : null;
  return (
    <Container className="grid items-center gap-8 md:grid-cols-12 md:gap-14">
      <div className="md:col-span-7">
        {data.title ? <h2 className="mb-5 text-[1.75rem] leading-[1.08] tracking-[-0.025em] text-shop-ink sm:text-[2.25rem]">{emphasis(data.title)}</h2> : null}
        <Markdown source={data.markdown} />
        {product ? (
          <Link href={product.href} className="mt-6 inline-flex text-[0.95rem] font-semibold text-shop-ink underline-offset-4 hover:text-shop-primary hover:underline">
            {blocksCopy.viewProduct} <span aria-hidden="true">&nbsp;→</span>
          </Link>
        ) : null}
      </div>
      {product ? (
        <div className="mx-auto w-full max-w-sm md:col-span-5">
          <ProductCard product={product} showStockCode={ctx.showStockCode} sizes="(min-width: 768px) 380px, 90vw" />
        </div>
      ) : null}
    </Container>
  );
}

export async function NewItemsBlock({ data, ctx, priority }: { data: BlockData<"NEW_ITEMS">; ctx: BlockContext; priority?: boolean }) {
  const rows = await getNewItems(ctx.tenantId, data.count);
  const reserved = await liveReservedIds(ctx.tenantId, rows.map((r) => r.id));
  const products = rows.map((r) => toProductCardData(r, { ...ctx.card, reservedIds: reserved }));
  return (
    <Container>
      {data.title || data.cta ? <SectionHeading title={emphasis(data.title || "New arrivals")} action={data.cta ? { label: data.cta.label, href: data.cta.href } : null} /> : null}
      {products.length ? (
        <ProductGrid products={products} columns={ctx.gridColumns} showStockCode={ctx.showStockCode} priorityCount={priority ? ctx.gridColumns : 0} />
      ) : (
        <EmptyState title={blocksCopy.newItemsEmpty} />
      )}
    </Container>
  );
}

/**
 * Category tiles: square images (sunken placeholder without one) with the name underneath. A grid
 * from sm up; a horizontal scroll-snap rail on phones.
 */
export async function CategoriesBlock({ data, ctx }: { data: BlockData<"CATEGORIES">; ctx: BlockContext }) {
  const tiles = await getCategoryTiles(ctx.tenantId, data.categoryIds);
  if (!tiles.length) return null;
  return (
    <Container>
      {data.title ? <SectionHeading title={emphasis(data.title)} /> : null}
      <ul
        aria-label={data.title ? stripEmphasis(data.title) : blocksCopy.categoriesLabel}
        className="grid snap-x snap-mandatory auto-cols-[42%] grid-flow-col gap-3 overflow-x-auto overscroll-x-contain pb-2 sm:snap-none sm:auto-cols-auto sm:grid-flow-row sm:grid-cols-3 sm:overflow-visible sm:pb-0 md:grid-cols-4 lg:grid-cols-6 [&>li]:snap-start"
      >
        {tiles.map((c) => (
          <li key={c.id}>
            <Link href={c.href} className="group flex flex-col gap-2.5">
              <span className="relative block aspect-square overflow-hidden rounded-shop bg-shop-sunken">
                {c.image ? (
                  <ShopImg image={{ ...c.image, alt: "" }} fill sizes="(min-width: 1024px) 220px, (min-width: 768px) 25vw, (min-width: 640px) 33vw, 42vw" className="transition duration-500 group-hover:scale-[1.04]" />
                ) : null}
              </span>
              <span className="flex flex-col">
                <span className="text-[0.95rem] leading-snug font-semibold text-shop-ink group-hover:text-shop-primary">{c.title}</span>
                <span className="text-sm text-shop-muted">{blocksCopy.items(c.productCount)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Container>
  );
}

export function NewsletterBlock({ data, ctx }: { data: BlockData<"NEWSLETTER_SIGNUP">; ctx: BlockContext }) {
  if (!ctx.newsletterEnabled) return null;
  // data-newsletter-block: the footer hides its own sign-up strip on pages that have this block.
  return (
    <Container data-newsletter-block="">
      <div className="flex flex-col gap-6 rounded-shop border border-shop-line bg-shop-surface p-6 sm:p-10 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex max-w-[520px] flex-col gap-1.5">
          <h2 className="text-[1.75rem] leading-[1.1] tracking-[-0.02em] text-shop-ink">{emphasis(data.title)}</h2>
          {data.text ? <p className="text-shop-muted">{data.text}</p> : null}
        </div>
        <NewsletterForm source="block" className="w-full lg:max-w-[520px] lg:flex-[1_1_380px]" />
      </div>
    </Container>
  );
}

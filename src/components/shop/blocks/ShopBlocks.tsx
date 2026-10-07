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
import { blocksCopy } from "./_copy";

export async function TextProductBlock({ data, ctx }: { data: BlockData<"TEXT_PRODUCT">; ctx: BlockContext }) {
  const rows = data.productId ? await getProductsByIds(ctx.tenantId, [data.productId]) : [];
  const reserved = await liveReservedIds(ctx.tenantId, rows.map((r) => r.id));
  const product = rows[0] ? toProductCardData(rows[0], { ...ctx.card, reservedIds: reserved }) : null;
  return (
    <Container className="grid items-center gap-8 md:grid-cols-12 md:gap-14">
      <div className="md:col-span-7">
        {data.title ? <h2 className="mb-5 text-3xl text-shop-ink">{data.title}</h2> : null}
        <Markdown source={data.markdown} />
        {product ? (
          <Link href={product.href} className="mt-6 inline-flex text-sm font-medium text-shop-primary underline-offset-4 hover:underline">
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
    <Container size="wide">
      {data.title || data.cta ? <SectionHeading title={data.title || "New arrivals"} action={data.cta ? { label: data.cta.label, href: data.cta.href } : null} /> : null}
      {products.length ? (
        <ProductGrid products={products} columns={ctx.gridColumns} showStockCode={ctx.showStockCode} priorityCount={priority ? ctx.gridColumns : 0} />
      ) : (
        <EmptyState title={blocksCopy.newItemsEmpty} />
      )}
    </Container>
  );
}

export async function CategoriesBlock({ data, ctx }: { data: BlockData<"CATEGORIES">; ctx: BlockContext }) {
  const tiles = await getCategoryTiles(ctx.tenantId, data.categoryIds);
  if (!tiles.length) return null;
  return (
    <Container size="wide">
      {data.title ? <SectionHeading title={data.title} /> : null}
      <ul aria-label={data.title || blocksCopy.categoriesLabel} tabIndex={0} className="shop-rail auto-cols-[62%] gap-4 pb-3 sm:auto-cols-[38%] lg:auto-cols-[calc((100%-3rem)/4)]">
        {tiles.map((c) => (
          <li key={c.id}>
            <Link href={c.href} className="group relative block aspect-[3/4] overflow-hidden rounded-shop bg-shop-primary text-white">
              {c.image ? <ShopImg image={{ ...c.image, alt: "" }} fill sizes="(min-width: 1024px) 25vw, 60vw" className="opacity-90 transition duration-500 group-hover:scale-[1.04] group-hover:opacity-100" /> : null}
              <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-transparent" />
              <span className="absolute inset-x-0 bottom-0 p-4">
                <span className="block font-shop-heading text-xl leading-tight sm:text-2xl">{c.title}</span>
                <span className="mt-1 block text-xs tracking-[0.12em] uppercase opacity-80">{blocksCopy.items(c.productCount)}</span>
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
  return (
    <Container size="narrow">
      <div className="rounded-shop border border-shop-line bg-shop-surface px-6 py-10 text-center sm:px-12">
        <h2 className="text-3xl text-shop-ink">{data.title}</h2>
        {data.text ? <p className="mx-auto mt-3 max-w-md text-shop-muted">{data.text}</p> : null}
        <NewsletterForm source="block" className="mx-auto mt-6 max-w-md text-left" />
      </div>
    </Container>
  );
}

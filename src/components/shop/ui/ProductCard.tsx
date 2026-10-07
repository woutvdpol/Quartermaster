import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "./Badge";
import { cn } from "./cn";
import { Price } from "./Price";
import { LockedImg, ShopImg } from "./ShopImg";
import type { DisplayCurrency, ProductCardData } from "./types";
import { uiCopy } from "./_copy";

/**
 * Product tile for grids and rails. Server component (no client JS); interactive bits go in slots:
 * `wishlistSlot` is rendered over the image's top-right corner (e.g. the account agent's heart
 * button). Sold items are dimmed; locked (sensitive, guest) items show only a blurred placeholder.
 */
export function ProductCard({
  product,
  wishlistSlot,
  priority,
  display,
  showStockCode = false,
  headingLevel = 3,
  sizes,
  className,
}: {
  product: ProductCardData;
  wishlistSlot?: ReactNode;
  /** Eager-load the image (first row above the fold). */
  priority?: boolean;
  display?: DisplayCurrency | null;
  showStockCode?: boolean;
  headingLevel?: 2 | 3 | 4;
  sizes?: string;
  className?: string;
}) {
  const H = `h${headingLevel}` as "h2" | "h3" | "h4";
  const sold = product.availability === "sold";
  return (
    <article className={cn("group relative flex flex-col", className)}>
      <div className="relative aspect-[4/5] overflow-hidden rounded-shop bg-shop-sunken">
        {product.locked ? (
          <>
            <LockedImg blurDataUrl={product.image?.blurDataUrl ?? null} />
            <div className="absolute inset-0 grid place-items-center p-4 text-center">
              <span className="rounded-shop-sm bg-shop-surface/90 px-3 py-1.5 text-xs font-semibold tracking-wide text-shop-ink uppercase shadow-shop">
                {uiCopy.product.locked}
              </span>
            </div>
          </>
        ) : product.image ? (
          <ShopImg
            image={product.image}
            fill
            priority={priority}
            sizes={sizes}
            className={cn("transition-transform duration-500 ease-out group-hover:scale-[1.03]", sold && "opacity-70 grayscale-[35%]")}
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-xs tracking-widest text-shop-muted uppercase">{uiCopy.product.noImage}</div>
        )}
        <div className="pointer-events-none absolute top-2 left-2 flex flex-col items-start gap-1">
          {sold ? <Badge tone="sold">{uiCopy.product.sold}</Badge> : null}
          {product.availability === "reserved" ? <Badge tone="reserved">{uiCopy.product.reserved}</Badge> : null}
          {product.onSale && !sold ? <Badge tone="accent">{uiCopy.product.sale}</Badge> : null}
        </div>
        {wishlistSlot ? <div className="absolute top-2 right-2 z-10">{wishlistSlot}</div> : null}
      </div>
      <div className="mt-3 flex flex-1 flex-col gap-1">
        {product.eyebrow || showStockCode ? (
          <p className="truncate text-[0.7rem] font-medium tracking-[0.1em] text-shop-muted uppercase">
            {[product.eyebrow, showStockCode ? `${uiCopy.product.stockCode} ${product.stockCode}` : null].filter(Boolean).join(" · ")}
          </p>
        ) : null}
        <H className="line-clamp-2 font-shop-body text-[0.95rem] leading-snug font-medium text-shop-ink">
          {/* Stretched link: the whole card is clickable, slots stay above it (z-10). */}
          <Link href={product.href} className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none group-has-[:focus-visible]:underline">
            {product.title}
          </Link>
        </H>
        <div className="mt-auto pt-1">
          {product.showPrice ? (
            <Price cents={product.priceCents} currency={product.currency} display={display} size="sm" className={cn(sold && "opacity-70")} />
          ) : (
            <span className="text-sm text-shop-muted">{uiCopy.product.sold}</span>
          )}
        </div>
      </div>
    </article>
  );
}

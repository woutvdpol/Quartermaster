import type { ReactNode } from "react";
import { Badge } from "./Badge";
import { cn } from "./cn";
import { IntentLink } from "./IntentLink";
import { formatIndicative } from "./money";
import { Price } from "./Price";
import { LockedImg, ShopImg } from "./ShopImg";
import type { DisplayCurrency, ProductCardData } from "./types";
import { uiCopies } from "./_copy";
import { pickCopy } from "@/lib/i18n/shop-copy";
import type { ShopLocale } from "@/lib/i18n/shop-locales";

/**
 * Product tile for grids and rails. Server component (no client JS); interactive bits go in slots:
 * Layout (theme gallery): image, then "No. 50212 · Category" in the mono face (stock number in the
 * accent colour), then title and price on one row. `wishlistSlot` is rendered over the image's top-right corner (e.g. the account agent's heart
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
  locale,
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
  /** Shop language (copy and price format). */
  locale: ShopLocale;
}) {
  const uiCopy = pickCopy(uiCopies, locale);
  const H = `h${headingLevel}` as "h2" | "h3" | "h4";
  const sold = product.availability === "sold";
  const indicative =
    product.showPrice && display && display.currency !== product.currency
      ? formatIndicative(product.priceCents, product.currency, display.currency, display.rate, locale)
      : null;
  return (
    <article className={cn("group relative flex flex-col", className)}>
      <div className="relative aspect-[4/5] overflow-hidden rounded-shop bg-shop-sunken">
        {product.locked ? (
          <>
            <LockedImg blurDataUrl={product.image?.blurDataUrl ?? null} />
            <div className="absolute inset-0 grid place-items-center p-4 text-center">
              <span className="rounded-shop-control bg-shop-surface px-3 py-1.5 text-xs font-semibold text-shop-ink shadow-shop">
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
            className={cn("transition-transform duration-500 ease-out group-hover:scale-[1.03]", sold && "opacity-60 grayscale-[40%]")}
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-xs text-shop-muted">{uiCopy.product.noImage}</div>
        )}
        <div className="pointer-events-none absolute top-3 left-3 flex flex-col items-start gap-1">
          {sold ? <Badge tone="sold">{uiCopy.product.sold}</Badge> : null}
          {product.availability === "reserved" ? <Badge tone="reserved">{uiCopy.product.reserved}</Badge> : null}
          {product.onSale && !sold ? <Badge tone="accent">{uiCopy.product.sale}</Badge> : null}
        </div>
        {wishlistSlot ? <div className="absolute top-3 right-3 z-10">{wishlistSlot}</div> : null}
      </div>
      <div className="mt-3 flex flex-1 flex-col gap-1">
        {showStockCode || product.eyebrow ? (
          <p className="flex min-w-0 items-baseline gap-2 font-shop-mono text-xs text-shop-muted">
            {showStockCode ? (
              <span className="shrink-0 text-shop-accent">
                {uiCopy.product.stockCode} {product.stockCode}
              </span>
            ) : null}
            {product.eyebrow ? <span className="truncate">{product.eyebrow}</span> : null}
          </p>
        ) : null}
        <div className="flex items-start justify-between gap-3">
          <H className="line-clamp-2 font-shop-body text-[0.97rem] leading-snug font-medium tracking-normal text-shop-ink">
            {/* Stretched link: the whole card is clickable, slots stay above it (z-10). */}
            <IntentLink href={product.href} className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none group-has-[:focus-visible]:underline">
              {product.title}
            </IntentLink>
          </H>
          {product.showPrice ? (
            <Price cents={product.priceCents} currency={product.currency} display={null} size="sm" locale={locale} className={cn("shrink-0 [&>span:first-child]:font-bold", sold && "opacity-60")} />
          ) : sold && product.soldLabel ? null : (
            <span className="shrink-0 text-sm text-shop-muted">{uiCopy.product.sold}</span>
          )}
        </div>
        {sold && product.soldLabel ? <p className="text-sm text-shop-muted">{product.soldLabel}</p> : null}
        {indicative ? (
          <p className="text-xs text-shop-muted tabular-nums" title={uiCopy.price.indicativeTitle}>
            ≈ {indicative} · {uiCopy.price.indicative}
          </p>
        ) : null}
      </div>
    </article>
  );
}

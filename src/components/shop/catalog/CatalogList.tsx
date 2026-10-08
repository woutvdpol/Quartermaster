import { Badge, LockedImg, Price, ShopImg, cn, type DisplayCurrency, type ProductCardData } from "@/components/shop/ui";
import { IntentLink } from "@/components/shop/ui/IntentLink";
import { uiCopy } from "@/components/shop/ui/_copy";
import { catalogCopy as copy } from "./_copy";

/**
 * List layout (settings.catalog.layout = "list"): image left, details right. Server component.
 * Same type scale as ProductCard: "No. 50212 · Category" in the mono face (number in the accent colour),
 * title, status badges, price.
 */
export function CatalogList({
  products,
  showStockCode,
  display = null,
}: {
  products: ProductCardData[];
  showStockCode?: boolean;
  display?: DisplayCurrency | null;
}) {
  return (
    <ul role="list" className="flex flex-col divide-y divide-shop-line border-b border-shop-line">
      {products.map((p, i) => {
        const sold = p.availability === "sold";
        return (
          <li key={p.id} className="group relative flex gap-4 py-5 sm:gap-7 sm:py-6">
            <div className="relative aspect-[4/5] w-28 shrink-0 overflow-hidden rounded-shop bg-shop-sunken sm:w-40">
              {p.locked ? (
                <LockedImg blurDataUrl={p.image?.blurDataUrl ?? null} />
              ) : p.image ? (
                <ShopImg
                  image={p.image}
                  fill
                  priority={i < 2}
                  sizes="(min-width: 640px) 160px, 112px"
                  className={cn("transition-transform duration-500 ease-out group-hover:scale-[1.03]", sold && "opacity-60 grayscale-[40%]")}
                />
              ) : null}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
              <div className="flex min-w-0 flex-col gap-1.5">
                {p.eyebrow || showStockCode ? (
                  <p className="flex min-w-0 items-baseline gap-2 font-shop-mono text-xs text-shop-muted">
                    {showStockCode ? (
                      <span className="shrink-0 text-shop-accent">
                        {uiCopy.product.stockCode} {p.stockCode}
                      </span>
                    ) : null}
                    {p.eyebrow ? <span className="truncate">{p.eyebrow}</span> : null}
                  </p>
                ) : null}
                <h3 className="font-shop-body text-base leading-snug font-medium tracking-normal text-shop-ink sm:text-lg">
                  <IntentLink href={p.href} className="underline-offset-4 after:absolute after:inset-0 after:content-[''] group-hover:underline">
                    {p.title}
                  </IntentLink>
                </h3>
                <div className="flex flex-wrap items-center gap-2 empty:hidden">
                  {sold ? <Badge tone="sold">{copy.product.status.sold}</Badge> : null}
                  {p.availability === "reserved" ? <Badge tone="reserved">{copy.product.status.reserved}</Badge> : null}
                  {p.onSale && !sold ? <Badge tone="accent">{copy.product.sale}</Badge> : null}
                  {p.locked ? <Badge>{copy.product.lockedCta}</Badge> : null}
                </div>
              </div>
              <div className="mt-auto pt-1 sm:mt-0 sm:shrink-0 sm:pt-0 sm:text-right">
                {p.showPrice ? (
                  <Price cents={p.priceCents} currency={p.currency} display={display} size="lg" className={cn("[&>span:first-child]:font-bold", sold && "opacity-60")} />
                ) : (
                  <span className="text-sm text-shop-muted">{copy.product.priceHidden}</span>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

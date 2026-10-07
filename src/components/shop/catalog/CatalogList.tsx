import Link from "next/link";
import { Badge, LockedImg, Price, ShopImg, cn, type DisplayCurrency, type ProductCardData } from "@/components/shop/ui";
import { catalogCopy as copy } from "./_copy";

/** List layout (settings.catalog.layout = "list"): image left, details right. Server component. */
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
    <ul role="list" className="flex flex-col divide-y divide-shop-line border-y border-shop-line">
      {products.map((p, i) => {
        const sold = p.availability === "sold";
        return (
          <li key={p.id} className="group relative flex gap-4 py-4 sm:gap-6">
            <div className="relative aspect-square w-28 shrink-0 overflow-hidden rounded-shop bg-shop-sunken sm:w-40">
              {p.locked ? (
                <LockedImg blurDataUrl={p.image?.blurDataUrl ?? null} />
              ) : p.image ? (
                <ShopImg image={p.image} fill priority={i < 2} sizes="160px" className={cn(sold && "opacity-70 grayscale-[35%]")} />
              ) : null}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              {p.eyebrow || showStockCode ? (
                <p className="truncate text-[0.7rem] font-medium tracking-[0.1em] text-shop-muted uppercase">
                  {[p.eyebrow, showStockCode ? copy.product.stockCode(p.stockCode) : null].filter(Boolean).join(" · ")}
                </p>
              ) : null}
              <h3 className="font-shop-body text-base leading-snug font-medium text-shop-ink sm:text-lg">
                <Link href={p.href} className="after:absolute after:inset-0 after:content-[''] hover:underline underline-offset-4">
                  {p.title}
                </Link>
              </h3>
              <div className="flex flex-wrap items-center gap-2">
                {sold ? <Badge tone="sold">{copy.product.status.sold}</Badge> : null}
                {p.availability === "reserved" ? <Badge tone="reserved">{copy.product.status.reserved}</Badge> : null}
                {p.locked ? <Badge>{copy.product.lockedCta}</Badge> : null}
              </div>
              <div className="mt-auto pt-2">
                {p.showPrice ? <Price cents={p.priceCents} currency={p.currency} display={display} size="md" /> : <span className="text-sm text-shop-muted">{copy.product.priceHidden}</span>}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

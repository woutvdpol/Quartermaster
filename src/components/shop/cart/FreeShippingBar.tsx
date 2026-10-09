import { formatMoney } from "@/components/shop/ui/money";
import { pickCopy } from "@/lib/i18n/shop-copy";
import type { ShopLocale } from "@/lib/i18n/shop-locales";
import { cartCopies } from "./_copy";

/** "Add €12.50 more for free shipping" with a progress bar. */
export function FreeShippingBar({
  progress,
  currency,
  locale,
}: {
  progress: { threshold: number; remaining: number; reached: boolean };
  currency: string;
  locale: ShopLocale;
}) {
  const t = pickCopy(cartCopies, locale).cart;
  const pct = Math.min(100, Math.round(((progress.threshold - progress.remaining) / progress.threshold) * 100));
  const label = progress.reached ? t.freeShippingReached : t.freeShippingProgress(formatMoney(progress.remaining, currency, locale));
  return (
    <div className="flex flex-col gap-1.5">
      <p className={progress.reached ? "text-sm font-medium text-shop-ok" : "text-sm text-shop-ink-2"}>{label}</p>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="h-1.5 w-full overflow-hidden rounded-shop-control bg-shop-line"
      >
        <div className={progress.reached ? "h-full rounded-shop-control bg-shop-ok" : "h-full rounded-shop-control bg-shop-primary"} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

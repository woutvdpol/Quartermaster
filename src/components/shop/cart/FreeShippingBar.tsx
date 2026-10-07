import { formatMoney } from "@/components/shop/ui/money";
import { cartCopy } from "./_copy";

/** "Add €12.50 more for free shipping" with a progress bar. */
export function FreeShippingBar({ progress, currency }: { progress: { threshold: number; remaining: number; reached: boolean }; currency: string }) {
  const pct = Math.min(100, Math.round(((progress.threshold - progress.remaining) / progress.threshold) * 100));
  const label = progress.reached ? cartCopy.cart.freeShippingReached : cartCopy.cart.freeShippingProgress(formatMoney(progress.remaining, currency));
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

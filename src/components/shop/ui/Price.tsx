import { cn } from "./cn";
import { formatIndicative, formatMoney } from "./money";
import type { DisplayCurrency } from "./types";
import { uiCopy } from "./_copy";

/**
 * A price in the shop currency, with an optional indicative conversion:
 *   €1,450.00  ≈ £1,262 · indicative
 * The conversion only renders when `display` has a positive rate (there is no rates source yet, so
 * callers pass null/undefined and it stays off). Checkout is always in the shop currency.
 */
export function Price({
  cents,
  currency,
  display,
  compareAtCents,
  size = "md",
  className,
}: {
  cents: number;
  currency: string;
  display?: DisplayCurrency | null;
  /** Previous price, shown struck through (sale). */
  compareAtCents?: number | null;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const indicative = display && display.currency !== currency ? formatIndicative(cents, currency, display.currency, display.rate) : null;
  const sizes = { sm: "text-sm", md: "text-base", lg: "text-xl", xl: "text-3xl" } as const;
  return (
    <span className={cn("inline-flex flex-wrap items-baseline gap-x-2 gap-y-0.5", className)}>
      <span className={cn("font-semibold text-shop-ink tabular-nums", sizes[size], size === "xl" && "font-shop-heading")}>{formatMoney(cents, currency)}</span>
      {compareAtCents && compareAtCents > cents ? (
        <s className="text-sm text-shop-muted tabular-nums">
          <span className="sr-only">{uiCopy.price.was} </span>
          {formatMoney(compareAtCents, currency)}
        </s>
      ) : null}
      {indicative ? (
        <span className="text-xs text-shop-muted tabular-nums" title={uiCopy.price.indicativeTitle}>
          ≈ {indicative} · {uiCopy.price.indicative}
        </span>
      ) : null}
    </span>
  );
}

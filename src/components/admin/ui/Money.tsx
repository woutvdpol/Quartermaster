import { cx } from "./cx";
import { DEFAULT_CURRENCY, DEFAULT_FORMAT_LOCALE, formatMoney } from "./money-utils";

type MoneyProps = {
  /** Integer minor units (cents). null/undefined renders a muted dash. */
  amount: number | null | undefined;
  /** ISO currency, e.g. the tenant's or the order's currency. */
  currency?: string;
  locale?: string;
  /** "+€12.00" style for deltas/adjustments. */
  signed?: boolean;
  /** Monospace figures (design A uses mono for prices in tables). */
  mono?: boolean;
  className?: string;
};

/** Formatted amount with tabular figures. Server-component friendly. */
export function Money({ amount, currency = DEFAULT_CURRENCY, locale = DEFAULT_FORMAT_LOCALE, signed, mono, className }: MoneyProps) {
  if (amount === null || amount === undefined) {
    return <span className={cx("text-muted", className)}>—</span>;
  }
  return (
    <span className={cx("whitespace-nowrap tabular-nums", mono && "font-mono", amount < 0 && "text-crit", className)}>
      {formatMoney(amount, currency, locale, signed ? { signDisplay: "exceptZero" } : {})}
    </span>
  );
}

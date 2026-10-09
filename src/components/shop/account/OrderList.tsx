import Link from "@/components/shop/ui/Link";
import { Badge, type BadgeTone } from "@/components/shop/ui/Badge";
import { formatMoney } from "@/components/shop/ui/money";
import { orderStatusLabel, type CustomerOrderRow, type OrderStatusLabel } from "@/server/customer-auth/orders";
import { pickCopy } from "@/lib/i18n/shop-copy";
import type { ShopLocale } from "@/lib/i18n/shop-locales";
import { accountCopies } from "./_copy";
import { formatDate } from "./format";

const TONE: Record<OrderStatusLabel["tone"], BadgeTone> = { neutral: "neutral", success: "ok", warning: "warn", danger: "warn" };

/** Orders as a card list (phone) / table-like rows (desktop), each linking to the public status page. */
export function OrderList({ orders, timeZone, locale }: { orders: CustomerOrderRow[]; timeZone: string; locale: ShopLocale }) {
  const t = pickCopy(accountCopies, locale).orders;
  return (
    <ul className="divide-y divide-shop-line overflow-hidden rounded-shop border border-shop-line bg-shop-surface">
      {orders.map((o) => {
        const status = orderStatusLabel(o);
        return (
          <li key={o.uuid}>
            <Link
              href={`/order/${o.uuid}`}
              className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-4 py-4 transition-colors hover:bg-shop-sunken sm:grid-cols-[8rem_1fr_auto_auto] sm:px-6 sm:py-5"
            >
              <span className="font-semibold text-shop-ink tabular-nums">
                <span className="sr-only">{t.number} </span>#{o.number}
              </span>
              <span className="text-right font-semibold text-shop-ink tabular-nums sm:order-3">{formatMoney(o.total, o.currency, locale)}</span>
              <span className="min-w-0 text-sm text-shop-muted sm:order-2">
                <time dateTime={o.placedAt.toISOString()}>{formatDate(o.placedAt, timeZone, locale)}</time> · {t.items(o.itemCount)}
                {o.firstItemTitle ? <span className="block truncate text-shop-ink-2">{o.firstItemTitle}</span> : null}
              </span>
              <span className="justify-self-end sm:order-4">
                <Badge tone={TONE[status.tone]}>{t.statuses[status.key]}</Badge>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

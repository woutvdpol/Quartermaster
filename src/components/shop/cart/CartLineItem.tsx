import Link from "next/link";
import { cn } from "@/components/shop/ui/cn";
import { Badge } from "@/components/shop/ui/Badge";
import { formatMoney } from "@/components/shop/ui/money";
import { ReservationCountdown } from "./ReservationCountdown";
import { PendingButton } from "./PendingButton";
import { reReserveAction, removeFromCartAction } from "./actions";
import { cartCopy } from "./_copy";

const t = cartCopy.cart;

export type CartLineData = {
  productId: string;
  title: string;
  href: string;
  price: number;
  currency: string;
  imageUrl: string | null;
  imageAlt: string;
  blurDataUrl: string | null;
  /** Sensitive item and the visitor is a guest: only the blurred placeholder is shown. */
  locked: boolean;
  state: "held" | "lapsed" | "taken" | "unavailable";
  expiresAt: string | null;
  takenMinutes: number | null;
};

/** One cart row (server component; remove / re-add are plain forms → work without JS). */
export function CartLineItem({ line, compact = false }: { line: CartLineData; compact?: boolean }) {
  const dim = line.state === "unavailable" || line.state === "taken";
  return (
    <li className="flex gap-3 py-4 sm:gap-4">
      <Link
        href={line.href}
        className={cn("relative block shrink-0 overflow-hidden rounded-shop-sm bg-shop-sunken", compact ? "size-16" : "size-20 sm:size-24", dim && "opacity-60")}
        tabIndex={-1}
        aria-hidden="true"
      >
        {line.locked ? (
          <span
            className="absolute inset-0 scale-110 bg-cover bg-center blur-md"
            style={line.blurDataUrl ? { backgroundImage: `url("${line.blurDataUrl}")` } : undefined}
          />
        ) : line.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- pre-generated thumb variant
          <img src={line.imageUrl} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
        ) : null}
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-start justify-between gap-3">
          <Link href={line.href} className={cn("font-medium text-shop-ink hover:underline", dim && "text-shop-muted")}>
            {line.title}
          </Link>
          <span className={cn("shrink-0 font-semibold tabular-nums", dim ? "text-shop-muted line-through" : "text-shop-ink")}>
            {formatMoney(line.price, line.currency)}
          </span>
        </div>

        {line.state === "held" && line.expiresAt ? <ReservationCountdown expiresAt={line.expiresAt} className="self-start" /> : null}
        {line.state === "lapsed" ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone="warn">{t.lapsed}</Badge>
            <span className="text-shop-muted">{t.lapsedHint}</span>
            {/* compact = inside the checkout form (no nested forms); placing the order re-reserves it */}
            {!compact ? (
              <form action={reReserveAction}>
                <input type="hidden" name="productId" value={line.productId} />
                <PendingButton variant="outline" size="sm">
                  {t.reAdd}
                </PendingButton>
              </form>
            ) : null}
          </div>
        ) : null}
        {line.state === "taken" ? (
          <p className="text-sm text-shop-warn">
            {t.taken}
            {line.takenMinutes ? <span className="text-shop-muted"> — {t.takenHint(line.takenMinutes)}</span> : null}
          </p>
        ) : null}
        {line.state === "unavailable" ? <Badge tone="sold" className="self-start">{t.unavailable}</Badge> : null}

        {!compact ? (
          <form action={removeFromCartAction} className="mt-auto">
            <input type="hidden" name="productId" value={line.productId} />
            <PendingButton variant="link" size="sm" aria-label={t.removeLabel(line.title)} pendingLabel={t.removing} className="text-shop-muted! text-sm">
              {t.remove}
            </PendingButton>
          </form>
        ) : null}
      </div>
    </li>
  );
}

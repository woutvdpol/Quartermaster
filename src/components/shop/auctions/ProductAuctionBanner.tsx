import { ButtonLink } from "@/components/shop/ui/Button";
import { formatBidMoney } from "./lib/money";
import { pickCopy, formatShopDate } from "@/lib/i18n/shop-copy";
import type { ShopLocale } from "@/lib/i18n/shop-locales";
import { ServerClock } from "./AuctionLive";
import { Countdown } from "./Countdown";
import { auctionCopies } from "./_copy";

export type ProductAuctionLot = {
  auctionTitle: string;
  lotNumber: number;
  href: string;
  opensAt: string;
  closesAt: string;
  /** Current bid, or the start price before the first bid (minor units). */
  price: number;
  bidCount: number;
  /** Server time at render (ISO) for the countdown. */
  serverTime: string;
};

/**
 * Product page, piece held for an auction (Product.auctionHoldId): "This piece is in [Auction] as
 * Lot N — Bid now" instead of the buy box. The product page stays reachable; buying happens on the lot.
 */
export function ProductAuctionBanner({ lot, currency, locale, timeZone }: { lot: ProductAuctionLot; currency: string; locale: ShopLocale; timeZone: string }) {
  const t = pickCopy(auctionCopies, locale);
  const renderedAt = Date.parse(lot.serverTime);
  const upcoming = Date.parse(lot.opensAt) > renderedAt;
  return (
    <section aria-label={t.nav} className="flex flex-col gap-4 rounded-shop border border-shop-line-strong bg-shop-sunken p-5">
      <p className="text-base font-semibold text-shop-ink">{t.productBanner.title(lot.auctionTitle, lot.lotNumber)}</p>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-shop-ink-2">
          {upcoming
            ? t.productBanner.upcoming(formatShopDate(lot.opensAt, locale, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }, timeZone))
            : t.productBanner.current(formatBidMoney(lot.price, currency, locale), lot.bidCount ? t.bids(lot.bidCount) : t.noBids)}
        </p>
        {!upcoming ? (
          <p className="flex flex-col text-right">
            <span className="text-xs text-shop-muted">{t.productBanner.closes}</span>
            <ServerClock serverTime={lot.serverTime}>
              <Countdown until={lot.closesAt} renderedAt={renderedAt} className="text-xl font-semibold" />
            </ServerClock>
          </p>
        ) : null}
      </div>
      <ButtonLink href={lot.href} size="lg" fullWidth>
        {t.productBanner.cta}
      </ButtonLink>
    </section>
  );
}

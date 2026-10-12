"use client";

import { useShopCopy } from "@/components/shop/i18n/ShopLocale";
import { useLiveLots, useServerNow } from "./AuctionLive";
import { Countdown } from "./Countdown";
import { auctionCopies } from "./_copy";

/** Catalogue header clock: "Bidding opens in …" before opening, then "Lot N closes in …" for the next lot to close. */
export function NextClosing({ opensAt, renderedAt }: { opensAt: string; renderedAt: number }) {
  const t = useShopCopy(auctionCopies).catalogue;
  const lots = useLiveLots();
  const now = useServerNow(renderedAt);
  if (Date.parse(opensAt) > now) {
    return (
      <>
        <span className="text-sm text-shop-muted">{t.opensIn}</span>
        <Countdown until={opensAt} renderedAt={renderedAt} className="text-[1.75rem] leading-tight font-semibold sm:text-[2rem]" />
      </>
    );
  }
  let next: { lotNumber: number; closesAt: string } | null = null;
  for (const l of Object.values(lots)) {
    if (l.status !== "OPEN" || Date.parse(l.closesAt) <= now) continue;
    if (!next || l.closesAt < next.closesAt || (l.closesAt === next.closesAt && l.lotNumber < next.lotNumber)) next = l;
  }
  if (!next) return <span className="text-base font-semibold text-shop-ink-2">{t.allClosed}</span>;
  return (
    <>
      <span className="text-sm text-shop-muted">{t.lotClosesIn(next.lotNumber)}</span>
      <Countdown until={next.closesAt} renderedAt={renderedAt} className="text-[1.75rem] leading-tight font-semibold sm:text-[2rem]" />
    </>
  );
}

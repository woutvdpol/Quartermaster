"use client";

import Link from "@/components/shop/ui/Link";
import { formatBidMoney } from "./lib/money";
import { LockedImg, ShopImg } from "@/components/shop/ui/ShopImg";
import { cn } from "@/components/shop/ui/cn";
import type { ShopImage } from "@/components/shop/ui/types";
import { useShopCopy, useShopLocale } from "@/components/shop/i18n/ShopLocale";
import { useExtendedFlash, useServerNow } from "./AuctionLive";
import { Countdown } from "./Countdown";
import { displayPrice } from "./lib/bid-rules";
import { CHIP_TONE, lotChip, type ChipTone, type Viewer } from "./lib/status";
import type { LiveLot } from "./lib/types";
import { auctionCopies } from "./_copy";

/** Card image prepared on the server: `locked` = sensitive item for a guest (no real URL is sent). */
export type LotCardImage = { image: ShopImage | null; locked: boolean };

export const CHIP_CLASS: Record<ChipTone, string> = {
  ok: "bg-shop-ok-soft text-shop-ok",
  warn: "bg-shop-warn-soft text-shop-warn",
  sold: "bg-shop-ink text-shop-bg",
  neutral: "bg-shop-surface text-shop-ink-2",
  primary: "bg-shop-primary text-shop-on-primary",
};

/** Catalogue tile (design "Catalogue"): photo with lot number + status chip, stock number, title, price, bids, closes-in. */
export function LotCard({
  lot,
  href,
  image,
  viewer,
  opensAt,
  currency,
  renderedAt,
  priority = false,
}: {
  lot: LiveLot;
  href: string;
  image: LotCardImage;
  viewer: Viewer;
  opensAt: string;
  currency: string;
  renderedAt: number;
  priority?: boolean;
}) {
  const t = useShopCopy(auctionCopies);
  const locale = useShopLocale();
  const now = useServerNow(renderedAt, 5_000);
  const extended = useExtendedFlash(lot.id);
  const chip = lotChip(lot, viewer, now, opensAt);
  const open = lot.status === "OPEN" && chip !== "closing";
  return (
    <Link href={href} className="group flex min-w-0 flex-col gap-1.5 text-shop-ink">
      <span className="relative block aspect-[4/5] overflow-hidden rounded-shop-sm bg-shop-sunken">
        {image.image && !image.locked ? (
          <ShopImg image={image.image} fill priority={priority} sizes="(min-width: 1024px) 18rem, (min-width: 640px) 33vw, 50vw" className="transition-transform duration-300 group-hover:scale-[1.02]" />
        ) : image.locked ? (
          <LockedImg blurDataUrl={image.image?.blurDataUrl ?? null} />
        ) : (
          <span className="grid h-full place-items-center text-xs text-shop-muted">{t.noPhoto}</span>
        )}
        <span className="absolute top-2 left-2 rounded-shop-control border border-shop-line bg-shop-surface px-2.5 py-0.5 text-xs font-semibold">{t.lot(lot.lotNumber)}</span>
        <span className={cn("absolute top-2 right-2 rounded-shop-control px-2.5 py-0.5 text-xs font-semibold", CHIP_CLASS[CHIP_TONE[chip]])}>{t.chips[chip]}</span>
      </span>
      <span className="mt-1 font-shop-mono text-xs text-shop-accent">{t.stockCode(lot.stockCode)}</span>
      <span className="line-clamp-2 leading-snug font-medium group-hover:underline group-hover:underline-offset-4">{lot.title}</span>
      <span className="flex items-baseline justify-between gap-2 text-sm">
        <b className="tabular-nums">{formatBidMoney(displayPrice(lot), currency, locale)}</b>
        <span className="text-shop-muted">{lot.bidCount ? t.bids(lot.bidCount) : t.noBids}</span>
      </span>
      <span className={cn("font-shop-mono text-[0.8rem] text-shop-ink-2", extended && "text-shop-accent")}>
        {open ? <Countdown until={lot.closesAt} renderedAt={renderedAt} /> : t.chips[chip]}
      </span>
    </Link>
  );
}

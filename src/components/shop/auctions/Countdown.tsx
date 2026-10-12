"use client";

import { useShopCopy } from "@/components/shop/i18n/ShopLocale";
import { cn } from "@/components/shop/ui/cn";
import { useServerNow } from "./AuctionLive";
import { countdownUrgency, formatCountdown, remainingMs } from "./lib/clock";
import { auctionCopies } from "./_copy";

/**
 * Live countdown to `until` on the server clock (offset from the AuctionLiveProvider; device clock
 * otherwise). `renderedAt` = server ms at render time, so the server HTML and the first client render
 * agree. In the extension window (last 2 minutes) the text turns the accent colour.
 */
export function Countdown({ until, renderedAt, className, urgent = true }: { until: string; renderedAt: number; className?: string; urgent?: boolean }) {
  const t = useShopCopy(auctionCopies);
  const now = useServerNow(renderedAt);
  const ms = remainingMs(until, now, 0);
  const level = countdownUrgency(ms);
  return (
    <time
      dateTime={until}
      suppressHydrationWarning
      className={cn("font-shop-mono tabular-nums", urgent && level === "final" && "text-shop-accent", className)}
    >
      {formatCountdown(ms, t.dayUnit)}
    </time>
  );
}

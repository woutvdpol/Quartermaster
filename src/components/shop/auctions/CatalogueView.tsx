"use client";

import { useMemo, useState } from "react";
import { cn } from "@/components/shop/ui/cn";
import { useShopCopy } from "@/components/shop/i18n/ShopLocale";
import { useLiveLots, useLiveStatus } from "./AuctionLive";
import { LotCard, type LotCardImage } from "./LotCard";
import type { LiveLot } from "./lib/types";
import { auctionCopies } from "./_copy";

type Filter = "all" | "mine" | "watching" | `cat:${string}`;

/**
 * Catalogue body (design "Catalogue"): filter chips (All / My bids / Watching / categories) and the lot
 * grid, live from the AuctionLiveProvider. "My bids" = lots the viewer bid on or leads; "Watching" =
 * lots whose piece is on the viewer's wishlist. Both chips only for signed-in customers.
 */
export function CatalogueView({
  initialLots,
  hrefs,
  images,
  categories,
  viewer,
  opensAt,
  currency,
  renderedAt,
}: {
  initialLots: LiveLot[];
  /** Lot id → lot page path. */
  hrefs: Record<string, string>;
  /** Lot id → card image. */
  images: Record<string, LotCardImage>;
  /** Lot id → category (chips); lots without one only show under "All". */
  categories: Record<string, { slug: string; title: string } | null>;
  viewer: { bidderNumber: number | null; bidLotIds: string[]; watchedLotIds: string[] } | null;
  opensAt: string;
  currency: string;
  renderedAt: number;
}) {
  const t = useShopCopy(auctionCopies);
  const live = useLiveLots();
  const status = useLiveStatus();
  const [filter, setFilter] = useState<Filter>("all");
  const lots = useMemo(() => initialLots.map((l) => live[l.id] ?? l).filter((l) => l.status !== "CANCELLED"), [initialLots, live]);

  const bidSet = useMemo(() => new Set(viewer?.bidLotIds ?? []), [viewer]);
  const watchSet = useMemo(() => new Set(viewer?.watchedLotIds ?? []), [viewer]);
  const myNumber = viewer?.bidderNumber ?? null;
  const isMine = (l: LiveLot) => bidSet.has(l.id) || (myNumber !== null && l.leaderNumber === myNumber);

  const cats = useMemo(() => {
    const m = new Map<string, { slug: string; title: string; count: number }>();
    for (const l of lots) {
      const c = categories[l.id];
      if (!c) continue;
      const e = m.get(c.slug) ?? { ...c, count: 0 };
      e.count += 1;
      m.set(c.slug, e);
    }
    return [...m.values()].sort((a, b) => b.count - a.count).slice(0, 8);
  }, [lots, categories]);

  const shown = lots.filter((l) =>
    filter === "all" ? true : filter === "mine" ? isMine(l) : filter === "watching" ? watchSet.has(l.id) : categories[l.id]?.slug === filter.slice(4),
  );
  const chip = (active: boolean) =>
    cn(
      "inline-flex h-10 items-center rounded-shop-control border px-4 text-sm font-medium whitespace-nowrap transition-colors",
      active ? "border-shop-ink bg-shop-ink text-shop-bg" : "border-shop-line-strong bg-shop-surface text-shop-ink hover:border-shop-ink",
    );
  const chips: { key: Filter; label: string }[] = [
    { key: "all", label: t.catalogue.all(lots.length) },
    ...(viewer
      ? [
          { key: "mine" as const, label: t.catalogue.mine(lots.filter(isMine).length) },
          { key: "watching" as const, label: t.catalogue.watching(lots.filter((l) => watchSet.has(l.id)).length) },
        ]
      : []),
    ...(cats.length > 1 ? cats.map((c) => ({ key: `cat:${c.slug}` as const, label: c.title })) : []),
  ];

  return (
    <div className="flex flex-col gap-5">
      {status === "polling" ? <p className="rounded-shop-sm bg-shop-warn-soft px-3 py-2 text-sm text-shop-warn">{t.live.polling}</p> : null}
      <div className="flex items-center gap-3">
        <div role="group" aria-label={t.catalogue.filterLabel} className="-mx-4 flex min-w-0 gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0">
          {chips.map((c) => (
            <button key={c.key} type="button" aria-pressed={filter === c.key} className={chip(filter === c.key)} onClick={() => setFilter(c.key)}>
              {c.label}
            </button>
          ))}
        </div>
        <span className="ml-auto hidden shrink-0 text-sm text-shop-muted md:block">{t.catalogue.sorted}</span>
      </div>
      {shown.length ? (
        <ul role="list" className="grid grid-cols-2 gap-x-3 gap-y-7 sm:grid-cols-3 sm:gap-x-5 lg:grid-cols-4">
          {shown.map((l, i) => (
            <li key={l.id} className="min-w-0">
              <LotCard
                lot={l}
                href={hrefs[l.id]}
                image={images[l.id] ?? { image: null, locked: false }}
                viewer={viewer ? { bidderNumber: myNumber, hasBid: bidSet.has(l.id) } : null}
                opensAt={opensAt}
                currency={currency}
                renderedAt={renderedAt}
                priority={i < 2}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-10 text-center text-shop-muted">{t.catalogue.noMatch}</p>
      )}
    </div>
  );
}

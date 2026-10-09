import { ShopImg } from "@/components/shop/ui/ShopImg";
import { formatMoney } from "@/components/shop/ui/money";
import type { NetworkCard as NetworkCardData } from "@/server/network/service";
import { networkCopy as t } from "../_copy";

/*
 * One result (Network board): photo, stock no., title, price in the dealer's currency, dealer badge and
 * the absolute link into the dealer's own shop, where the buyer checks out. Server- and client-safe
 * (also used by the photo search results).
 */

export const CARD_SIZES = "(min-width: 1280px) 230px, (min-width: 1024px) 22vw, (min-width: 640px) 30vw, 46vw";

export function NetworkCard({ card, priority = false }: { card: NetworkCardData; priority?: boolean }) {
  return (
    <a
      href={card.href}
      className="group flex flex-col gap-1.5 rounded-xl border border-[#DEDCCF] bg-white p-2.5 pb-3.5 text-[#1E2119] hover:border-[#7E5416] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7E5416]"
    >
      <span className="relative block aspect-square overflow-hidden rounded-lg bg-[#ECECE5]">
        {card.image ? (
          <ShopImg image={card.image} fill sizes={CARD_SIZES} priority={priority} />
        ) : (
          <span className="absolute inset-0 grid place-items-center text-xs text-[#6B6E60]">{t.noImage}</span>
        )}
      </span>
      <span className="text-xs text-[#7A2420] [font-family:var(--nw-mono)]">{t.stockCode(card.stockCode)}</span>
      <span className="leading-snug font-medium">{card.title}</span>
      <span className="mt-auto flex items-center justify-between gap-2 pt-1">
        <b className="tabular-nums">{formatMoney(card.price, card.currency)}</b>
        <span className="truncate rounded-full bg-[#ECECE5] px-2.5 py-0.5 text-xs">{card.dealer.name}</span>
      </span>
      <span className="text-[13px] text-[#7E5416] group-hover:underline">{t.viewInShop}</span>
    </a>
  );
}

import { formatMoney } from "@/components/shop/ui/money";

/*
 * Notification texts (English, like the rest of the shop UI; pure). The notification itself shows the
 * shop's name as the sender (installed app / site name), so the texts don't repeat it.
 */

export const pushCopy = {
  newMatch: (p: { title: string; price: number; currency: string; searchName: string }) => ({
    title: `New: ${p.title} — ${formatMoney(p.price, p.currency)}`,
    body: `Matches your search “${p.searchName}”. Unique piece — add it to your cart to hold it for 15 minutes.`,
  }),
  priceDrop: (p: { title: string; oldPrice: number; newPrice: number; currency: string }) => ({
    title: "Price drop on your wishlist",
    body: `${p.title} is now ${formatMoney(p.newPrice, p.currency)} (was ${formatMoney(p.oldPrice, p.currency)}).`,
  }),
  reservationEnding: (p: { items: number; minutesLeft: number }) => ({
    title: "Your reservation ends soon",
    body: `${p.items === 1 ? "The item in your cart is" : `The ${p.items} items in your cart are`} held for ${
      p.minutesLeft <= 1 ? "about a minute" : `${p.minutesLeft} more minutes`
    }. Check out to keep ${p.items === 1 ? "it" : "them"}.`,
  }),
};

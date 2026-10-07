"use client";

import Link from "next/link";
import { cn } from "@/components/shop/ui/cn";
import { BagIcon, HeartIcon, UserIcon } from "./icons";
import { useHeaderCounts } from "./HeaderCounts";
import { MiniCart } from "./MiniCart";
import { layoutCopy } from "./_copy";

const t = layoutCopy.header;

function CountBadge({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <span
      aria-hidden="true"
      className="absolute top-0.5 right-0.5 grid h-[1.15rem] min-w-[1.15rem] place-items-center rounded-shop-control bg-shop-primary px-1 text-[0.65rem] leading-none font-bold text-shop-on-primary tabular-nums"
    >
      {n > 99 ? "99+" : n}
    </span>
  );
}

/**
 * Wishlist and account as round icon buttons, cart as a dark pill ("Cart · 2"), with live counts
 * (see HeaderCounts.tsx). The accessible names carry the counts; the visible text is decorative.
 * Hovering (or focusing) the cart button opens a preview of the cart (MiniCart).
 */
export function HeaderActions({ className }: { className?: string }) {
  const { counts } = useHeaderCounts();
  const item =
    "relative grid size-11 place-items-center rounded-shop-control text-shop-ink transition-colors hover:bg-shop-sunken";
  return (
    <div className={cn("flex items-center gap-0.5 sm:gap-1", className)}>
      <Link
        href="/wishlist"
        className={cn(item, "hidden sm:grid")}
        aria-label={
          counts.wishlist
            ? `${t.wishlist}, ${t.wishlistCount(counts.wishlist)}`
            : t.wishlist
        }
      >
        <HeartIcon />
        <CountBadge n={counts.wishlist} />
      </Link>
      <Link href="/account" className={item} aria-label={t.account}>
        <UserIcon />
      </Link>
      <MiniCart>
        <Link
          href="/cart"
          className="ml-1 flex h-11 items-center gap-2 rounded-shop-control bg-shop-ink px-3.5 text-sm font-semibold whitespace-nowrap text-shop-bg transition-opacity hover:opacity-90 sm:px-4"
          aria-label={
            counts.cart ? `${t.cart}, ${t.cartCount(counts.cart)}` : t.cart
          }
        >
          <BagIcon className="size-[1.15rem]" />
          <span aria-hidden="true" className="hidden sm:inline">
            {t.cart}
          </span>
          {counts.cart > 0 ? (
            <span aria-hidden="true" className="tabular-nums">
              <span className="hidden sm:inline">· </span>
              {counts.cart > 99 ? "99+" : counts.cart}
            </span>
          ) : null}
        </Link>
      </MiniCart>
    </div>
  );
}

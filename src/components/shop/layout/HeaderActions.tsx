"use client";

import Link from "next/link";
import { cn } from "@/components/shop/ui/cn";
import { BagIcon, HeartIcon, UserIcon } from "./icons";
import { useHeaderCounts } from "./HeaderCounts";
import { layoutCopy } from "./_copy";

const t = layoutCopy.header;

function CountBadge({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <span
      aria-hidden="true"
      className="absolute -top-1 -right-1 grid h-[1.15rem] min-w-[1.15rem] place-items-center rounded-full bg-shop-accent px-1 text-[0.65rem] leading-none font-bold text-shop-on-accent tabular-nums"
    >
      {n > 99 ? "99+" : n}
    </span>
  );
}

/** Wishlist, account and cart links with live counts (see HeaderCounts.tsx). */
export function HeaderActions({ className }: { className?: string }) {
  const { counts } = useHeaderCounts();
  const item = "relative grid size-10 place-items-center rounded-full hover:bg-shop-on-primary/10";
  return (
    <div className={cn("flex items-center gap-0.5 sm:gap-1", className)}>
      <Link href="/wishlist" className={cn(item, "hidden sm:grid")} aria-label={counts.wishlist ? `${t.wishlist}, ${t.wishlistCount(counts.wishlist)}` : t.wishlist}>
        <HeartIcon />
        <CountBadge n={counts.wishlist} />
      </Link>
      <Link href="/account" className={item} aria-label={t.account}>
        <UserIcon />
      </Link>
      <Link href="/cart" className={item} aria-label={counts.cart ? `${t.cart}, ${t.cartCount(counts.cart)}` : t.cart}>
        <BagIcon />
        <CountBadge n={counts.cart} />
      </Link>
    </div>
  );
}

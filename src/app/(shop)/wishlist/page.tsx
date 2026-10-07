import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { accountCopy } from "@/components/shop/account/_copy";
import { AccountShell } from "@/components/shop/account/AccountShell";
import { formatDate } from "@/components/shop/account/format";
import { WishlistButton } from "@/components/shop/account/WishlistButton";
import { Badge } from "@/components/shop/ui/Badge";
import { ButtonLink } from "@/components/shop/ui/Button";
import { EmptyState } from "@/components/shop/ui/EmptyState";
import { Price } from "@/components/shop/ui/Price";
import { ProductGridSkeleton } from "@/components/shop/ui/Skeleton";
import { cn } from "@/components/shop/ui/cn";
import { requireShopCustomer } from "@/server/customer-auth";
import { listWishlist } from "@/server/wishlist";

const t = accountCopy.wishlist;

export const metadata: Metadata = { title: t.title, robots: { index: false, follow: false } };

export default function WishlistPage() {
  return (
    <AccountShell active="wishlist" title={t.title}>
      <p className="-mt-3 mb-6 text-shop-muted">{t.intro}</p>
      <Suspense fallback={<ProductGridSkeleton count={6} columns={3} />}>
        <Wishlist />
      </Suspense>
    </AccountShell>
  );
}

async function Wishlist() {
  const c = await requireShopCustomer("/wishlist");
  const items = await listWishlist({ tenantId: c.tenant.id, customerId: c.customer.id });
  if (!items.length) {
    return (
      <EmptyState
        title={t.empty}
        action={
          <ButtonLink href="/" variant="primary">
            {t.browse}
          </ButtonLink>
        }
      >
        {t.emptyHint}
      </EmptyState>
    );
  }
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-8 sm:gap-x-6 lg:grid-cols-3">
      {items.map((it) => {
        const href = `/product/${it.stockCode}/${it.slug}`;
        const sold = it.availability === "sold";
        return (
          <li key={it.productId} className="relative flex flex-col gap-2">
            <Link href={href} className="group block overflow-hidden rounded-shop border border-shop-line bg-shop-sunken">
              <div className="relative aspect-[4/5]">
                {it.image ? (
                  <Image
                    src={it.image.url}
                    alt={it.image.alt ?? it.title}
                    fill
                    sizes="(min-width: 1024px) 300px, 50vw"
                    unoptimized
                    className={cn("object-cover transition-transform group-hover:scale-[1.02]", sold && "grayscale")}
                  />
                ) : (
                  <span className="absolute inset-0 grid place-items-center text-sm text-shop-muted">—</span>
                )}
                <span className="absolute top-2 left-2">
                  {it.availability === "sold" ? <Badge tone="sold">{t.sold}</Badge> : null}
                  {it.availability === "reserved" ? <Badge tone="reserved">{t.reserved}</Badge> : null}
                </span>
              </div>
            </Link>
            <div className="absolute top-2 right-2">
              <WishlistButton productId={it.productId} />
            </div>
            <Link href={href} className="line-clamp-2 font-medium text-shop-ink underline-offset-4 hover:underline">
              {it.title}
            </Link>
            <div className="flex flex-wrap items-center justify-between gap-2">
              {sold ? <span className="text-sm text-shop-muted">{t.sold}</span> : <Price cents={it.price} currency={c.tenant.currency} size="sm" />}
              {it.availability === "available" ? <Badge tone="ok">{t.available}</Badge> : null}
            </div>
            <p className="text-xs text-shop-muted">
              {t.addedOn} <time dateTime={it.addedAt.toISOString()}>{formatDate(it.addedAt, c.tenant.timezone)}</time>
            </p>
          </li>
        );
      })}
    </ul>
  );
}

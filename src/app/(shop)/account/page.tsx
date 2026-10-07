import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { accountCopy } from "@/components/shop/account/_copy";
import { AccountShell, Panel } from "@/components/shop/account/AccountShell";
import { AddressLines } from "@/components/shop/account/AddressCard";
import { OrderList } from "@/components/shop/account/OrderList";
import { ButtonLink } from "@/components/shop/ui/Button";
import { Skeleton } from "@/components/shop/ui/Skeleton";
import { listAddresses, listCustomerOrders, requireShopCustomer } from "@/server/customer-auth";
import { wishlistCount } from "@/server/wishlist";

const t = accountCopy.account;

export const metadata: Metadata = { title: t.title, robots: { index: false, follow: false } };

export default function AccountPage() {
  return (
    <AccountShell active="overview" title={t.title}>
      <Suspense fallback={<OverviewSkeleton />}>
        <Overview />
      </Suspense>
    </AccountShell>
  );
}

async function Overview() {
  const c = await requireShopCustomer("/account");
  const owner = { tenantId: c.tenant.id, customerId: c.customer.id };
  const [orders, addresses, wished] = await Promise.all([
    listCustomerOrders({ ...owner, email: c.user.email }, { take: 3 }),
    listAddresses(owner),
    wishlistCount(owner),
  ]);
  const shipping = addresses.find((a) => a.type === "SHIPPING" && a.isDefault) ?? addresses.find((a) => a.type === "SHIPPING");
  const name = c.user.name || c.customer.firstName;
  const linkClass = "inline-flex min-h-11 items-center text-sm font-semibold text-shop-ink underline underline-offset-4 hover:text-shop-primary";

  return (
    <div className="grid gap-6">
      <p className="text-lg text-shop-ink-2">
        {t.greeting(name)} <span className="text-shop-muted">({c.user.email})</span>
      </p>

      <Panel
        title={t.recentOrders}
        action={
          orders.length ? (
            <Link href="/account/orders" className={linkClass}>
              {t.allOrders}
            </Link>
          ) : null
        }
      >
        {orders.length ? (
          <OrderList orders={orders} timeZone={c.tenant.timezone} />
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-shop-muted">{t.noOrders}</p>
            <ButtonLink href="/" variant="outline">
              {t.startShopping}
            </ButtonLink>
          </div>
        )}
      </Panel>

      <div className="grid gap-6 sm:grid-cols-2">
        <Panel title={t.defaultAddress}>
          {shipping ? <AddressLines a={shipping} /> : <p className="text-sm text-shop-muted">{t.noAddress}</p>}
          <Link href="/account/addresses" className={`${linkClass} mt-3`}>
            {t.manageAddresses}
          </Link>
        </Panel>
        <Panel title={accountCopy.wishlist.title}>
          <p className="text-sm text-shop-ink-2">{t.wishlistCount(wished)}</p>
          <Link href="/wishlist" className={`${linkClass} mt-3`}>
            {t.viewWishlist}
          </Link>
        </Panel>
      </div>
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="grid gap-6" aria-busy="true">
      <Skeleton className="h-6 w-64" />
      <Skeleton className="h-48 w-full" />
      <div className="grid gap-6 sm:grid-cols-2">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    </div>
  );
}

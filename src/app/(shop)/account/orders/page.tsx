import type { Metadata } from "next";
import { Suspense } from "react";
import { accountCopies } from "@/components/shop/account/_copy";
import { getRequestLocale, shopCopy } from "@/server/i18n/locale";
import { AccountShell } from "@/components/shop/account/AccountShell";
import { OrderList } from "@/components/shop/account/OrderList";
import { ButtonLink } from "@/components/shop/ui/Button";
import { EmptyState } from "@/components/shop/ui/EmptyState";
import { Skeleton } from "@/components/shop/ui/Skeleton";
import { listCustomerOrders, requireShopCustomer } from "@/server/customer-auth";

export async function generateMetadata(): Promise<Metadata> {
  const t = (await shopCopy(accountCopies)).orders;
  return { title: t.title, robots: { index: false, follow: false } };
}

export default async function OrdersPage() {
  const t = (await shopCopy(accountCopies)).orders;
  return (
    <AccountShell active="orders" title={t.title}>
      <Suspense fallback={<Skeleton className="h-72 w-full" />}>
        <Orders />
      </Suspense>
    </AccountShell>
  );
}

async function Orders() {
  const c = await requireShopCustomer("/account/orders");
  const orders = await listCustomerOrders({ tenantId: c.tenant.id, customerId: c.customer.id, email: c.user.email });
  const locale = await getRequestLocale();
  const accountCopy = await shopCopy(accountCopies);
  const t = accountCopy.orders;
  if (!orders.length) {
    return (
      <EmptyState
        title={t.empty}
        action={
          <ButtonLink href="/" variant="primary">
            {accountCopy.account.startShopping}
          </ButtonLink>
        }
      />
    );
  }
  return <OrderList orders={orders} timeZone={c.tenant.timezone} locale={locale} />;
}

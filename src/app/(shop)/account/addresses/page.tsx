import type { Metadata } from "next";
import Link from "@/components/shop/ui/Link";
import { Suspense } from "react";
import { accountCopies } from "@/components/shop/account/_copy";
import { getRequestLocale, shopCopy } from "@/server/i18n/locale";
import { AccountShell } from "@/components/shop/account/AccountShell";
import { AddressLines } from "@/components/shop/account/AddressCard";
import { ConfirmSubmit } from "@/components/shop/account/ConfirmSubmit";
import { Badge } from "@/components/shop/ui/Badge";
import { ButtonLink } from "@/components/shop/ui/Button";
import { EmptyState } from "@/components/shop/ui/EmptyState";
import { Skeleton } from "@/components/shop/ui/Skeleton";
import { listAddresses, MAX_ADDRESSES, requireShopCustomer } from "@/server/customer-auth";
import { deleteAddressAction, setDefaultAddressAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = (await shopCopy(accountCopies)).addresses;
  return { title: t.title, robots: { index: false, follow: false } };
}

export default async function AddressesPage() {
  const t = (await shopCopy(accountCopies)).addresses;
  return (
    <AccountShell active="addresses" title={t.title}>
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <Addresses />
      </Suspense>
    </AccountShell>
  );
}

async function Addresses() {
  const c = await requireShopCustomer("/account/addresses");
  const addresses = await listAddresses({ tenantId: c.tenant.id, customerId: c.customer.id });
  const locale = await getRequestLocale();
  const t = (await shopCopy(accountCopies)).addresses;
  const add = (
    <ButtonLink href="/account/addresses/new" variant="primary">
      {t.add}
    </ButtonLink>
  );
  if (!addresses.length) return <EmptyState title={t.empty} action={add} />;
  const small = "inline-flex min-h-11 items-center text-sm font-semibold text-shop-ink underline underline-offset-4 hover:text-shop-primary";
  return (
    <div className="grid gap-6">
      <ul className="grid gap-4 sm:grid-cols-2">
        {addresses.map((a) => (
          <li key={a.id} className="flex flex-col rounded-shop border border-shop-line bg-shop-surface p-5 sm:p-6">
            <div className="mb-3 flex flex-wrap gap-2">
              <Badge tone="neutral" className="bg-shop-sunken shadow-none">{a.type === "SHIPPING" ? t.shipping : t.billing}</Badge>
              {a.isDefault ? <Badge tone="primary">{t.default}</Badge> : null}
            </div>
            <AddressLines a={a} locale={locale} />
            <div className="mt-auto flex flex-wrap items-center gap-x-5 pt-3">
              <Link href={`/account/addresses/${a.id}`} className={small}>
                {t.edit}
              </Link>
              {!a.isDefault ? (
                <form action={setDefaultAddressAction}>
                  <input type="hidden" name="id" value={a.id} />
                  <button type="submit" className={small}>
                    {t.makeDefault}
                  </button>
                </form>
              ) : null}
              <form action={deleteAddressAction}>
                <input type="hidden" name="id" value={a.id} />
                <ConfirmSubmit message={t.removeConfirm} className="inline-flex min-h-11 items-center text-sm font-semibold text-shop-crit underline-offset-4 hover:underline">
                  {t.remove}
                </ConfirmSubmit>
              </form>
            </div>
          </li>
        ))}
      </ul>
      {addresses.length < MAX_ADDRESSES ? <div>{add}</div> : <p className="text-sm text-shop-muted">{t.limit}</p>}
    </div>
  );
}

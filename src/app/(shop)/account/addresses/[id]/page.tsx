import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { accountCopy } from "@/components/shop/account/_copy";
import { AccountShell, Panel } from "@/components/shop/account/AccountShell";
import { AddressForm } from "@/components/shop/account/AddressForm";
import { FormSkeleton } from "@/components/shop/account/FormSkeleton";
import { getAddress, requireShopCustomer } from "@/server/customer-auth";
import { saveAddressAction } from "../../actions";
import { countryOptions } from "../_countries";

const t = accountCopy.addresses;

export const metadata: Metadata = { title: t.editTitle, robots: { index: false, follow: false } };

export default function EditAddressPage({ params }: PageProps<"/account/addresses/[id]">) {
  return (
    <AccountShell active="addresses" title={t.editTitle}>
      <Panel>
        <Suspense fallback={<FormSkeleton fields={6} />}>
          <EditAddress params={params} />
        </Suspense>
      </Panel>
    </AccountShell>
  );
}

async function EditAddress({ params }: { params: PageProps<"/account/addresses/[id]">["params"] }) {
  const { id } = await params;
  const c = await requireShopCustomer(`/account/addresses/${encodeURIComponent(id)}`);
  const address = await getAddress({ tenantId: c.tenant.id, customerId: c.customer.id }, id);
  if (!address) notFound();
  const countries = await countryOptions(c.tenant.id);
  const initial = {
    id: address.id,
    type: address.type,
    isDefault: address.isDefault,
    firstName: address.firstName,
    lastName: address.lastName,
    company: address.company,
    street: address.street,
    houseNumber: address.houseNumber,
    line2: address.line2,
    postalCode: address.postalCode,
    city: address.city,
    region: address.region,
    countryCode: address.countryCode,
    phone: address.phone,
  };
  return <AddressForm action={saveAddressAction} countries={countries} initial={initial} />;
}

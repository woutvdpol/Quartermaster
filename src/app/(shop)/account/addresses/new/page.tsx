import type { Metadata } from "next";
import { Suspense } from "react";
import { accountCopy } from "@/components/shop/account/_copy";
import { AccountShell, Panel } from "@/components/shop/account/AccountShell";
import { AddressForm } from "@/components/shop/account/AddressForm";
import { FormSkeleton } from "@/components/shop/account/FormSkeleton";
import { requireShopCustomer } from "@/server/customer-auth";
import { saveAddressAction } from "../../actions";
import { countryOptions } from "../_countries";

const t = accountCopy.addresses;

export const metadata: Metadata = { title: t.newTitle, robots: { index: false, follow: false } };

export default function NewAddressPage() {
  return (
    <AccountShell active="addresses" title={t.newTitle}>
      <Panel>
        <Suspense fallback={<FormSkeleton fields={6} />}>
          <NewAddress />
        </Suspense>
      </Panel>
    </AccountShell>
  );
}

async function NewAddress() {
  const c = await requireShopCustomer("/account/addresses/new");
  const countries = await countryOptions(c.tenant.id);
  const name = (c.user.name ?? "").trim();
  const i = name.indexOf(" ");
  return (
    <AddressForm
      action={saveAddressAction}
      countries={countries}
      initial={{
        type: "SHIPPING",
        isDefault: false,
        firstName: c.customer.firstName ?? (i === -1 ? name : name.slice(0, i)),
        lastName: c.customer.lastName ?? (i === -1 ? "" : name.slice(i + 1)),
        company: null,
        street: "",
        houseNumber: null,
        line2: null,
        postalCode: null,
        city: "",
        region: null,
        countryCode: countries.defaultCountry,
        phone: c.customer.phone,
      }}
    />
  );
}

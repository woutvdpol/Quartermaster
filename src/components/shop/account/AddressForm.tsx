"use client";

import Link from "@/components/shop/ui/Link";
import { useActionState } from "react";
import { useShopCopy } from "@/components/shop/i18n/ShopLocale";
import { accountCopies } from "./_copy";
import { checkClasses, Select } from "@/components/shop/ui/Field";
import { Alert, Field, SubmitButton } from "./form";

export type AddressFormValues = {
  id?: string;
  type: "SHIPPING" | "BILLING";
  isDefault: boolean;
  firstName: string;
  lastName: string;
  company: string | null;
  street: string;
  houseNumber: string | null;
  line2: string | null;
  postalCode: string | null;
  city: string;
  region: string | null;
  countryCode: string;
  phone: string | null;
};

type FieldErrors = Partial<Record<keyof AddressFormValues, string>>;
type State = { error?: string; fieldErrors?: FieldErrors } | undefined;

export function AddressForm({
  action,
  initial,
  countries,
}: {
  action: (prev: State, formData: FormData) => Promise<State>;
  initial: AddressFormValues | null;
  /** [code, name] pairs; shipping countries of the shop first. */
  countries: { preferred: Array<[string, string]>; all: Array<[string, string]> };
}) {
  const copy = useShopCopy(accountCopies);
  const t = copy.addresses;
  const f = t.fields;
  const [state, formAction] = useActionState(action, undefined);
  const fe = state?.fieldErrors ?? {};
  const v = initial;
  return (
    <form action={formAction} className="grid gap-4" noValidate>
      {v?.id ? <input type="hidden" name="id" value={v.id} /> : null}
      {state?.error ? <Alert tone="error">{state.error}</Alert> : null}

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium text-shop-ink">{t.type}</legend>
        <div className="flex flex-wrap gap-2 text-sm">
          {(["SHIPPING", "BILLING"] as const).map((type) => (
            <label
              key={type}
              className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-shop-control border border-shop-line bg-shop-surface px-4 has-checked:border-shop-ink has-checked:ring-1 has-checked:ring-shop-ink"
            >
              <input type="radio" name="type" value={type} defaultChecked={(v?.type ?? "SHIPPING") === type} className={checkClasses} />
              {type === "SHIPPING" ? t.shipping : t.billing}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="firstName" label={f.firstName} autoComplete="given-name" required defaultValue={v?.firstName} error={fe.firstName} />
        <Field id="lastName" label={f.lastName} autoComplete="family-name" required defaultValue={v?.lastName} error={fe.lastName} />
      </div>
      <Field id="company" label={f.company} autoComplete="organization" defaultValue={v?.company ?? ""} error={fe.company} />
      <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
        <Field id="street" label={f.street} autoComplete="address-line1" required defaultValue={v?.street} error={fe.street} />
        <Field id="houseNumber" label={f.houseNumber} defaultValue={v?.houseNumber ?? ""} error={fe.houseNumber} />
      </div>
      <Field id="line2" label={f.line2} autoComplete="address-line2" defaultValue={v?.line2 ?? ""} error={fe.line2} />
      <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
        <Field id="postalCode" label={f.postalCode} autoComplete="postal-code" defaultValue={v?.postalCode ?? ""} error={fe.postalCode} />
        <Field id="city" label={f.city} autoComplete="address-level2" required defaultValue={v?.city} error={fe.city} />
      </div>
      <Field id="region" label={f.region} autoComplete="address-level1" defaultValue={v?.region ?? ""} error={fe.region} />
      <div className="grid gap-1.5">
        <label htmlFor="countryCode" className="text-sm font-medium text-shop-ink">
          {f.countryCode}
        </label>
        <Select
          id="countryCode"
          name="countryCode"
          autoComplete="country"
          required
          defaultValue={v?.countryCode ?? countries.preferred[0]?.[0] ?? ""}
          aria-invalid={fe.countryCode ? true : undefined}
          aria-describedby={fe.countryCode ? "countryCode-error" : undefined}
        >
          {countries.preferred.length ? (
            <optgroup label={t.shipsTo}>
              {countries.preferred.map(([code, name]) => (
                <option key={`p-${code}`} value={code}>
                  {name}
                </option>
              ))}
            </optgroup>
          ) : null}
          <optgroup label={t.allCountries}>
          {countries.all.map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
          </optgroup>
        </Select>
        {fe.countryCode ? (
          <p id="countryCode-error" className="text-sm text-shop-crit">
            {fe.countryCode}
          </p>
        ) : null}
      </div>
      <Field id="phone" label={f.phone} type="tel" autoComplete="tel" defaultValue={v?.phone ?? ""} error={fe.phone} />
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-shop-ink-2">
        <input type="checkbox" name="isDefault" defaultChecked={v?.isDefault} className={checkClasses} />
        {t.isDefault}
      </label>
      <div className="flex flex-wrap items-center gap-4 pt-2">
        <SubmitButton pendingLabel={copy.common.saving}>{t.save}</SubmitButton>
        <Link href="/account/addresses" className="inline-flex min-h-11 items-center text-sm font-medium text-shop-muted underline-offset-4 hover:text-shop-ink hover:underline">
          {copy.common.cancel}
        </Link>
      </div>
    </form>
  );
}

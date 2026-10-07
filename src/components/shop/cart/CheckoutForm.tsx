"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { buttonClasses } from "@/components/shop/ui/Button";
import { cn } from "@/components/shop/ui/cn";
import { checkClasses, inputClasses, Select, textareaClasses } from "@/components/shop/ui/Field";
import { formatMoney } from "@/components/shop/ui/money";
import type { CheckoutQuote, PaymentMethodOption } from "@/server/checkout";
import { loginHref } from "@/server/customer-auth/redirect";
import { checkoutQuoteAction, placeOrderAction, type CheckoutFormState } from "@/app/(shop)/checkout/actions";
import { saveCheckoutContactAction } from "./actions";
import { CartLineItem, type CartLineData } from "./CartLineItem";
import { FreeShippingBar } from "./FreeShippingBar";
import type { CountryOption } from "./CartSummary";
import { cartCopy } from "./_copy";

const t = cartCopy.checkout;

/** Radio card (shipping option, payment method): panel radius, ink border + ring when selected. */
const radioCardClass =
  "flex min-h-14 cursor-pointer items-center gap-3 rounded-shop border border-shop-line bg-shop-surface px-4 py-3 transition-colors " +
  "hover:border-shop-line-strong has-checked:border-shop-ink has-checked:ring-1 has-checked:ring-shop-ink has-focus-visible:outline-2 " +
  "has-focus-visible:outline-offset-2 has-focus-visible:outline-shop-primary";

export type CheckoutFormProps = {
  currency: string;
  countries: CountryOption[];
  defaultCountry: string | null;
  initialQuote: CheckoutQuote | null;
  payment: { configured: boolean; mode: "test" | "live" | null; methods: PaymentMethodOption[]; devSimulation: boolean };
  ageConfirmation: { required: boolean; minimumAge: number };
  termsHref: string | null;
  newsletterEnabled: boolean;
  viewer: { email: string; name: string | null } | null;
  idempotencyKey: string;
  lines: CartLineData[];
  disclaimer: string;
  loginReturnTo: string;
  /** Contact remembered on the cart (abandoned-cart reminder). */
  contact?: { email: string | null; reminderConsent: boolean };
};

const idOf = (name: string) => `co-${name.replace(/\./g, "-")}`;

function getPath(values: Record<string, unknown> | undefined, path: string): string | undefined {
  let node: unknown = values;
  for (const p of path.split(".")) {
    if (!node || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[p];
  }
  return typeof node === "string" ? node : undefined;
}

function Text({
  name,
  label,
  errors,
  values,
  required,
  hint,
  className,
  defaultValue,
  ...input
}: {
  name: string;
  label: ReactNode;
  errors?: Record<string, string>;
  values?: Record<string, unknown>;
  required?: boolean;
  hint?: ReactNode;
  className?: string;
  defaultValue?: string;
} & Omit<React.ComponentPropsWithoutRef<"input">, "name" | "defaultValue">) {
  const id = idOf(name);
  const error = errors?.[name];
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium text-shop-ink">
        {label}
        {required ? <span aria-hidden="true" className="text-shop-crit"> *</span> : null}
      </label>
      <input
        id={id}
        name={name}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        defaultValue={getPath(values, name) ?? defaultValue}
        className={inputClasses}
        {...input}
      />
      {hint && !error ? (
        <p id={`${id}-hint`} className="text-xs text-shop-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-xs font-medium text-shop-crit">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function CountrySelect({
  name,
  value,
  onChange,
  defaultValue,
  countries,
  error,
}: {
  name: string;
  value?: string;
  onChange?: (code: string) => void;
  defaultValue?: string;
  countries: CountryOption[];
  error?: string;
}) {
  const id = idOf(name);
  return (
    <div className="flex flex-col gap-1.5 sm:col-span-2">
      <label htmlFor={id} className="text-sm font-medium text-shop-ink">
        {t.country}
        <span aria-hidden="true" className="text-shop-crit"> *</span>
      </label>
      <Select
        id={id}
        name={name}
        required
        {...(onChange ? { value, onChange: (e: React.ChangeEvent<HTMLSelectElement>) => onChange(e.target.value) } : { defaultValue })}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        autoComplete={name.startsWith("billing") ? "billing country" : "shipping country"}
      >
        <option value="">{t.chooseCountry}</option>
        {countries.map((c) => (
          <option key={c.code} value={c.code}>
            {c.name}
          </option>
        ))}
      </Select>
      {error ? (
        <p id={`${id}-error`} className="text-xs font-medium text-shop-crit">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function AddressFields({
  prefix,
  errors,
  values,
  countries,
  country,
  onCountry,
  defaults,
}: {
  prefix: "shipping" | "billing";
  errors?: Record<string, string>;
  values?: Record<string, unknown>;
  countries: CountryOption[];
  country?: string;
  onCountry?: (code: string) => void;
  defaults?: { firstName?: string; lastName?: string; countryCode?: string };
}) {
  const ac = prefix === "billing" ? "billing" : "shipping";
  const f = (n: string) => `${prefix}.${n}`;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Text name={f("firstName")} label={t.firstName} required autoComplete={`${ac} given-name`} errors={errors} values={values} defaultValue={defaults?.firstName} />
      <Text name={f("lastName")} label={t.lastName} required autoComplete={`${ac} family-name`} errors={errors} values={values} defaultValue={defaults?.lastName} />
      <Text name={f("company")} label={t.company} autoComplete={`${ac} organization`} errors={errors} values={values} className="sm:col-span-2" />
      <div className="grid grid-cols-[1fr_6.5rem] gap-3 sm:col-span-2">
        <Text name={f("street")} label={t.street} required autoComplete={`${ac} address-line1`} errors={errors} values={values} />
        <Text name={f("houseNumber")} label={t.houseNumber} autoComplete="off" errors={errors} values={values} />
      </div>
      <Text name={f("line2")} label={t.line2} autoComplete={`${ac} address-line2`} errors={errors} values={values} className="sm:col-span-2" />
      <Text name={f("postalCode")} label={t.postalCode} autoComplete={`${ac} postal-code`} errors={errors} values={values} />
      <Text name={f("city")} label={t.city} required autoComplete={`${ac} address-level2`} errors={errors} values={values} />
      <Text name={f("region")} label={t.region} autoComplete={`${ac} address-level1`} errors={errors} values={values} className="sm:col-span-2" />
      <CountrySelect
        name={f("countryCode")}
        countries={countries}
        value={country}
        onChange={onCountry}
        defaultValue={getPath(values, f("countryCode")) ?? defaults?.countryCode}
        error={errors?.[f("countryCode")]}
      />
    </div>
  );
}

function Section({ title, children, n }: { title: string; children: ReactNode; n: number }) {
  return (
    <section aria-labelledby={`co-sec-${n}`} className="border-t border-shop-line pt-7 sm:pt-9">
      <h2 id={`co-sec-${n}`} className="mb-5 flex items-baseline gap-3 text-2xl sm:mb-6">
        <span aria-hidden="true" className="font-shop-mono text-sm font-normal tracking-normal text-shop-muted">
          {String(n).padStart(2, "0")}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function SubmitButton({ disabled, label }: { disabled: boolean; label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={disabled || pending} aria-busy={pending || undefined} className={buttonClasses("primary", "lg", "w-full")}>
      {pending ? t.placing : label}
    </button>
  );
}

function splitName(name: string | null | undefined) {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: undefined, lastName: undefined };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") || undefined };
}

/**
 * Single-page checkout. Progressive enhancement: it is a plain form posting to `placeOrderAction`; with
 * JS, changing the country/shipping option/insurance asks the server for a fresh quote (prices are
 * never computed here). Field errors come back keyed by input name.
 */
export function CheckoutForm(props: CheckoutFormProps) {
  const { currency, countries, payment, viewer } = props;
  const router = useRouter();
  const [state, formAction] = useActionState<CheckoutFormState, FormData>(placeOrderAction, { status: "idle" });
  const [country, setCountry] = useState(props.defaultCountry ?? "");
  const [quote, setQuote] = useState<CheckoutQuote | null>(props.initialQuote);
  const [optionId, setOptionId] = useState<string>(props.initialQuote?.selectedOptionId ?? "");
  const [insurance, setInsurance] = useState(false);
  const [billingSame, setBillingSame] = useState(true);
  const [quoting, startQuote] = useTransition();
  const seq = useRef(0);
  const alertRef = useRef<HTMLDivElement>(null);
  const countryLabel = (code: string) => props.countries.find((c) => c.code === code)?.name ?? code;
  const errors = state.errors;
  const values = state.values;
  const fmt = (n: number) => formatMoney(n, currency);
  const names = splitName(viewer?.name);

  useEffect(() => {
    if (state.status === "error") alertRef.current?.focus();
    if (state.status === "placed" && state.redirectTo) router.push(state.redirectTo);
  }, [state, router]);

  function requote(next: { country?: string; optionId?: string; insurance?: boolean }) {
    const c = next.country ?? country;
    const o = next.optionId ?? optionId;
    const ins = next.insurance ?? insurance;
    if (!c) {
      setQuote(null);
      return;
    }
    const mine = ++seq.current;
    startQuote(async () => {
      const q = await checkoutQuoteAction({ countryCode: c, shippingOptionId: o || null, insurance: ins });
      if (mine !== seq.current) return;
      setQuote(q);
      const selected = q?.selectedOptionId ?? q?.options[0]?.id ?? "";
      setOptionId(selected);
      if (q && !q.insurance) setInsurance(false);
    });
  }

  const selected = quote?.options.find((o) => o.id === optionId) ?? null;
  const canPlace = !!selected && !!quote && quote.minimumShortfall === 0 && (payment.configured || payment.devSimulation);
  const submitLabel = payment.configured ? t.placeOrder : t.placeOrderDev;

  return (
    <form action={formAction} id="checkout-form" className="grid items-start gap-10 lg:grid-cols-[1fr_400px] lg:gap-14" noValidate>
      <input type="hidden" name="idempotencyKey" value={props.idempotencyKey} />

      <div className="flex min-w-0 flex-col gap-9">
        {state.status === "placed" && state.redirectTo ? (
          <p role="status" className="rounded-shop border border-shop-ok/30 bg-shop-ok-soft px-4 py-3 text-sm text-shop-ok">
            <Link href={state.redirectTo} className="font-medium underline">
              {t.viewOrder}
            </Link>
          </p>
        ) : null}
        {state.status === "error" && state.message ? (
          <div ref={alertRef} tabIndex={-1} role="alert" className="rounded-shop border border-shop-crit/30 bg-shop-crit-soft px-4 py-3 text-sm text-shop-crit">
            <p className="font-medium">{state.message}</p>
            {state.code === "LOGIN_REQUIRED" ? (
              <p className="mt-1">
                <Link className="underline" href={loginHref(props.loginReturnTo)}>
                  {t.login}
                </Link>{" "}
                ·{" "}
                <Link className="underline" href={`/register?next=${encodeURIComponent(props.loginReturnTo)}`}>
                  {t.register}
                </Link>
              </p>
            ) : null}
            {state.code === "UNAVAILABLE" || state.code === "EMPTY" || state.code === "COUPON" || state.code === "COMPLIANCE" ? (
              <p className="mt-1">
                <Link className="underline" href="/cart">
                  {t.backToCart}
                </Link>
              </p>
            ) : null}
          </div>
        ) : null}

        <Section n={1} title={t.contact}>
          {viewer ? (
            <p className="mb-4 text-sm text-shop-ink-2">{t.loggedInAs(viewer.email)}</p>
          ) : (
            <p className="mb-4 text-sm text-shop-muted">
              {t.haveAccount}{" "}
              <Link href={loginHref(props.loginReturnTo)} className="text-shop-primary underline underline-offset-2">
                {t.loginToSave}
              </Link>
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            {viewer ? (
              <input type="hidden" name="email" value={viewer.email} />
            ) : (
              <Text
                name="email"
                type="email"
                label={t.email}
                required
                autoComplete="email"
                inputMode="email"
                errors={errors}
                values={values}
                defaultValue={props.contact?.email ?? undefined}
                onBlur={(e) => {
                  const v = e.currentTarget.value.trim();
                  if (v.includes("@")) void saveCheckoutContactAction({ email: v });
                }}
              />
            )}
            <Text name="phone" type="tel" label={t.phone} required autoComplete="tel" hint={t.phoneHint} errors={errors} values={values} />
          </div>
          <div className="mt-4 flex flex-col gap-1">
            <div className="flex items-start gap-3 py-1 text-sm">
              <input
                id="co-reminderConsent"
                type="checkbox"
                name="reminderConsent"
                defaultChecked={props.contact?.reminderConsent ?? false}
                aria-describedby="co-reminderConsent-hint"
                onChange={(e) => {
                  const form = e.currentTarget.form;
                  const email = form ? new FormData(form).get("email") : null;
                  void saveCheckoutContactAction({ reminderConsent: e.currentTarget.checked, email: typeof email === "string" && email.includes("@") ? email : undefined });
                }}
                className={cn(checkClasses, "mt-0.5")}
              />
              <label htmlFor="co-reminderConsent">{cartCopy.reminder.consent}</label>
            </div>
            <p id="co-reminderConsent-hint" className="pl-7 text-xs text-shop-muted">
              {cartCopy.reminder.hint}
            </p>
          </div>
        </Section>

        <Section n={2} title={t.shippingAddress}>
          <AddressFields
            prefix="shipping"
            errors={errors}
            values={values}
            countries={countries}
            country={country}
            onCountry={(c) => {
              setCountry(c);
              requote({ country: c });
            }}
            defaults={names}
          />
          <label className="mt-5 flex min-h-11 cursor-pointer items-start gap-3 py-1 text-sm">
            <input
              type="checkbox"
              name="billingSameAsShipping"
              checked={billingSame}
              onChange={(e) => setBillingSame(e.target.checked)}
              className={cn(checkClasses, "mt-0.5")}
            />
            <span>{t.billingSame}</span>
          </label>
          {!billingSame ? (
            <fieldset className="mt-6 border-t border-shop-line pt-6">
              <legend className="mb-5 font-shop-heading text-lg font-semibold">{t.billingAddress}</legend>
              <AddressFields prefix="billing" errors={errors} values={values} countries={countries} defaults={names} />
            </fieldset>
          ) : null}
        </Section>

        <Section n={3} title={t.shippingMethod}>
          <fieldset aria-describedby={errors?.shippingOptionId ? "co-shippingOptionId-error" : undefined} aria-busy={quoting || undefined}>
            <legend className="sr-only">{t.shippingMethod}</legend>
            {quote && quote.restrictedItems.length > 0 && quote.options.length > 0 ? (
              // Compliance: some items can't be shipped to this country; only pickup remains.
              <p role="note" className="mb-3 rounded-shop border border-shop-warn/30 bg-shop-warn-soft px-3 py-2 text-sm text-shop-warn">
                {quote.unavailableReason}
              </p>
            ) : null}
            {!quote || quote.options.length === 0 ? (
              <p className={quote?.unavailableReason ? "text-sm text-shop-crit" : "text-sm text-shop-muted"}>{quote?.unavailableReason ?? t.noOptions}</p>
            ) : (
              <div className={cn("flex flex-col gap-2", quoting && "opacity-60")}>
                {quote.options.map((o) => (
                  <label key={o.id} className={cn(radioCardClass, "justify-between")}>
                    <span className="flex items-center gap-3">
                      <input
                        type="radio"
                        name="shippingOptionId"
                        value={o.id}
                        checked={optionId === o.id}
                        onChange={() => {
                          setOptionId(o.id);
                          requote({ optionId: o.id });
                        }}
                        className={checkClasses}
                      />
                      <span className="font-medium">
                        {o.name}
                        {o.isPickup ? <span className="ml-2 text-xs font-normal text-shop-muted">({t.pickup})</span> : null}
                      </span>
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums">
                      {o.freeShipping ? (
                        <>
                          <s className="mr-2 font-normal text-shop-muted">{fmt(o.basePrice)}</s>
                          {cartCopy.cart.free}
                        </>
                      ) : o.price === 0 ? (
                        cartCopy.cart.free
                      ) : (
                        fmt(o.price)
                      )}
                    </span>
                  </label>
                ))}
              </div>
            )}
            {selected?.insurance ? (
              <label className="mt-4 flex min-h-11 cursor-pointer items-start gap-3 py-1 text-sm">
                <input
                  type="checkbox"
                  name="insurance"
                  checked={insurance}
                  onChange={(e) => {
                    setInsurance(e.target.checked);
                    requote({ insurance: e.target.checked });
                  }}
                  className={cn(checkClasses, "mt-0.5")}
                />
                <span>
                  {t.insurance(fmt(selected.insurance.price))}
                  {selected.insurance.maxInsuredValue ? <span className="text-shop-muted"> — {t.insuranceUpTo(fmt(selected.insurance.maxInsuredValue))}</span> : null}
                </span>
              </label>
            ) : null}
            {errors?.shippingOptionId ? (
              <p id="co-shippingOptionId-error" className="mt-2 text-xs font-medium text-shop-crit">
                {errors.shippingOptionId}
              </p>
            ) : null}
          </fieldset>
        </Section>

        <Section n={4} title={t.payment}>
          {!payment.configured ? (
            <p className={cn("rounded-shop px-4 py-2.5 text-sm", payment.devSimulation ? "bg-shop-warn-soft text-shop-warn" : "bg-shop-crit-soft text-shop-crit")}>
              {payment.devSimulation ? t.paymentsNotConfiguredDev : t.paymentsNotConfigured}
            </p>
          ) : payment.methods.length === 0 ? (
            <>
              <input type="hidden" name="paymentMethod" value="" />
              <p className="text-sm text-shop-muted">{t.paymentHostedChoice}</p>
            </>
          ) : (
            <fieldset aria-describedby={errors?.paymentMethod ? "co-paymentMethod-error" : undefined}>
              <legend className="sr-only">{t.payment}</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {payment.methods.map((m) => (
                  <label key={m.id} className={radioCardClass}>
                    <input
                      type="radio"
                      name="paymentMethod"
                      value={m.id}
                      defaultChecked={(getPath(values, "paymentMethod") ?? payment.methods[0]?.id) === m.id}
                      className={checkClasses}
                    />
                    <span className="font-medium">{m.label}</span>
                  </label>
                ))}
              </div>
              {errors?.paymentMethod ? (
                <p id="co-paymentMethod-error" className="mt-2 text-xs font-medium text-shop-crit">
                  {errors.paymentMethod}
                </p>
              ) : null}
            </fieldset>
          )}
          {payment.mode === "test" ? <p className="mt-3 text-xs text-shop-warn">{t.paymentsTestMode}</p> : null}
        </Section>

        <Section n={5} title={t.summary}>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="co-customerNote" className="text-sm font-medium text-shop-ink">
                {t.note}
              </label>
              <textarea
                id="co-customerNote"
                name="customerNote"
                rows={3}
                maxLength={1000}
                defaultValue={getPath(values, "customerNote")}
                className={textareaClasses}
              />
            </div>
            {props.ageConfirmation.required ? (
              <Check name="ageConfirmed" error={errors?.ageConfirmed} hint={t.ageHint} defaultChecked={getPath(values, "ageConfirmed") === "on"}>
                {t.ageConfirm(props.ageConfirmation.minimumAge)}
              </Check>
            ) : null}
            <Check name="termsAccepted" error={errors?.termsAccepted} required defaultChecked={getPath(values, "termsAccepted") === "on"}>
              {t.terms}{" "}
              {props.termsHref ? (
                <Link href={props.termsHref} target="_blank" className="text-shop-primary underline underline-offset-2">
                  {t.termsLink}
                </Link>
              ) : (
                t.termsLink
              )}
            </Check>
            {props.newsletterEnabled ? (
              <Check name="newsletter" defaultChecked={getPath(values, "newsletter") === "on"}>
                {t.newsletter}
              </Check>
            ) : null}
            {props.disclaimer ? <p className="text-xs whitespace-pre-line text-shop-muted">{props.disclaimer}</p> : null}
          </div>
        </Section>
      </div>

      <aside aria-label={t.summary} className="flex flex-col gap-5 rounded-shop bg-shop-sunken p-5 sm:p-7 lg:sticky lg:top-24">
        <div className="flex items-center justify-between">
          <h2 className="text-xl">{t.summary}</h2>
          <Link href="/cart" className="inline-flex min-h-11 items-center text-sm font-semibold text-shop-ink underline underline-offset-4 hover:text-shop-primary">
            {t.edit}
          </Link>
        </div>
        <ul className="-my-3 divide-y divide-shop-line">
          {props.lines.map((l) => (
            <CartLineItem
              key={l.productId}
              line={l}
              compact
              notice={quote?.restrictedItems.some((r) => r.productId === l.productId) ? cartCopy.checkout.notShippable(countryLabel(quote.countryCode)) : null}
            />
          ))}
        </ul>
        <dl className={cn("flex flex-col gap-3 border-t border-shop-line pt-4 text-[0.95rem]", quoting && "opacity-60")} aria-live="polite" aria-busy={quoting || undefined}>
          <Row label={t.subtotal} value={quote ? fmt(quote.totals.subtotal) : "—"} />
          {quote && quote.totals.discount > 0 ? (
            <Row label={`${cartCopy.coupon.discount}${quote.coupon ? ` · ${quote.coupon.code}` : ""}`} value={`−${fmt(quote.totals.discount)}`} />
          ) : null}
          <Row label={t.shipping} value={quote && selected ? (quote.totals.shipping === 0 ? cartCopy.cart.free : fmt(quote.totals.shipping)) : "—"} />
          {quote && quote.totals.insurance > 0 ? <Row label={t.insuranceLine} value={fmt(quote.totals.insurance)} /> : null}
          <div className="flex items-baseline justify-between gap-4 border-t border-shop-line-strong/40 pt-4">
            <dt className="font-semibold">{t.total}</dt>
            <dd className="font-shop-heading text-2xl font-semibold tracking-tight tabular-nums">{quote && selected ? fmt(quote.totals.total) : "—"}</dd>
          </div>
        </dl>
        {quote?.coupon && !quote.coupon.ok ? (
          <p role="alert" className="rounded-shop bg-shop-crit-soft px-4 py-2.5 text-sm text-shop-crit">
            {cartCopy.coupon.notApplied(quote.coupon.code, quote.coupon.message)}{" "}
            <Link href="/cart" className="underline">
              {t.backToCart}
            </Link>
          </p>
        ) : null}
        {quote?.freeShipping && !quote.freeShipping.reached ? <FreeShippingBar progress={quote.freeShipping} currency={currency} /> : null}
        {quote && quote.minimumShortfall > 0 ? (
          <p className="rounded-shop bg-shop-warn-soft px-4 py-2.5 text-sm text-shop-warn">{cartCopy.cart.minimumOrder(fmt(quote.minimumShortfall))}</p>
        ) : null}
        <SubmitButton disabled={!canPlace || quoting} label={submitLabel} />
        <p className="text-center text-xs text-shop-muted">
          {payment.configured ? t.secure : null} {t.currencyNote(currency)}
        </p>
      </aside>
    </form>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-shop-ink-2">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function Check({
  name,
  children,
  error,
  hint,
  required,
  defaultChecked,
}: {
  name: string;
  children: ReactNode;
  error?: string;
  hint?: string;
  required?: boolean;
  defaultChecked?: boolean;
}) {
  const id = idOf(name);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-start gap-3 py-1 text-sm">
        <input
          id={id}
          type="checkbox"
          name={name}
          required={required}
          defaultChecked={defaultChecked}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          className={cn(checkClasses, "mt-0.5")}
        />
        <label htmlFor={id}>{children}</label>
      </div>
      {hint && !error ? (
        <p id={`${id}-hint`} className="pl-7 text-xs text-shop-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="pl-7 text-xs font-medium text-shop-crit">
          {error}
        </p>
      ) : null}
    </div>
  );
}

"use client";

import { useActionState, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "@/components/shop/ui/Link";
import { buttonClasses } from "@/components/shop/ui/Button";
import { cn } from "@/components/shop/ui/cn";
import { checkClasses, textareaClasses } from "@/components/shop/ui/Field";
import { formatMoney } from "@/components/shop/ui/money";
import { useShopCopy, useShopLocale } from "@/components/shop/i18n/ShopLocale";
import { AddressFields, Check, Row, Section, Text, describeSurcharge, getPath, radioCardClass } from "@/components/shop/cart/CheckoutForm";
import type { CountryOption } from "@/components/shop/cart/CartSummary";
import { cartCopies } from "@/components/shop/cart/_copy";
import { localizeServerMessage } from "@/components/shop/cart/server-messages";
import type { CheckoutQuote, PaymentMethodOption } from "@/server/checkout";
import type { AuctionPayFormState } from "@/app/(shop)/auctions/pay/[token]/actions";
import { auctionCopies } from "./_copy";

type QuoteFn = (input: { countryCode: string; shippingOptionId: string | null; insurance: boolean; paymentMethod: string | null }) => Promise<CheckoutQuote | null>;

/**
 * The winner's payment form (/auctions/pay/<token>): delivery address, shipping option, payment method
 * (with surcharges), terms → Mollie. Built from the checkout's form parts (CheckoutForm exports); the
 * hammer price is the fixed subtotal, every total comes from the server quote.
 */
export function AuctionPayForm({
  action,
  quoteAction,
  currency,
  countries,
  defaultCountry,
  initialQuote,
  payment,
  termsHref,
  email,
  initialValues,
  summary,
}: {
  action: (prev: AuctionPayFormState, form: FormData) => Promise<AuctionPayFormState>;
  quoteAction: QuoteFn;
  currency: string;
  countries: CountryOption[];
  defaultCountry: string | null;
  initialQuote: CheckoutQuote | null;
  payment: { configured: boolean; mode: "test" | "live" | null; methods: PaymentMethodOption[]; devSimulation: boolean };
  termsHref: string | null;
  /** The winner's e-mail (fixed: the order's). */
  email: string;
  /** Prefill from the winner's saved address and phone (form field paths). */
  initialValues: Record<string, unknown>;
  /** The lot card (photo, title, hammer price) for the summary. */
  summary: ReactNode;
}) {
  const locale = useShopLocale();
  const copy = useShopCopy(cartCopies);
  const t = copy.checkout;
  const tp = useShopCopy(auctionCopies).pay;
  const router = useRouter();
  const [state, formAction] = useActionState<AuctionPayFormState, FormData>(action, { status: "idle" });
  const [country, setCountry] = useState(defaultCountry ?? "");
  const [quote, setQuote] = useState<CheckoutQuote | null>(initialQuote);
  const [optionId, setOptionId] = useState(initialQuote?.selectedOptionId ?? "");
  const [insurance, setInsurance] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState(payment.methods[0]?.id ?? "");
  const [billingSame, setBillingSame] = useState(true);
  const [quoting, startQuote] = useTransition();
  const seq = useRef(0);
  const alertRef = useRef<HTMLDivElement>(null);
  const errors = state.errors;
  const values = state.values ?? initialValues;
  const fmt = (n: number) => formatMoney(n, currency, locale);
  const unavailableReason = quote?.unavailableReason ? localizeServerMessage(quote.unavailableReason, locale) : null;

  useEffect(() => {
    if (state.status === "error") alertRef.current?.focus();
    if (state.status === "placed" && state.redirectTo) router.push(state.redirectTo);
  }, [state, router]);

  function requote(next: { country?: string; optionId?: string; insurance?: boolean; paymentMethod?: string }) {
    const c = next.country ?? country;
    if (!c) return setQuote(null);
    const mine = ++seq.current;
    startQuote(async () => {
      const q = await quoteAction({
        countryCode: c,
        shippingOptionId: (next.optionId ?? optionId) || null,
        insurance: next.insurance ?? insurance,
        paymentMethod: (next.paymentMethod ?? paymentMethod) || null,
      });
      if (mine !== seq.current) return;
      setQuote(q);
      setOptionId(q?.selectedOptionId ?? q?.options[0]?.id ?? "");
      if (q && !q.insurance) setInsurance(false);
    });
  }

  const selected = quote?.options.find((o) => o.id === optionId) ?? null;
  const canPay = !!selected && !!quote && (payment.configured || payment.devSimulation);

  return (
    <form action={formAction} className="grid items-start gap-10 lg:grid-cols-[1fr_400px] lg:gap-14" noValidate>
      <div className="flex min-w-0 flex-col gap-9">
        {state.status === "placed" && state.redirectTo ? (
          <p role="status" className="rounded-shop border border-shop-ok/30 bg-shop-ok-soft px-4 py-3 text-sm text-shop-ok">
            <Link href={state.redirectTo} className="font-medium underline">
              {tp.viewOrder}
            </Link>
          </p>
        ) : null}
        {state.status === "error" && state.message ? (
          <div ref={alertRef} tabIndex={-1} role="alert" className="rounded-shop border border-shop-crit/30 bg-shop-crit-soft px-4 py-3 text-sm font-medium text-shop-crit">
            {state.message}
          </div>
        ) : null}

        <Section n={1} title={t.contact}>
          <p className="mb-4 text-sm text-shop-ink-2">{tp.payingAs(email)}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Text name="phone" type="tel" label={t.phone} required autoComplete="tel" hint={t.phoneHint} errors={errors} values={values} />
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
          />
          <label className="mt-5 flex min-h-11 cursor-pointer items-start gap-3 py-1 text-sm">
            <input type="checkbox" name="billingSameAsShipping" checked={billingSame} onChange={(e) => setBillingSame(e.target.checked)} className={cn(checkClasses, "mt-0.5")} />
            <span>{t.billingSame}</span>
          </label>
          {!billingSame ? (
            <fieldset className="mt-6 border-t border-shop-line pt-6">
              <legend className="mb-5 font-shop-heading text-lg font-semibold">{t.billingAddress}</legend>
              <AddressFields prefix="billing" errors={errors} values={values} countries={countries} />
            </fieldset>
          ) : null}
        </Section>

        <Section n={3} title={t.shippingMethod}>
          <fieldset aria-describedby={errors?.shippingOptionId ? "co-shippingOptionId-error" : undefined} aria-busy={quoting || undefined}>
            <legend className="sr-only">{t.shippingMethod}</legend>
            {quote && quote.restrictedItems.length > 0 && quote.options.length > 0 ? (
              <p role="note" className="mb-3 rounded-shop border border-shop-warn/30 bg-shop-warn-soft px-3 py-2 text-sm text-shop-warn">
                {unavailableReason}
              </p>
            ) : null}
            {!quote || quote.options.length === 0 ? (
              <p className={unavailableReason ? "text-sm text-shop-crit" : "text-sm text-shop-muted"}>{unavailableReason ?? t.noOptions}</p>
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
                    <span className="shrink-0 font-semibold tabular-nums">{o.price === 0 ? copy.cart.free : fmt(o.price)}</span>
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
                      checked={paymentMethod === m.id}
                      onChange={() => {
                        setPaymentMethod(m.id);
                        requote({ paymentMethod: m.id });
                      }}
                      className={checkClasses}
                    />
                    <span className="flex min-w-0 flex-col">
                      <span className="font-medium">{m.label}</span>
                      {m.surcharge ? <span className="text-xs text-shop-muted">{t.methodSurcharge(m.surcharge.label, describeSurcharge(m.surcharge, fmt, locale, t.surchargeMax))}</span> : null}
                    </span>
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
              <textarea id="co-customerNote" name="customerNote" rows={3} maxLength={1000} defaultValue={getPath(values, "customerNote")} className={textareaClasses} />
            </div>
            <Check name="termsAccepted" error={errors?.termsAccepted} required defaultChecked={getPath(values, "termsAccepted") === "on"}>
              {t.terms}{" "}
              {termsHref ? (
                <Link href={termsHref} target="_blank" className="text-shop-primary underline underline-offset-2">
                  {t.termsLink}
                </Link>
              ) : (
                t.termsLink
              )}
            </Check>
          </div>
        </Section>
      </div>

      <aside aria-label={t.summary} className="flex flex-col gap-5 rounded-shop bg-shop-sunken p-5 sm:p-7 lg:sticky lg:top-24">
        <h2 className="text-xl">{t.summary}</h2>
        {summary}
        <dl className={cn("flex flex-col gap-3 border-t border-shop-line pt-4 text-[0.95rem]", quoting && "opacity-60")} aria-live="polite" aria-busy={quoting || undefined}>
          <Row label={tp.hammer} value={quote ? fmt(quote.totals.subtotal) : "—"} />
          <Row label={t.shipping} value={quote && selected ? (quote.totals.shipping === 0 ? copy.cart.free : fmt(quote.totals.shipping)) : "—"} />
          {quote && quote.totals.insurance > 0 ? <Row label={t.insuranceLine} value={fmt(quote.totals.insurance)} /> : null}
          {quote && quote.totals.surcharge > 0 ? <Row label={quote.totals.surchargeLabel ?? t.surchargeLine} value={fmt(quote.totals.surcharge)} /> : null}
          <div className="flex items-baseline justify-between gap-4 border-t border-shop-line-strong/40 pt-4">
            <dt className="font-semibold">{t.total}</dt>
            <dd className="font-shop-heading text-2xl font-semibold tracking-tight tabular-nums">{quote && selected ? fmt(quote.totals.total) : "—"}</dd>
          </div>
        </dl>
        <p className="text-xs text-shop-muted">{tp.noPremium}</p>
        <PayButton disabled={!canPay || quoting} label={payment.configured ? tp.pay(quote && selected ? fmt(quote.totals.total) : "") : tp.payDev} busy={t.placing} />
        <p className="text-center text-xs text-shop-muted">
          {payment.configured ? t.secure : null} {t.currencyNote(currency)}
        </p>
        <p className="text-center text-xs text-shop-muted">{tp.private}</p>
      </aside>
    </form>
  );
}

function PayButton({ disabled, label, busy }: { disabled: boolean; label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={disabled || pending} aria-busy={pending || undefined} className={buttonClasses("primary", "lg", "w-full")}>
      {pending ? busy : label.trim()}
    </button>
  );
}

"use client";

import { useState, useTransition } from "react";
import { Select } from "@/components/shop/ui/Field";
import { formatMoney } from "@/components/shop/ui/money";
import type { CheckoutQuote } from "@/server/checkout";
import { cartEstimateAction } from "./actions";
import { FreeShippingBar } from "./FreeShippingBar";
import { cartCopy } from "./_copy";

const t = cartCopy.cart;

export type CountryOption = { code: string; name: string };

/**
 * Cart page totals: subtotal, a shipping ESTIMATE for the chosen country (server-side quote; the real
 * price follows from the shipping address at checkout), free-shipping progress and minimum order.
 */
export function CartSummary({
  subtotal,
  currency,
  countries,
  initialCountry,
  initialQuote,
}: {
  subtotal: number;
  currency: string;
  countries: CountryOption[];
  initialCountry: string | null;
  initialQuote: CheckoutQuote | null;
}) {
  const [country, setCountry] = useState(initialCountry ?? "");
  const [quote, setQuote] = useState<CheckoutQuote | null>(initialQuote);
  const [pending, startTransition] = useTransition();

  function onCountry(code: string) {
    setCountry(code);
    if (!code) return setQuote(null);
    startTransition(async () => {
      const q = await cartEstimateAction(code);
      setQuote(q);
    });
  }

  const delivery = quote?.options.find((o) => !o.isPickup) ?? null;
  const pickupOnly = quote && !delivery && quote.options.length > 0;
  const freeByCoupon = quote?.coupon?.ok === true && quote.coupon.freeShipping;
  const shipping = delivery ? (freeByCoupon ? 0 : delivery.price) : null;
  const discount = quote?.totals.discount ?? 0;
  const fmt = (n: number) => formatMoney(n, currency);

  return (
    <div className="flex flex-col gap-4">
      <dl className="flex flex-col gap-3 text-[0.95rem]">
        <div className="flex justify-between gap-4">
          <dt className="text-shop-ink-2">{t.subtotal}</dt>
          <dd className="font-semibold tabular-nums">{fmt(quote?.totals.subtotal ?? subtotal)}</dd>
        </div>
        {discount > 0 ? (
          <div className="flex justify-between gap-4">
            <dt className="text-shop-ink-2">
              {cartCopy.coupon.discount}
              {quote?.coupon ? <span className="text-shop-muted"> · {quote.coupon.code}</span> : null}
            </dt>
            <dd className="font-semibold tabular-nums text-shop-ok">−{fmt(discount)}</dd>
          </div>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <dt className="flex items-center justify-between gap-2 text-shop-ink-2">
            <label htmlFor="cart-country">{t.shippingEstimate}</label>
          </dt>
          <dd className="flex flex-col gap-2">
            <Select
              id="cart-country"
              value={country}
              onChange={(e) => onCountry(e.target.value)}
              className="text-sm"
              aria-describedby="cart-shipping-result"
            >
              <option value="">{t.shipTo}…</option>
              {countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </Select>
            <p id="cart-shipping-result" aria-live="polite" className="flex justify-between gap-3 px-1 text-sm text-shop-ink">
              {pending ? (
                <span className="text-shop-muted">{t.calculating}</span>
              ) : !quote ? (
                <span className="text-shop-muted">{t.noCountry}</span>
              ) : delivery ? (
                <>
                  <span className="text-shop-muted">{delivery.name}</span>
                  <span className="font-semibold tabular-nums">{shipping === 0 ? t.free : fmt(delivery.price)}</span>
                </>
              ) : pickupOnly ? (
                <span className="text-shop-muted">
                  {quote.unavailableReason ? `${quote.unavailableReason} · ` : ""}
                  {t.pickupOnly}
                </span>
              ) : (
                <span className="text-shop-crit">{quote.unavailableReason}</span>
              )}
            </p>
          </dd>
        </div>
      </dl>

      {quote?.freeShipping ? <FreeShippingBar progress={quote.freeShipping} currency={currency} /> : null}
      {quote && quote.minimumShortfall > 0 ? (
        <p className="rounded-shop bg-shop-warn-soft px-4 py-2.5 text-sm text-shop-warn">{t.minimumOrder(fmt(quote.minimumShortfall))}</p>
      ) : null}

      {shipping !== null && quote ? (
        <div className="flex items-baseline justify-between gap-4 border-t border-shop-line-strong/40 pt-4">
          <span className="font-semibold">{cartCopy.checkout.total}</span>
          <span className="font-shop-heading text-2xl font-semibold tracking-tight tabular-nums">{fmt(quote.totals.subtotal - discount + shipping)}</span>
        </div>
      ) : null}
    </div>
  );
}

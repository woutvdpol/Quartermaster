"use client";

import { useActionState } from "react";
import { PendingButton } from "./PendingButton";
import { applyCouponAction, removeCouponAction, type CouponFormState } from "./actions";
import { cartCopy } from "./_copy";

const t = cartCopy.coupon;

/**
 * Discount code field (cart page). Plain forms → works without JS. The applied code is validated
 * again by every quote and at placement; `problem` shows why it currently doesn't apply.
 */
export function CouponForm({ code, problem, hasOfferLines }: { code: string | null; problem: string | null; hasOfferLines: boolean }) {
  const [state, action] = useActionState<CouponFormState, FormData>(applyCouponAction, null);
  if (code) {
    return (
      <div className="flex flex-col gap-1.5 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span>
            {t.label}: <strong className="font-mono">{code}</strong>
          </span>
          <form action={removeCouponAction}>
            <PendingButton variant="link" size="sm">
              {t.remove}
            </PendingButton>
          </form>
        </div>
        {problem ? (
          <p role="alert" className="text-xs text-shop-crit">
            {problem}
          </p>
        ) : null}
        {hasOfferLines ? <p className="text-xs text-shop-muted">{t.offerNote}</p> : null}
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-1.5">
      <label htmlFor="cart-coupon" className="text-sm text-shop-ink-2">
        {t.label}
      </label>
      <div className="flex gap-2">
        <input
          id="cart-coupon"
          name="couponCode"
          maxLength={40}
          autoComplete="off"
          autoCapitalize="characters"
          placeholder={t.placeholder}
          aria-invalid={state && !state.ok ? true : undefined}
          aria-describedby={state ? "cart-coupon-msg" : undefined}
          className="h-10 min-w-0 flex-1 rounded-shop-sm border border-shop-line-strong bg-shop-surface px-3 text-sm uppercase text-shop-ink focus:border-shop-primary focus:outline-none"
        />
        <PendingButton variant="outline" size="sm" pendingLabel={t.applying} className="h-10!">
          {t.apply}
        </PendingButton>
      </div>
      {state ? (
        <p id="cart-coupon-msg" role={state.ok ? "status" : "alert"} className={state.ok ? "text-xs text-shop-ok" : "text-xs text-shop-crit"}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

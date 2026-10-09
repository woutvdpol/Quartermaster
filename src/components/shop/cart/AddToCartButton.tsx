"use client";

import Link from "@/components/shop/ui/Link";
import { usePathname } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { buttonClasses } from "@/components/shop/ui/Button";
import { cn } from "@/components/shop/ui/cn";
import { useHeaderCounts } from "@/components/shop/layout/HeaderCounts";
import { loginHref } from "@/server/customer-auth/redirect";
import { addToCartFormAction, cartLineStatusAction, type AddToCartState, type CartLineStatus } from "./actions";
import { ReservationCountdown } from "./ReservationCountdown";
import { useShopCopy } from "@/components/shop/i18n/ShopLocale";
import { cartCopies } from "./_copy";

function SubmitButton({ className }: { className?: string }) {
  const { pending } = useFormStatus();
  const t = useShopCopy(cartCopies).add;
  return (
    <button type="submit" aria-busy={pending || undefined} disabled={pending} className={buttonClasses("primary", "lg", cn("w-full", className))}>
      {pending ? t.adding : t.add}
    </button>
  );
}

function InCart({ expiresAt, justAdded }: { expiresAt: string | null; justAdded: boolean }) {
  const t = useShopCopy(cartCopies).add;
  return (
    <div className="flex flex-col gap-2" role="status" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2 text-sm text-shop-ink">
        <span className="font-medium">{justAdded ? t.added : t.inCart}</span>
        {expiresAt ? <ReservationCountdown expiresAt={expiresAt} refreshOnExpire={false} /> : null}
      </div>
      <div className="flex gap-2">
        <Link href="/cart" className={buttonClasses("outline", "lg", "flex-1")}>
          {t.viewCart}
        </Link>
        <Link href="/checkout" className={buttonClasses("primary", "lg", "flex-1")}>
          {t.checkout}
        </Link>
      </div>
    </div>
  );
}

/**
 * Add-to-cart for the product page: `<AddToCartButton productId={p.id} available={available} />`.
 *
 * Renders the same HTML for every visitor (cache-friendly). `available` comes from the (possibly cached)
 * product page and is false while ANY live reservation holds the item — so when it is false we ask the
 * server once whether that reservation is the visitor's own ("In your cart · Reserved for you 12:41").
 * The server re-checks everything on add: a stale `available` only results in a friendly message
 * ("Someone else has this in their cart — try again in N min").
 * Works without JavaScript (plain form POST to the server action).
 */
export function AddToCartButton({ productId, available }: { productId: string; available: boolean }) {
  const t = useShopCopy(cartCopies).add;
  const pathname = usePathname();
  const { setCounts } = useHeaderCounts();
  const [state, formAction] = useActionState<AddToCartState | null, FormData>(addToCartFormAction, null);
  const [own, setOwn] = useState<CartLineStatus | null>(null);

  useEffect(() => {
    if (available) return;
    let cancelled = false;
    cartLineStatusAction(productId)
      .then((s) => {
        if (!cancelled) setOwn(s);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [available, productId]);

  useEffect(() => {
    if (state && typeof state.count === "number") setCounts({ cart: state.count });
  }, [state, setCounts]);

  if (state?.ok) return <InCart expiresAt={state.expiresAt} justAdded={!state.alreadyInCart} />;
  if (own?.inCart && own.held) return <InCart expiresAt={own.expiresAt} justAdded={false} />;

  if (!available && !own?.inCart) {
    return (
      <button type="button" disabled aria-disabled="true" className={buttonClasses("primary", "lg", "w-full")}>
        {t.unavailable}
      </button>
    );
  }

  return (
    <form action={formAction} className="flex w-full flex-col gap-2">
      <input type="hidden" name="productId" value={productId} />
      <SubmitButton />
      {state && !state.ok ? (
        <p role="alert" className="text-sm font-medium text-shop-crit">
          {state.message}
          {state.code === "LOGIN_REQUIRED" ? (
            <>
              {" "}
              <Link href={loginHref(pathname)} className="underline underline-offset-2">
                {t.login}
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
    </form>
  );
}

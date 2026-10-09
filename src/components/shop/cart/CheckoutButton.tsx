"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { buttonClasses } from "@/components/shop/ui/Button";
import { prepareCheckoutAction, startCheckoutAction } from "./actions";
import { useShopCopy, useLocalizedHref } from "@/components/shop/i18n/ShopLocale";
import { cartCopies } from "./_copy";

/**
 * "Continue to checkout". Without JS the form posts to startCheckoutAction (303 → /checkout); with JS
 * it re-reserves via prepareCheckoutAction and navigates client-side (see actions.ts for why).
 */
export function CheckoutButton({ disabled }: { disabled?: boolean }) {
  const t = useShopCopy(cartCopies).cart;
  const href = useLocalizedHref();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <form
      action={startCheckoutAction}
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          await prepareCheckoutAction();
          router.push(href("/checkout"));
        });
      }}
    >
      <button type="submit" disabled={disabled || pending} aria-busy={pending || undefined} className={buttonClasses("primary", "lg", "w-full")}>
        {t.checkout}
      </button>
    </form>
  );
}

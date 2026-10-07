"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { buttonClasses } from "@/components/shop/ui/Button";
import { restoreCartAction } from "./actions";
import { cartCopy } from "./_copy";

const t = cartCopy.restore;

/**
 * Shown on /cart?restore=<token> (link from the abandoned-cart mail). Restoring changes the cart
 * cookie, so it is a button (POST), never automatic on GET.
 */
export function RestoreCartPrompt({ token }: { token: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  return (
    <div className="mb-6 flex flex-col gap-3 rounded-shop border border-shop-line bg-shop-primary-soft p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-medium text-shop-ink">{t.title}</p>
        <p className="text-sm text-shop-ink-2">{failed ? <span role="alert" className="text-shop-crit">{t.invalid}</span> : t.text}</p>
      </div>
      {!failed ? (
        <button
          type="button"
          disabled={pending}
          aria-busy={pending || undefined}
          className={buttonClasses("primary", "md")}
          onClick={() =>
            start(async () => {
              const res = await restoreCartAction(token);
              if (!res.ok) return setFailed(true);
              router.replace("/cart");
              router.refresh();
            })
          }
        >
          {pending ? t.restoring : t.button}
        </button>
      ) : null}
    </div>
  );
}

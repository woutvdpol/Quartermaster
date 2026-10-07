"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { buttonClasses } from "@/components/shop/ui/Button";
import { buyOfferAction, respondToCounterAction } from "./actions";
import { offerCopy as t } from "./_copy";

/** "Buy now" on /offer/<token>: adds the item at the agreed price and navigates to checkout. */
export function BuyOfferButton({ token, label }: { token: string; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={pending}
        aria-busy={pending || undefined}
        className={buttonClasses("primary", "lg", "w-full")}
        onClick={() =>
          start(async () => {
            const res = await buyOfferAction(token);
            if (res.ok) router.push(res.redirectTo);
            else setError(res.message);
          })
        }
      >
        {pending ? t.buying : label}
      </button>
      {error ? <p role="alert" className="text-sm text-shop-crit">{error}</p> : null}
    </div>
  );
}

/** Accept / decline buttons on /offer/counter/<token> (POST via server action). */
export function CounterButtons({ token, acceptLabel }: { token: string; acceptLabel: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const respond = (decision: "accept" | "decline") =>
    start(async () => {
      const res = await respondToCounterAction(token, decision);
      if (!res.ok) return setMessage({ ok: false, text: res.message });
      if (res.redirectTo) router.push(res.redirectTo);
      else setMessage({ ok: true, text: t.declined });
    });
  if (message?.ok) return <p role="status" className="text-shop-ink-2">{message.text}</p>;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={pending} onClick={() => respond("accept")} className={buttonClasses("primary", "lg")}>
          {acceptLabel}
        </button>
        <button type="button" disabled={pending} onClick={() => respond("decline")} className={buttonClasses("outline", "lg")}>
          {t.decline}
        </button>
      </div>
      {message ? <p role="alert" className="text-sm text-shop-crit">{message.text}</p> : null}
    </div>
  );
}

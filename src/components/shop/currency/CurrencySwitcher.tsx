"use client";

import { useId, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useShopCopy } from "@/components/shop/i18n/ShopLocale";
import { setDisplayCurrencyAction } from "./actions";
import { currencyCopies } from "./_copy";

/*
 * Tiny "Show prices also in" switcher for the shop header. Display only — checkout is always in
 * the shop currency (decision 17). Render it through <CurrencySwitcherSlot/> (server), which hides
 * it when the shop offers no display currencies or no rates are stored yet.
 */
export function CurrencySwitcher({
  shopCurrency,
  options,
  current,
  label,
  className,
}: {
  shopCurrency: string;
  options: string[];
  /** The visitor's choice, or null = shop currency only. */
  current: string | null;
  label?: string;
  className?: string;
}) {
  const t = useShopCopy(currencyCopies);
  const text = label ?? t.label;
  const id = useId();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  if (options.length === 0) return null;
  return (
    <span className={className}>
      <label htmlFor={id} className="sr-only">
        {text}
      </label>
      <select
        id={id}
        value={current ?? "off"}
        disabled={pending}
        aria-busy={pending || undefined}
        title={t.title(text, shopCurrency)}
        onChange={(e) => {
          const value = e.target.value;
          startTransition(async () => {
            await setDisplayCurrencyAction(value);
            router.refresh();
          });
        }}
        className="h-8 cursor-pointer rounded-shop-control border border-shop-line bg-transparent px-3 text-xs font-medium text-shop-ink-2 transition-colors hover:border-shop-line-strong hover:text-shop-ink"
      >
        <option value="off">{shopCurrency}</option>
        {options.map((c) => (
          <option key={c} value={c}>
            {shopCurrency} + ≈{c}
          </option>
        ))}
      </select>
    </span>
  );
}

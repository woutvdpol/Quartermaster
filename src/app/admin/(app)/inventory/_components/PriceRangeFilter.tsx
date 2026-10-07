"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { currencyDigits, currencySymbol, cx, formatMoneyInput, parseMoney } from "@/components/admin/ui";
import { copy } from "../_copy";

const t = copy.filters;

/**
 * Compact "Price from … to …" filter. Amounts are typed in the shop currency and written to the URL
 * as minor units (`pmin`, `pmax`). Applies on Enter / the Apply button. The page passes a `key`
 * so the inputs reset when the URL changes elsewhere (chips, "Clear filters").
 */
export function PriceRangeFilter({ min, max, currency, locale }: { min: number | null; max: number | null; currency: string; locale?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(false);
  const id = useId();
  const digits = currencyDigits(currency);
  const symbol = currencySymbol(currency, locale);

  function apply(form: HTMLFormElement) {
    const data = new FormData(form);
    const read = (name: string) => {
      const raw = String(data.get(name) ?? "").trim();
      if (!raw) return { ok: true as const, value: null };
      const v = parseMoney(raw, digits);
      return v === null || v < 0 ? { ok: false as const, value: null } : { ok: true as const, value: v };
    };
    const lo = read("pmin");
    const hi = read("pmax");
    if (!lo.ok || !hi.ok) {
      setError(true);
      return;
    }
    setError(false);
    const next = new URLSearchParams(searchParams.toString());
    next.delete("page");
    for (const [key, v] of [
      ["pmin", lo.value],
      ["pmax", hi.value],
    ] as const) {
      if (v === null) next.delete(key);
      else next.set(key, String(v));
    }
    const q = next.toString();
    startTransition(() => router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false }));
  }

  const input =
    "w-20 rounded-full border border-line bg-panel px-2.5 py-[3px] font-mono text-xs tabular-nums text-ink placeholder:text-muted aria-invalid:border-crit";

  return (
    <form
      role="search"
      aria-label={t.priceFrom}
      className="inline-flex items-center gap-1.5 text-xs text-muted"
      onSubmit={(e) => {
        e.preventDefault();
        apply(e.currentTarget);
      }}
    >
      <label htmlFor={`${id}-min`}>{t.priceFrom}</label>
      <input
        id={`${id}-min`}
        name="pmin"
        inputMode="decimal"
        autoComplete="off"
        placeholder={`${symbol} 0`}
        defaultValue={min === null ? "" : formatMoneyInput(min, currency, locale)}
        aria-invalid={error || undefined}
        className={input}
      />
      <label htmlFor={`${id}-max`}>{t.priceTo}</label>
      <input
        id={`${id}-max`}
        name="pmax"
        inputMode="decimal"
        autoComplete="off"
        placeholder={`${symbol} …`}
        defaultValue={max === null ? "" : formatMoneyInput(max, currency, locale)}
        aria-invalid={error || undefined}
        className={input}
      />
      <button
        type="submit"
        disabled={pending}
        className={cx("rounded-full border border-line px-2.5 py-[3px] text-xs text-ink hover:bg-panel-2", pending && "opacity-60")}
      >
        {t.apply}
      </button>
    </form>
  );
}

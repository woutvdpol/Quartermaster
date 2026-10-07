"use client";

import { ActionMessage, Checkbox, Money, MoneyInput, Select, StatusPill, TextInput, formatMoney } from "@/components/admin/ui";
import { COUNTRIES } from "@/server/shipping/countries";
import { PendingButton, useKeepForm } from "../../_system/client";
import { testQuoteAction } from "../actions";
import { formatWeight, UNAVAILABLE_REASON } from "../_util";

const COUNTRY_OPTIONS = Object.entries(COUNTRIES)
  .map(([value, label]) => ({ value, label: `${label} (${value})` }))
  .sort((a, b) => a.label.localeCompare(b.label));

/** "Test a quote": runs the real checkout calculation for a country, weight and subtotal. */
export function QuoteTester({ currency, defaultCountry, freeShippingThreshold }: { currency: string; defaultCountry: string; freeShippingThreshold: number }) {
  const { state, pending, error, onSubmit } = useKeepForm(testQuoteAction);
  const result = state?.ok ? state.data : undefined;

  return (
    <div className="grid gap-3">
      <form onSubmit={onSubmit} noValidate className="grid gap-3">
        <ActionMessage state={state} showSuccess={false} />
        <Select label="Country" name="countryCode" options={COUNTRY_OPTIONS} defaultValue={defaultCountry} error={error("countryCode")} />
        <div className="grid grid-cols-2 gap-3">
          <TextInput label="Weight" name="weightKg" inputMode="decimal" defaultValue="1" trailing="kg" inputClassName="font-mono" error={error("weightKg")} />
          <MoneyInput label="Subtotal" name="subtotal" currency={currency} defaultValue={10000} error={error("subtotal")} />
        </div>
        <Checkbox
          name="applyFreeShipping"
          defaultChecked={freeShippingThreshold > 0}
          disabled={freeShippingThreshold === 0}
          label="Apply free-shipping threshold"
          description={
            freeShippingThreshold > 0
              ? `From ${formatMoney(freeShippingThreshold, currency)} (Settings → Checkout).`
              : "No threshold set (Settings → Checkout)."
          }
        />
        <div>
          <PendingButton pending={pending} pendingLabel="Calculating…">
            Calculate
          </PendingButton>
        </div>
      </form>

      <div aria-live="polite">
        {result &&
          (result.deliverable ? (
            <div className="grid gap-2">
              {result.deliveryUnavailable && (
                <p className="text-xs text-warn">Home delivery not possible: {UNAVAILABLE_REASON[result.deliveryUnavailable]}</p>
              )}
              <ul className="grid gap-1.5">
                {result.options.map((o) => (
                  <li key={o.zoneId} className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-line bg-panel-2 px-2.5 py-2 text-[13px]">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <b className="font-medium">{o.name}</b>
                      {o.isPickup && <StatusPill tone="info">Pickup</StatusPill>}
                      {o.freeShipping && <StatusPill tone="ok">Free shipping</StatusPill>}
                      {o.maxWeightGrams !== null && <span className="text-xs text-muted">tier up to {formatWeight(o.maxWeightGrams)}</span>}
                      {o.insurance && (
                        <span className="text-xs text-muted">
                          + insurance <Money amount={o.insurance.price} currency={currency} />
                        </span>
                      )}
                    </span>
                    <span className="font-mono">
                      {o.freeShipping && (
                        <s className="mr-1.5 text-muted">
                          <Money amount={o.basePrice} currency={currency} />
                        </s>
                      )}
                      <Money amount={o.price} currency={currency} mono />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="rounded-control border border-crit/50 bg-crit-soft px-2.5 py-2 text-[13px]">
              <b>Not deliverable.</b> {UNAVAILABLE_REASON[result.detail]}
            </p>
          ))}
      </div>
    </div>
  );
}

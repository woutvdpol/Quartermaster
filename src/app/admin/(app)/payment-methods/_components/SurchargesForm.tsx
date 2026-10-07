"use client";

import { ActionMessage, ActionToast, FormActions, MoneyInput, SubmitButton, TextInput, useActionForm } from "@/components/admin/ui";
import { formatBps, type SurchargeRule } from "@/server/payments/surcharge";
import { saveSurchargesAction } from "../actions";

export type SurchargeRow = { id: string; description: string; rule: SurchargeRule | null };

/**
 * Surcharge per payment method (legacy Concept500: "PayPal 5%"). Percentage and/or fixed amount, an
 * optional cap and the label customers see. Leave percentage and amount empty for no surcharge.
 */
export function SurchargesForm({ rows, currency }: { rows: SurchargeRow[]; currency: string }) {
  const { state, formAction, error } = useActionForm(saveSurchargesAction);
  return (
    <form action={formAction} noValidate className="grid gap-4">
      <ActionMessage state={state} showSuccess={false} />
      <ActionToast state={state} errors={false} />
      <p className="text-[13px] text-ink-2">
        Charged on the order total before the surcharge (items − discount + shipping), rounded half up to the cent. When a method has a surcharge, the
        Mollie payment is limited to that method so customers can&apos;t switch on Mollie&apos;s page.
      </p>
      <div className="grid gap-0 rounded-control border border-line">
        {rows.map((m) => (
          <fieldset key={m.id} className="grid gap-3 border-b border-line px-3 py-3 last:border-b-0">
            <legend className="sr-only">{m.description}</legend>
            <input type="hidden" name="method" value={m.id} />
            <div className="text-[13px] font-medium">
              {m.description} <span className="font-mono text-[12px] text-muted">{m.id}</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <TextInput
                label="Percentage"
                name={`pct.${m.id}`}
                inputMode="decimal"
                defaultValue={m.rule && m.rule.percentBps > 0 ? formatBps(m.rule.percentBps) : ""}
                placeholder="0"
                trailing="%"
                hint="Max 20%"
                error={error(`pct.${m.id}`)}
              />
              <MoneyInput label="Fixed amount" name={`fixed.${m.id}`} currency={currency} defaultValue={m.rule?.fixed || null} error={error(`fixed.${m.id}`)} />
              <MoneyInput label="Maximum" name={`cap.${m.id}`} currency={currency} defaultValue={m.rule?.cap ?? null} hint="Optional" error={error(`cap.${m.id}`)} />
            </div>
            <TextInput
              label="Label for customers"
              name={`label.${m.id}`}
              maxLength={60}
              defaultValue={m.rule?.label ?? ""}
              placeholder={`${m.description} fee`}
              error={error(`label.${m.id}`)}
            />
          </fieldset>
        ))}
      </div>
      <FormActions>
        <SubmitButton>Save surcharges</SubmitButton>
      </FormActions>
    </form>
  );
}

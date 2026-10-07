"use client";

import { ActionMessage, Select, StatusPill, TextInput } from "@/components/admin/ui";
import { COUNTRIES } from "@/server/shipping/countries";
import { ACTION_LABELS } from "@/server/compliance/presets";
import { PendingButton, useKeepForm } from "../../_system/client";
import { copy } from "../_copy";
import { testRuleAction } from "../actions";

const t = copy.test;
const COUNTRY_OPTIONS = Object.entries(COUNTRIES)
  .map(([value, label]) => ({ value, label: `${label} (${value})` }))
  .sort((a, b) => a.label.localeCompare(b.label));

/** Country + stock code → verdict, using the real resolution code with the saved rules. */
export function TestBox({ defaultCountry }: { defaultCountry: string }) {
  const { state, pending, error, onSubmit } = useKeepForm(testRuleAction);
  const result = state?.ok ? state.data : undefined;
  const v = result?.verdict;
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted">{t.intro}</p>
      <form onSubmit={onSubmit} noValidate className="grid gap-3">
        <ActionMessage state={state} showSuccess={false} />
        <Select label={t.country} name="countryCode" options={COUNTRY_OPTIONS} defaultValue={defaultCountry} error={error("countryCode")} />
        <TextInput label={t.stockCode} name="stockCode" inputMode="numeric" inputClassName="font-mono" placeholder="50231" error={error("stockCode")} />
        <div>
          <PendingButton pending={pending} pendingLabel={t.pending}>
            {t.submit}
          </PendingButton>
        </div>
      </form>
      <div aria-live="polite">
        {result && v && (
          <div className="grid gap-2 rounded-control border border-line bg-panel-2 px-3 py-2.5 text-[13px]">
            <p>
              <span className="font-mono text-muted">#{result.product.stockCode}</span> <b className="font-medium">{result.product.title}</b>
            </p>
            {v.reasons.length === 0 ? (
              <p className="text-ok">{t.clear}</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {v.hidden && <StatusPill tone="crit">{t.hidden}</StatusPill>}
                  {v.blurred && <StatusPill tone="warn">{t.blurred}</StatusPill>}
                  {v.noShipping && <StatusPill tone="warn">{t.noShipping}</StatusPill>}
                </div>
                <p className="type-label text-[11.5px] text-muted">{t.matched}</p>
                <ul className="grid gap-1">
                  {v.reasons.map((r) => (
                    <li key={`${r.ruleId}-${r.action}`}>
                      {r.name} — {ACTION_LABELS[r.action]}
                      {r.note ? <span className="text-muted"> ({r.note})</span> : null}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

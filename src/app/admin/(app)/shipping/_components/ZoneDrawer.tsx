"use client";

import { useState } from "react";
import { ActionMessage, Button, Drawer, MoneyInput, Switch, TextInput, toast, type ButtonSize, type ButtonVariant } from "@/components/admin/ui";
import { PendingButton, useKeepForm } from "../../_system/client";
import { saveZoneAction } from "../actions";
import { formatWeight, parseKg } from "../_util";
import { CountryPicker } from "./CountryPicker";

export type ZoneData = {
  id: string;
  name: string;
  countries: string[];
  isPickup: boolean;
  isActive: boolean;
  rates: { maxWeightGrams: number; price: number; insurancePrice: number | null; maxInsuredValue: number | null }[];
};

type RateRow = { key: number; kg: string; price: number | null; insurancePrice: number | null; maxInsuredValue: number | null };

let rowKey = 0;
const toRows = (rates: ZoneData["rates"]): RateRow[] =>
  rates.map((r) => ({ key: ++rowKey, kg: String(r.maxWeightGrams / 1000), price: r.price, insurancePrice: r.insurancePrice, maxInsuredValue: r.maxInsuredValue }));

type Props = {
  zone?: ZoneData;
  currency: string;
  /** Country → zone name for every OTHER delivery zone. */
  taken: Record<string, string>;
  restOfWorldTakenBy: string | null;
  trigger: string;
  triggerVariant?: ButtonVariant;
  triggerSize?: ButtonSize;
};

/** Create / edit a shipping zone and its weight tiers in a side drawer. */
export function ZoneDrawer({ zone, currency, taken, restOfWorldTakenBy, trigger, triggerVariant = "secondary", triggerSize = "md" }: Props) {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  return (
    <>
      <Button variant={triggerVariant} size={triggerSize} aria-haspopup="dialog" onClick={() => { setSession((s) => s + 1); setOpen(true); }}>
        {trigger}
      </Button>
      <Drawer
        open={open}
        onOpenChange={setOpen}
        size="xl"
        title={zone ? `Edit zone “${zone.name}”` : "New shipping zone"}
        description="A country can be in only one delivery zone. Pickup zones are exempt."
      >
        {open && (
          <ZoneForm
            key={session}
            zone={zone}
            currency={currency}
            taken={taken}
            restOfWorldTakenBy={zone?.countries.includes("*") ? null : restOfWorldTakenBy}
            onDone={() => setOpen(false)}
          />
        )}
      </Drawer>
    </>
  );
}

function ZoneForm({ zone, currency, taken, restOfWorldTakenBy, onDone }: Omit<Props, "trigger" | "triggerVariant" | "triggerSize"> & { onDone: () => void }) {
  const [countries, setCountries] = useState<string[]>(zone ? zone.countries.filter((c) => c !== "*") : []);
  const [restOfWorld, setRestOfWorld] = useState(zone?.countries.includes("*") ?? false);
  const [isPickup, setIsPickup] = useState(zone?.isPickup ?? false);
  const [rows, setRows] = useState<RateRow[]>(() =>
    zone ? toRows(zone.rates) : [{ key: ++rowKey, kg: "2", price: null, insurancePrice: null, maxInsuredValue: null }],
  );
  const { state, pending, error, onSubmit } = useKeepForm(saveZoneAction, {
    onSuccess: (s) => {
      if (s.message) toast.ok(s.message);
      onDone();
    },
  });

  const serialized = JSON.stringify(
    rows.map((r) => ({
      maxWeightGrams: parseKg(r.kg) ?? -1,
      price: r.price ?? -1,
      insurancePrice: r.insurancePrice,
      maxInsuredValue: r.insurancePrice === null ? null : r.maxInsuredValue,
    })),
  );
  const update = (key: number, patch: Partial<RateRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const rateError = (i: number, field: string) => error(`rates.${i}.${field}`);
  const ratesFormError = error("rates");

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5">
      <ActionMessage state={state} showSuccess={false} />
      {zone && <input type="hidden" name="id" value={zone.id} />}
      <input type="hidden" name="rates" value={serialized} />

      <TextInput label="Zone name" name="name" defaultValue={zone?.name} required maxLength={100} placeholder="e.g. Benelux" error={error("name")} />

      <div className="grid gap-1">
        <Switch
          layout="row"
          name="isPickup"
          label="Pickup in store"
          description="Customers collect the order. Weight is ignored; the price is the first tier (or free without tiers). Leave countries empty to offer pickup to everyone."
          checked={isPickup}
          onChange={(e) => setIsPickup(e.currentTarget.checked)}
        />
        <Switch layout="row" name="isActive" label="Active" description="Inactive zones are not offered at checkout." defaultChecked={zone?.isActive ?? true} />
      </div>

      <CountryPicker
        value={countries}
        onChange={setCountries}
        restOfWorld={restOfWorld}
        onRestOfWorldChange={setRestOfWorld}
        taken={taken}
        enforceTaken={!isPickup}
        restOfWorldTakenBy={restOfWorldTakenBy}
        error={error("countries")}
      />

      <fieldset className="grid gap-2">
        <legend className="type-label mb-1 text-[11.5px] text-muted">Weight tiers</legend>
        <p className="text-xs text-muted">
          A parcel uses the first tier whose maximum weight fits. Heavier than the last tier means this zone does not deliver it.
        </p>
        {rows.length === 0 ? (
          <p className="rounded-control border border-dashed border-line px-3 py-3 text-[13px] text-muted">
            No tiers. {isPickup ? "Pickup will be free." : "A delivery zone without tiers offers no delivery."}
          </p>
        ) : (
          <div className="grid gap-2">
            <div className="hidden grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2 sm:grid" aria-hidden="true">
              {["Up to (kg)", "Price", "Insurance (optional)", "Insured up to (optional)", ""].map((h) => (
                <span key={h} className="type-label text-[11px] text-muted">
                  {h}
                </span>
              ))}
            </div>
            {rows.map((r, i) => {
              const grams = parseKg(r.kg);
              return (
                <div key={r.key} className="grid grid-cols-2 items-start gap-2 rounded-control border border-line p-2 sm:grid-cols-[1fr_1fr_1fr_1fr_auto] sm:border-0 sm:p-0">
                  <TextInput
                    label={`Tier ${i + 1} maximum weight`}
                    labelHidden
                    name={`tier-${r.key}-kg`}
                    inputMode="decimal"
                    value={r.kg}
                    onChange={(e) => update(r.key, { kg: e.target.value })}
                    trailing="kg"
                    inputClassName="font-mono"
                    error={rateError(i, "maxWeightGrams") ?? (r.kg !== "" && grams === null ? "Enter a weight." : undefined)}
                    hint={grams !== null && grams > 0 ? formatWeight(grams) : undefined}
                  />
                  <MoneyInput
                    label={`Tier ${i + 1} price`}
                    labelHidden
                    name={`tier-${r.key}-price`}
                    currency={currency}
                    value={r.price}
                    onValueChange={(v) => update(r.key, { price: v })}
                    error={rateError(i, "price")}
                  />
                  <MoneyInput
                    label={`Tier ${i + 1} insurance price`}
                    labelHidden
                    name={`tier-${r.key}-ins`}
                    currency={currency}
                    value={r.insurancePrice}
                    onValueChange={(v) => update(r.key, { insurancePrice: v })}
                    placeholder="No insurance"
                    error={rateError(i, "insurancePrice")}
                  />
                  <MoneyInput
                    label={`Tier ${i + 1} maximum insured value`}
                    labelHidden
                    name={`tier-${r.key}-insmax`}
                    currency={currency}
                    value={r.maxInsuredValue}
                    onValueChange={(v) => update(r.key, { maxInsuredValue: v })}
                    disabled={r.insurancePrice === null}
                    placeholder="No limit"
                    error={rateError(i, "maxInsuredValue")}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="self-center"
                    aria-label={`Remove tier ${i + 1}`}
                    onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                  >
                    Remove
                  </Button>
                </div>
              );
            })}
          </div>
        )}
        {ratesFormError && <p className="text-xs text-crit">{ratesFormError}</p>}
        <div>
          <Button
            size="sm"
            onClick={() => {
              const last = rows.length ? parseKg(rows[rows.length - 1].kg) : null;
              const nextKg = last ? String(Math.max(1, Math.ceil(last / 1000) * 2)) : "2";
              setRows((rs) => [...rs, { key: ++rowKey, kg: nextKg, price: null, insurancePrice: null, maxInsuredValue: null }]);
            }}
          >
            + Add tier
          </Button>
        </div>
      </fieldset>

      <div className="sticky bottom-0 -mx-4 -mb-4 flex justify-end gap-2 border-t border-line bg-panel px-4 py-3">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <PendingButton pending={pending}>{zone ? "Save zone" : "Create zone"}</PendingButton>
      </div>
    </form>
  );
}

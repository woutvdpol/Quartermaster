"use client";

import { useId, useState } from "react";
import { Button, Checkbox, controlClass } from "@/components/admin/ui";
import { COUNTRIES, type CountryCode } from "@/server/shipping/countries";
import { COUNTRY_PRESETS } from "@/server/compliance/presets";
import { copy } from "../_copy";

const f = copy.form;
const ALL = (Object.entries(COUNTRIES) as [CountryCode, string][]).sort((a, b) => a[1].localeCompare(b[1]));

/** Multi-select of countries with presets (DE+AT §86a, France, EU). Submits one `countries` entry per code. */
export function CountrySelect({ value, onChange, error }: { value: string[]; onChange: (next: string[]) => void; error?: string }) {
  const [q, setQ] = useState("");
  const baseId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const selected = new Set(value);
  const needle = q.trim().toLowerCase();
  const visible = needle ? ALL.filter(([code, name]) => code.toLowerCase() === needle || name.toLowerCase().includes(needle)) : ALL;
  const set = (codes: Iterable<string>) => onChange([...new Set(codes)].sort());
  const toggle = (code: string, on: boolean) => {
    const next = new Set(value);
    if (on) next.add(code);
    else next.delete(code);
    set(next);
  };

  return (
    <fieldset className="grid gap-2.5" aria-describedby={error ? `${baseId}-err` : undefined}>
      <legend className="type-label mb-1 text-[11.5px] text-muted">{f.countries}</legend>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={f.presets}>
        {COUNTRY_PRESETS.map((p) => (
          <Button key={p.id} size="sm" onClick={() => set([...value, ...p.countries])}>
            + {p.label}
          </Button>
        ))}
        <Button size="sm" variant="ghost" onClick={() => onChange([])} disabled={value.length === 0}>
          {f.clear}
        </Button>
        <span className="ml-auto text-xs text-muted" aria-live="polite">
          {f.selected(value.length)}
        </span>
      </div>
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1" aria-label={f.countries}>
          {value.map((code) => (
            <li key={code}>
              <button
                type="button"
                onClick={() => toggle(code, false)}
                aria-label={`Remove ${COUNTRIES[code as CountryCode] ?? code}`}
                title={`Remove ${COUNTRIES[code as CountryCode] ?? code}`}
                className="inline-flex items-center gap-1 rounded-control border border-line bg-panel-2 px-1.5 py-px font-mono text-[11.5px] text-ink-2 hover:border-crit hover:text-crit"
              >
                {code} <span aria-hidden="true">×</span>
              </button>
              <input type="hidden" name="countries" value={code} />
            </li>
          ))}
        </ul>
      )}
      <input type="search" aria-label={f.searchCountries} placeholder={f.searchCountries} value={q} onChange={(e) => setQ(e.target.value)} className={controlClass} />
      <div className="max-h-52 overflow-y-auto rounded-control border border-line bg-panel">
        {visible.length === 0 ? (
          <p className="px-3 py-4 text-center text-[13px] text-muted">{f.noCountry(q)}</p>
        ) : (
          <ul className="grid">
            {visible.map(([code, name]) => (
              <li key={code} className="border-b border-line px-2.5 py-1.5 last:border-b-0">
                <Checkbox
                  label={
                    <span className="flex items-baseline gap-2">
                      <span className="w-7 font-mono text-[12px] text-muted">{code}</span>
                      <span>{name}</span>
                    </span>
                  }
                  checked={selected.has(code)}
                  onChange={(e) => toggle(code, e.currentTarget.checked)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
      {error && (
        <p id={`${baseId}-err`} className="text-xs text-crit">
          {error}
        </p>
      )}
    </fieldset>
  );
}

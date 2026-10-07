"use client";

import { useId, useMemo, useState } from "react";
import { Button, Checkbox, cx, controlClass } from "@/components/admin/ui";
import { BENELUX_COUNTRIES, COUNTRIES, EU_COUNTRIES, type CountryCode } from "@/server/shipping/countries";

const ALL = (Object.entries(COUNTRIES) as [CountryCode, string][]).sort((a, b) => a[1].localeCompare(b[1]));

type Props = {
  /** Selected ISO codes (without "*"). */
  value: string[];
  onChange: (next: string[]) => void;
  restOfWorld: boolean;
  onRestOfWorldChange: (on: boolean) => void;
  /** Country → name of another delivery zone that already has it (only enforced for delivery zones). */
  taken: Record<string, string>;
  enforceTaken: boolean;
  /** Another delivery zone already is the rest-of-world zone. */
  restOfWorldTakenBy: string | null;
  error?: string;
};

/**
 * Multi-select of countries: search, EU/Benelux presets, chips for the selection, and a
 * "rest of world" option (exclusive). Submits one `countries` entry per selected code.
 */
export function CountryPicker({ value, onChange, restOfWorld, onRestOfWorldChange, taken, enforceTaken, restOfWorldTakenBy, error }: Props) {
  const [q, setQ] = useState("");
  const baseId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const selected = useMemo(() => new Set(value), [value]);
  const needle = q.trim().toLowerCase();
  const visible = needle ? ALL.filter(([code, name]) => code.toLowerCase() === needle || name.toLowerCase().includes(needle)) : ALL;

  const available = (code: string) => !enforceTaken || !taken[code];
  function addAll(codes: readonly string[]) {
    const next = new Set(value);
    for (const c of codes) if (available(c)) next.add(c);
    onChange([...next].sort());
  }
  function toggle(code: string, on: boolean) {
    const next = new Set(value);
    if (on) next.add(code);
    else next.delete(code);
    onChange([...next].sort());
  }

  return (
    <fieldset className="grid gap-2.5" aria-describedby={error ? `${baseId}-err` : undefined}>
      <legend className="type-label mb-1 text-[11.5px] text-muted">Countries</legend>

      <Checkbox
        label="Rest of world"
        description={
          restOfWorldTakenBy && enforceTaken
            ? `Already used by “${restOfWorldTakenBy}”. Only one delivery zone can be the rest of world.`
            : "Every country that no other delivery zone lists."
        }
        checked={restOfWorld}
        disabled={Boolean(restOfWorldTakenBy && enforceTaken && !restOfWorld)}
        onChange={(e) => onRestOfWorldChange(e.currentTarget.checked)}
        name="restOfWorld"
      />

      {!restOfWorld && (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="sm" onClick={() => addAll(BENELUX_COUNTRIES)}>
              + Benelux
            </Button>
            <Button size="sm" onClick={() => addAll(EU_COUNTRIES)}>
              + EU ({EU_COUNTRIES.length})
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onChange([])} disabled={value.length === 0}>
              Clear
            </Button>
            <span className="ml-auto text-xs text-muted" aria-live="polite">
              {value.length} selected
            </span>
          </div>

          {value.length > 0 && (
            <ul className="flex flex-wrap gap-1" aria-label="Selected countries">
              {value.map((code) => (
                <li key={code}>
                  <button
                    type="button"
                    onClick={() => toggle(code, false)}
                    title={`Remove ${COUNTRIES[code as CountryCode] ?? code}`}
                    aria-label={`Remove ${COUNTRIES[code as CountryCode] ?? code}`}
                    className="inline-flex items-center gap-1 rounded-control border border-line bg-panel-2 px-1.5 py-px font-mono text-[11.5px] text-ink-2 hover:border-crit hover:text-crit"
                  >
                    {code} <span aria-hidden="true">×</span>
                  </button>
                  <input type="hidden" name="countries" value={code} />
                </li>
              ))}
            </ul>
          )}

          <input
            type="search"
            aria-label="Search countries"
            placeholder="Search country or code…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className={controlClass}
          />
          <div className="max-h-60 overflow-y-auto rounded-control border border-line bg-panel">
            {visible.length === 0 ? (
              <p className="px-3 py-4 text-center text-[13px] text-muted">No country matches “{q}”.</p>
            ) : (
              <ul className="grid">
                {visible.map(([code, name]) => {
                  const owner = taken[code];
                  const blocked = enforceTaken && Boolean(owner) && !selected.has(code);
                  return (
                    <li key={code} className={cx("border-b border-line px-2.5 py-1.5 last:border-b-0", blocked && "bg-panel-2")}>
                      <Checkbox
                        label={
                          <span className="flex flex-wrap items-baseline gap-x-2">
                            <span className="w-7 font-mono text-[12px] text-muted">{code}</span>
                            <span>{name}</span>
                            {owner && <span className="text-xs text-muted">in “{owner}”</span>}
                          </span>
                        }
                        checked={selected.has(code)}
                        disabled={blocked}
                        onChange={(e) => toggle(code, e.currentTarget.checked)}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
      {error && (
        <p id={`${baseId}-err`} className="text-xs text-crit">
          {error}
        </p>
      )}
    </fieldset>
  );
}

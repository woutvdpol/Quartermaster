"use client";

import { useId, useRef, useState } from "react";
import { Button, controlClass, cx, labelClass } from "@/components/admin/ui";
import { copy } from "../_copy";

type Row = { key: string; label: string; value: string };

const t = copy.specs;

/**
 * Ordered label/value rows. Submits `specLabel` / `specValue` pairs (same index) to the product form
 * via the `form` attribute. `errors` holds messages keyed like "specifications.3.label".
 */
export function SpecificationsEditor({
  form,
  defaultValue,
  errors,
}: {
  form: string;
  defaultValue: { label: string; value: string }[];
  errors?: Record<string, string[] | undefined>;
}) {
  // Deterministic keys for the initial rows (they end up in data-* attributes, so SSR must match).
  const [rows, setRows] = useState<Row[]>(() => defaultValue.map((r, i) => ({ ...r, key: `r${i}` })));
  const seq = useRef(0);
  const [announcement, setAnnouncement] = useState("");
  const listRef = useRef<HTMLOListElement>(null);
  const baseId = useId();

  function update(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }
  function move(i: number, to: number) {
    if (to < 0 || to >= rows.length) return;
    const next = [...rows];
    const [r] = next.splice(i, 1);
    next.splice(to, 0, r);
    setRows(next);
    setAnnouncement(`Row moved to position ${to + 1} of ${next.length}.`);
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLButtonElement>(`[data-row="${r.key}"][data-dir="${to < i ? "up" : "down"}"]:not(:disabled)`)?.focus());
  }
  function remove(i: number) {
    setRows((rs) => rs.filter((_, j) => j !== i));
    setAnnouncement("Row removed.");
  }
  function add() {
    const key = `n${++seq.current}`;
    setRows((rs) => [...rs, { key, label: "", value: "" }]);
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLInputElement>(`[data-label="${key}"]`)?.focus());
  }

  return (
    <fieldset className="grid gap-2">
      <legend className={cx(labelClass, "mb-1")}>{copy.fields.specifications}</legend>
      {rows.length === 0 && <p className="text-[13px] text-muted">{t.empty}</p>}
      {rows.length > 0 && (
        <ol ref={listRef} className="grid gap-2">
          {rows.map((r, i) => {
            const labelError = errors?.[`specifications.${i}.label`]?.[0];
            const valueError = errors?.[`specifications.${i}.value`]?.[0];
            const lid = `${baseId}-l${i}`;
            const vid = `${baseId}-v${i}`;
            return (
              <li key={r.key} className="grid gap-1">
                <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] items-start gap-2">
                  <input
                    id={lid}
                    form={form}
                    name="specLabel"
                    data-label={r.key}
                    value={r.label}
                    maxLength={200}
                    placeholder={t.labelPlaceholder}
                    aria-label={`${t.label} ${i + 1}`}
                    aria-invalid={labelError ? true : undefined}
                    aria-describedby={labelError ? `${lid}-e` : undefined}
                    onChange={(e) => update(i, { label: e.target.value })}
                    className={cx(controlClass, labelError && "border-crit")}
                  />
                  <input
                    id={vid}
                    form={form}
                    name="specValue"
                    value={r.value}
                    maxLength={2000}
                    placeholder={t.valuePlaceholder}
                    aria-label={`${t.value} ${i + 1}`}
                    aria-invalid={valueError ? true : undefined}
                    aria-describedby={valueError ? `${vid}-e` : undefined}
                    onChange={(e) => update(i, { value: e.target.value })}
                    className={cx(controlClass, valueError && "border-crit")}
                  />
                  <span className="flex gap-1">
                    <RowButton label={t.up(i + 1)} disabled={i === 0} data-row={r.key} data-dir="up" onClick={() => move(i, i - 1)}>
                      ↑
                    </RowButton>
                    <RowButton label={t.down(i + 1)} disabled={i === rows.length - 1} data-row={r.key} data-dir="down" onClick={() => move(i, i + 1)}>
                      ↓
                    </RowButton>
                    <RowButton label={t.remove(i + 1)} danger onClick={() => remove(i)}>
                      ×
                    </RowButton>
                  </span>
                </div>
                {labelError && (
                  <p id={`${lid}-e`} className="text-xs text-crit">
                    {labelError}
                  </p>
                )}
                {valueError && (
                  <p id={`${vid}-e`} className="text-xs text-crit">
                    {valueError}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}
      <div>
        <Button size="sm" onClick={add} disabled={rows.length >= 100}>
          + {t.add}
        </Button>
      </div>
      <span role="status" className="sr-only">
        {announcement}
      </span>
    </fieldset>
  );
}

function RowButton({
  label,
  children,
  danger,
  ...props
}: { label: string; danger?: boolean; children: React.ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement> & Record<`data-${string}`, string>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...props}
      className={cx(
        "grid size-8 place-items-center rounded-control border border-line bg-panel text-sm text-ink hover:bg-panel-2",
        "disabled:cursor-not-allowed disabled:opacity-35",
        danger && "text-crit hover:bg-crit-soft",
      )}
    >
      <span aria-hidden="true">{children}</span>
    </button>
  );
}

"use client";

import { useState, type ReactNode } from "react";
import {
  ActionMessage,
  ActionToast,
  Card,
  Checkbox,
  FormActions,
  MoneyInput,
  NumberInput,
  RadioGroup,
  SegmentedControl,
  Select,
  Switch,
  TagInput,
  Textarea,
  TextInput,
  Field,
  controlClass,
  type ActionResult,
  type ActionState,
} from "@/components/admin/ui";
import { COUNTRIES } from "@/server/shipping/countries";
import { PendingButton, useKeepForm } from "../../_system/client";
import { FONT_OPTIONS, getPath, type SettingField, type SettingSection } from "../_fields";

const COUNTRY_OPTIONS = Object.entries(COUNTRIES)
  .map(([value, label]) => ({ value, label }))
  .sort((a, b) => a.label.localeCompare(b.label));

type Props = {
  formId: string;
  sections: SettingSection[];
  values: unknown;
  currency: string;
  action: (prev: ActionState, formData: FormData) => Promise<ActionResult>;
  /** Extra content rendered above the sections (read-only info cards). */
  before?: ReactNode;
};

export function SettingsForm({ formId, sections, values, currency, action, before }: Props) {
  const { state, pending, error, onSubmit } = useKeepForm(action);
  return (
    <form id={formId} onSubmit={onSubmit} noValidate className="grid min-w-0 content-start gap-4">
      <ActionMessage state={state} showSuccess={false} />
      <ActionToast state={state} errors={false} />
      {before}
      {sections.map((section) => (
        <Card key={section.title} title={section.title} aside={section.description}>
          <div className="grid gap-4">
            {groupRows(section.fields).map((row, i) =>
              row.kind === "switches" ? (
                <div key={i} className="grid">
                  {row.fields.map((f) => (
                    <Switch
                      key={f.path}
                      layout="row"
                      name={f.path}
                      label={f.label}
                      description={f.description}
                      defaultChecked={Boolean(getPath(values, f.path))}
                      error={error(f.path)}
                    />
                  ))}
                </div>
              ) : (
                <div key={i} className="max-w-xl">
                  <FieldControl field={row.field} value={getPath(values, row.field.path)} error={error(row.field.path)} currency={currency} />
                </div>
              ),
            )}
          </div>
        </Card>
      ))}
      <FormActions sticky start="Changes are live in the shop as soon as you save.">
        <PendingButton pending={pending}>Save changes</PendingButton>
      </FormActions>
    </form>
  );
}

/** Consecutive switches render as one block of settings rows (design A `.srow`). */
function groupRows(fields: SettingField[]) {
  const rows: ({ kind: "switches"; fields: SettingField[] } | { kind: "field"; field: SettingField })[] = [];
  for (const f of fields) {
    const last = rows[rows.length - 1];
    if (f.kind === "switch" && last?.kind === "switches") last.fields.push(f);
    else if (f.kind === "switch") rows.push({ kind: "switches", fields: [f] });
    else rows.push({ kind: "field", field: f });
  }
  return rows;
}

function str(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}

function FieldControl({ field: f, value, error, currency }: { field: SettingField; value: unknown; error?: string; currency: string }) {
  switch (f.kind) {
    case "text":
    case "email":
    case "url":
      return (
        <TextInput
          label={f.label}
          hint={f.description}
          name={f.path}
          type={f.kind === "text" ? "text" : f.kind}
          defaultValue={str(value)}
          maxLength={f.maxLength}
          placeholder={f.placeholder}
          inputClassName={f.mono ? "font-mono" : undefined}
          error={error}
          showOptional={f.nullable}
        />
      );
    case "textarea":
      return <Textarea label={f.label} hint={f.description} name={f.path} defaultValue={str(value)} maxLength={f.maxLength} rows={f.rows} error={error} />;
    case "number":
      return (
        <div className="max-w-60">
          <NumberInput
            label={f.label}
            hint={f.description}
            name={f.path}
            defaultValue={str(value)}
            min={f.min}
            max={f.max}
            step={f.step ?? (f.integer ? 1 : "any")}
            inputMode={f.integer ? "numeric" : "decimal"}
            placeholder={f.placeholder}
            trailing={f.unit}
            error={error}
            showOptional={f.nullable}
          />
        </div>
      );
    case "money":
      return (
        <div className="max-w-60">
          <MoneyInput label={f.label} hint={f.description} name={f.path} defaultValue={typeof value === "number" ? value : 0} currency={currency} error={error} />
        </div>
      );
    case "select":
      return <Select label={f.label} hint={f.description} name={f.path} defaultValue={str(value)} options={f.options} error={error} />;
    case "segmented":
      return (
        <div className="max-w-72">
          <SegmentedControl name={f.path} legend={f.label} hint={f.description} options={f.options} defaultValue={str(value)} error={error} />
        </div>
      );
    case "radio":
      return <RadioGroup name={f.path} legend={f.label} hint={f.description} options={f.options} defaultValue={str(value)} error={error} />;
    case "font":
      return <Select label={f.label} hint={f.description} name={f.path} defaultValue={str(value)} options={FONT_OPTIONS} error={error} />;
    case "country":
      return <Select label={f.label} hint={f.description} name={f.path} defaultValue={str(value)} options={COUNTRY_OPTIONS} placeholder="Not set" error={error} />;
    case "color":
      return <ColorField label={f.label} hint={f.description} name={f.path} defaultValue={str(value)} error={error} />;
    case "multicheck": {
      const selected = new Set(Array.isArray(value) ? value.map(String) : []);
      return (
        <fieldset className="grid gap-2">
          <legend className="type-label mb-1 text-[11.5px] text-muted">{f.label}</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {f.options.map((o) => (
              <Checkbox key={o.value} name={f.path} value={o.value} label={<span className="font-mono">{o.label}</span>} defaultChecked={selected.has(o.value)} />
            ))}
          </div>
          {f.description && <p className="text-xs text-muted">{f.description}</p>}
          {error && <p className="text-xs text-crit">{error}</p>}
        </fieldset>
      );
    }
    case "tags":
      return (
        <TagInput
          label={f.label}
          hint={f.description}
          name={f.path}
          defaultValue={Array.isArray(value) ? value.map(String) : []}
          maxTags={f.maxTags}
          placeholder={f.placeholder}
          error={error}
        />
      );
    case "storedPath":
      return (
        <Field label={f.label} hint={f.description}>
          {(p) => <input {...p} readOnly value={str(value) || "Not set"} className={`${controlClass} font-mono text-[12.5px]`} />}
        </Field>
      );
    case "switch":
      return null;
  }
}

/** Hex colour: native colour picker (swatch) + text field, kept in sync. Submits the text field. */
function ColorField({ label, hint, name, defaultValue, error }: { label: string; hint?: string; name: string; defaultValue: string; error?: string }) {
  const [text, setText] = useState(defaultValue);
  const valid = /^#[0-9a-fA-F]{6}$/.test(text);
  return (
    <Field label={label} hint={hint} error={error}>
      {(p) => (
        <span className="flex max-w-60 items-center gap-2">
          <input
            type="color"
            aria-label={`${label} picker`}
            value={valid ? text.toLowerCase() : "#000000"}
            onChange={(e) => setText(e.target.value)}
            className="h-[34px] w-11 shrink-0 cursor-pointer rounded-control border border-line bg-panel p-0.5"
          />
          <input
            {...p}
            name={name}
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            maxLength={7}
            placeholder="#000000"
            className={`${controlClass} font-mono`}
          />
        </span>
      )}
    </Field>
  );
}

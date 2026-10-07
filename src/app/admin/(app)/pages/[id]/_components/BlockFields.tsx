"use client";

import { useId, type ReactNode } from "react";
import {
  Button,
  Checkbox,
  NumberInput,
  SegmentedControl,
  TextInput,
  Textarea,
  Thumb,
  cx,
  errorClass,
  hintClass,
  labelClass,
} from "@/components/admin/ui";
import { MAX_MARKDOWN_LENGTH } from "@/server/content/markdown";
import { sanitizeUrl } from "@/server/content/url";
import { copy } from "../../_copy";
import { Markdown } from "../../_components/Markdown";
import { issuesFor, storageImageUrl, type BlockDraft, type FieldSpec } from "../../_lib/block-fields";
import type { EditorContextValue } from "./types";

const f = copy.fields;
const ti = copy.image;

type FieldsProps = {
  blockId: string;
  specs: FieldSpec[];
  draft: BlockDraft;
  onChange: (key: string, value: unknown) => void;
  /** Issues keyed by data path (`title`, `cta.href`, `imageKeys.2`). */
  errors: Record<string, string[]>;
  editor: EditorContextValue;
};

/** The edit form for one block, generated from its field specs. */
export function BlockFields({ blockId, specs, draft, onChange, errors, editor }: FieldsProps) {
  return (
    <div className="grid gap-4">
      {specs.map((spec) => (
        <FieldFor key={spec.key} blockId={blockId} spec={spec} value={draft[spec.key]} onChange={(v) => onChange(spec.key, v)} errors={errors} editor={editor} />
      ))}
    </div>
  );
}

function FieldFor({
  blockId,
  spec,
  value,
  onChange,
  errors,
  editor,
}: {
  blockId: string;
  spec: FieldSpec;
  value: unknown;
  onChange: (v: unknown) => void;
  errors: Record<string, string[]>;
  editor: EditorContextValue;
}) {
  const err = issuesFor(errors, spec.key);
  const str = typeof value === "string" ? value : "";
  switch (spec.kind) {
    case "text":
      return (
        <TextInput
          label={spec.label}
          value={str}
          maxLength={spec.max}
          required={spec.required}
          hint={spec.hint}
          error={err}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "textarea":
      return (
        <Textarea
          label={spec.label}
          value={str}
          maxLength={spec.max}
          required={spec.required}
          rows={spec.rows ?? 3}
          error={err}
          hint={`${str.length}/${spec.max}`}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "markdown":
      return <MarkdownField label={spec.label} value={str} onChange={onChange} error={err} />;
    case "url":
      return <UrlField label={spec.label} value={str} required={spec.required} onChange={onChange} error={err} />;
    case "link":
      return <LinkField blockId={blockId} spec={spec} value={value} onChange={onChange} errors={errors} />;
    case "image":
      return <ImageField label={spec.label} value={typeof value === "string" ? value : null} onChange={onChange} error={err} editor={editor} />;
    case "images":
      return <ImagesField label={spec.label} max={spec.max} value={Array.isArray(value) ? (value as string[]) : []} onChange={onChange} error={err} editor={editor} />;
    case "position":
      return (
        <SegmentedControl
          name={`${blockId}-${spec.key}`}
          legend={spec.label}
          size="sm"
          value={value === "right" ? "right" : "left"}
          onValueChange={(v) => onChange(v)}
          options={[
            { value: "left", label: f.left },
            { value: "right", label: f.right },
          ]}
        />
      );
    case "product":
      return <ProductField label={spec.label} value={typeof value === "string" ? value : null} onChange={onChange} error={err} editor={editor} />;
    case "categories":
      return <CategoriesField label={spec.label} max={spec.max} value={Array.isArray(value) ? (value as string[]) : []} onChange={onChange} error={err} editor={editor} />;
    case "count":
      return (
        <NumberInput
          label={spec.label}
          hint={f.countHint}
          inputMode="numeric"
          className="max-w-[160px]"
          value={typeof value === "number" && Number.isFinite(value) ? String(value) : ""}
          error={err}
          onChange={(e) => {
            const n = Number.parseInt(e.target.value, 10);
            onChange(Number.isFinite(n) ? n : null);
          }}
        />
      );
  }
}

/** Labelled group for composite controls (fieldset + legend, hint and error announced). */
function GroupField({ label, hint, error, children }: { label: string; hint?: string; error?: string[]; children: ReactNode }) {
  const id = useId();
  const describedBy = [error?.length ? `${id}-err` : null, hint ? `${id}-hint` : null].filter(Boolean).join(" ") || undefined;
  return (
    <fieldset className="grid content-start gap-1" aria-describedby={describedBy} aria-invalid={error?.length ? true : undefined}>
      <legend className={cx(labelClass, "mb-1")}>{label}</legend>
      {children}
      {hint && (
        <p id={`${id}-hint`} className={hintClass}>
          {hint}
        </p>
      )}
      {error?.length ? (
        <p id={`${id}-err`} className={errorClass}>
          {error[0]}
        </p>
      ) : null}
    </fieldset>
  );
}

// ─── Markdown ────────────────────────────────────────────────────────────────

function MarkdownField({ label, value, onChange, error }: { label: string; value: string; onChange: (v: string) => void; error?: string[] }) {
  const previewId = useId();
  return (
    <div className="grid gap-2">
      <Textarea
        label={label}
        value={value}
        rows={6}
        maxLength={MAX_MARKDOWN_LENGTH}
        hint={f.markdownHint}
        error={error}
        aria-controls={previewId}
        inputClassName="font-mono text-[12.5px]"
        onChange={(e) => onChange(e.target.value)}
      />
      <div id={previewId} aria-live="off" className="rounded-control border border-dashed border-line bg-panel-2 px-3 py-2">
        <p className="type-label mb-1 text-[11px] text-muted">{f.markdownPreview}</p>
        {value.trim() ? <Markdown source={value} className="text-[13px] text-ink" /> : <p className="text-[13px] text-muted">—</p>}
      </div>
    </div>
  );
}

// ─── Links ───────────────────────────────────────────────────────────────────

function urlError(value: string): string | undefined {
  return value.trim() && !sanitizeUrl(value) ? f.unsafeUrl : undefined;
}

function UrlField({ label, value, required, onChange, error }: { label: string; value: string; required?: boolean; onChange: (v: string) => void; error?: string[] }) {
  const inline = urlError(value);
  return (
    <TextInput
      label={label}
      value={value}
      required={required}
      maxLength={2048}
      hint={f.hrefHint}
      error={inline ? [inline] : error}
      inputClassName="font-mono"
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function LinkField({
  blockId,
  spec,
  value,
  onChange,
  errors,
}: {
  blockId: string;
  spec: Extract<FieldSpec, { kind: "link" }>;
  value: unknown;
  onChange: (v: unknown) => void;
  errors: Record<string, string[]>;
}) {
  const link = value && typeof value === "object" ? (value as { label?: unknown; href?: unknown }) : null;
  const label = typeof link?.label === "string" ? link.label : "";
  const href = typeof link?.href === "string" ? link.href : "";
  const id = `${blockId}-${spec.key}`;
  return (
    <fieldset className="grid gap-3 rounded-control border border-line p-3">
      <legend className={cx(labelClass, "px-1")}>{spec.label}</legend>
      <Checkbox label={spec.toggle} id={`${id}-on`} checked={!!link} onChange={(e) => onChange(e.target.checked ? { label: "", href: "" } : null)} />
      {link && (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <TextInput label={f.linkLabel} value={label} maxLength={50} required error={errors[`${spec.key}.label`]} onChange={(e) => onChange({ label: e.target.value, href })} />
          <UrlField label={f.href} value={href} required error={errors[`${spec.key}.href`] ?? errors[spec.key]} onChange={(v) => onChange({ label, href: v })} />
        </div>
      )}
    </fieldset>
  );
}

// ─── Images ──────────────────────────────────────────────────────────────────

function ImageField({ label, value, onChange, error, editor }: { label: string; value: string | null; onChange: (v: string | null) => void; error?: string[]; editor: EditorContextValue }) {
  return (
    <GroupField label={label} error={error}>
      {
        <div className="flex flex-wrap items-center gap-3">
          <Thumb src={value ? storageImageUrl(value, "thumb") : null} alt={value ? label : ""} size="lg" placeholderLabel={ti.none} />
          <div className="grid gap-1.5">
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" aria-haspopup="dialog" onClick={() => editor.pickImage((key) => onChange(key))}>
                {value ? ti.replace : ti.choose}
              </Button>
              {value && (
                <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
                  {ti.remove}
                </Button>
              )}
            </div>
            {value && <span className="max-w-[36ch] truncate font-mono text-[11px] text-muted" title={value}>{value}</span>}
          </div>
        </div>
      }
    </GroupField>
  );
}

function ImagesField({ label, max, value, onChange, error, editor }: { label: string; max: number; value: string[]; onChange: (v: string[]) => void; error?: string[]; editor: EditorContextValue }) {
  const move = (i: number, d: -1 | 1) => {
    const next = [...value];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange(next);
  };
  return (
    <GroupField label={label} hint={ti.count(value.length, max)} error={error}>
      {
        <div className="grid gap-2">
          {value.length > 0 && (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2">
              {value.map((key, i) => (
                <li key={`${key}-${i}`} className="grid gap-1 rounded-control border border-line bg-panel-2 p-1.5">
                  <Thumb src={storageImageUrl(key, "thumb")} alt={`${label} ${i + 1}`} size="fill" />
                  <div className="flex justify-between gap-1">
                    <Button size="sm" variant="ghost" className="px-1.5" aria-label={`${ti.moveLeft} (${i + 1})`} disabled={i === 0} onClick={() => move(i, -1)}>
                      ←
                    </Button>
                    <Button size="sm" variant="ghost" className="px-1.5" aria-label={`${ti.remove} (${i + 1})`} onClick={() => onChange(value.filter((_, j) => j !== i))}>
                      ×
                    </Button>
                    <Button size="sm" variant="ghost" className="px-1.5" aria-label={`${ti.moveRight} (${i + 1})`} disabled={i === value.length - 1} onClick={() => move(i, 1)}>
                      →
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div>
            <Button size="sm" aria-haspopup="dialog" disabled={value.length >= max} onClick={() => editor.pickImage((key) => onChange([...value, key]))}>
              {ti.add}
            </Button>
          </div>
        </div>
      }
    </GroupField>
  );
}

// ─── Product / categories ────────────────────────────────────────────────────

function ProductField({ label, value, onChange, error, editor }: { label: string; value: string | null; onChange: (v: string | null) => void; error?: string[]; editor: EditorContextValue }) {
  const product = value ? editor.products[value] : undefined;
  const tp = copy.product;
  return (
    <GroupField label={label} error={error}>
      {
        <div className="flex flex-wrap items-center gap-3 rounded-control border border-line p-2.5">
          <Thumb src={product?.thumbUrl} alt="" size="md" />
          <div className="grid min-w-0 flex-1 gap-0.5">
            {product ? (
              <>
                <span className="truncate text-[13.5px] font-medium">{product.title}</span>
                <span className="font-mono text-xs text-muted">#{product.stockCode}</span>
              </>
            ) : (
              <span className={cx(hintClass, value && "text-warn")}>{value ? tp.missing : tp.none}</span>
            )}
          </div>
          <div className="flex gap-1.5">
            <Button size="sm" aria-haspopup="dialog" onClick={() => editor.pickProduct((p) => onChange(p.id))}>
              {value ? tp.change : tp.choose}
            </Button>
            {value && (
              <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
                {tp.clear}
              </Button>
            )}
          </div>
        </div>
      }
    </GroupField>
  );
}

function CategoriesField({ label, max, value, onChange, error, editor }: { label: string; max: number; value: string[]; onChange: (v: string[]) => void; error?: string[]; editor: EditorContextValue }) {
  const selected = new Set(value);
  const known = new Set(editor.categories.map((c) => c.id));
  const unknown = value.filter((id) => !known.has(id));
  const toggle = (id: string, on: boolean) => {
    // Keep tree order so the slider follows the category structure.
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    onChange([...editor.categories.filter((c) => next.has(c.id)).map((c) => c.id), ...unknown.filter((id) => next.has(id))]);
  };
  return (
    <fieldset className="grid gap-2">
      <legend className={labelClass}>{label}</legend>
      <p className={hintClass}>
        {f.categoriesHint} {ti.count(value.length, max)}
      </p>
      {editor.categories.length === 0 ? (
        <p className={hintClass}>No categories yet.</p>
      ) : (
        <div className="max-h-64 overflow-y-auto rounded-control border border-line px-3 py-2">
          {editor.categories.map((c) => (
            <div key={c.id} style={{ paddingLeft: `${c.depth * 18}px` }}>
              <Checkbox
                label={
                  <>
                    {c.title}
                    {!c.isActive && <span className="ml-1.5 text-xs text-muted">(inactive)</span>}
                  </>
                }
                checked={selected.has(c.id)}
                disabled={!selected.has(c.id) && value.length >= max}
                onChange={(e) => toggle(c.id, e.target.checked)}
              />
            </div>
          ))}
        </div>
      )}
      {unknown.length > 0 && (
        <p className="text-xs text-warn">
          {unknown.length} chosen categor{unknown.length === 1 ? "y no longer exists" : "ies no longer exist"}.{" "}
          <button type="button" className="underline" onClick={() => onChange(value.filter((id) => known.has(id)))}>
            Remove
          </button>
        </p>
      )}
      {error && <p className="text-xs text-crit">{error.join(" ")}</p>}
    </fieldset>
  );
}

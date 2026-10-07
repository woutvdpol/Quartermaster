import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { getDictionary } from "@/lib/i18n";
import { cx } from "./cx";
import { Field, FieldErrorText, firstError, RequiredMark, splitFieldProps, type FieldBaseProps } from "./Field";
import { adornmentClass, controlClass, groupClass, groupControlClass, hintClass, labelClass } from "./styles";

const t = getDictionary().ui;

/*
 * Native form controls with design-A styling. All are server-component friendly (no hooks besides
 * useId). Pass `label` to get a full Field (label, hint, error, required); omit it to get the bare
 * control (then provide `aria-label`/`aria-labelledby` yourself).
 */

type Adornments = {
  /** Content before the input, e.g. "€" or an icon. */
  leading?: ReactNode;
  /** Content after the input, e.g. "cm" or "g". */
  trailing?: ReactNode;
};

type OptionalField = Partial<FieldBaseProps> & { label?: ReactNode };

/** Renders `render(controlProps)` inside a Field when a label is given, bare otherwise. */
function withField(props: OptionalField, render: (control: Record<string, unknown>) => ReactNode) {
  if (props.label === undefined || props.label === null) {
    const { id, required, error } = props;
    return render({ id, required, "aria-invalid": firstError(error) ? true : undefined });
  }
  return (
    <Field {...(props as FieldBaseProps)}>
      {(control) => render(control as unknown as Record<string, unknown>)}
    </Field>
  );
}

// ── Text ────────────────────────────────────────────────────────────────────

export type TextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "required"> &
  OptionalField &
  Adornments & { inputClassName?: string };

export function TextInput(props: TextInputProps) {
  const { field, rest } = splitFieldProps(props as TextInputProps & FieldBaseProps);
  const { leading, trailing, inputClassName, type = "text", ...input } = rest;
  return withField(field, (control) =>
    leading || trailing ? (
      <span className={groupClass}>
        {leading && <span className={cx(adornmentClass, "border-r border-line")}>{leading}</span>}
        <input type={type} {...control} {...input} className={cx(groupControlClass, inputClassName)} />
        {trailing && <span className={cx(adornmentClass, "border-l border-line")}>{trailing}</span>}
      </span>
    ) : (
      <input type={type} {...control} {...input} className={cx(controlClass, inputClassName)} />
    ),
  );
}

export type NumberInputProps = Omit<TextInputProps, "type">;

/** Number input with tabular figures; use `trailing` for units ("cm", "g"). */
export function NumberInput({ inputClassName, inputMode = "decimal", ...props }: NumberInputProps) {
  return (
    <TextInput
      type="number"
      inputMode={inputMode}
      inputClassName={cx("font-mono tabular-nums", inputClassName)}
      {...props}
    />
  );
}

export type DateInputProps = Omit<TextInputProps, "type"> & {
  /** date (default), datetime-local, time or month. */
  kind?: "date" | "datetime-local" | "time" | "month";
};

export function DateInput({ kind = "date", inputClassName, ...props }: DateInputProps) {
  return <TextInput type={kind} inputClassName={cx("font-mono tabular-nums", inputClassName)} {...props} />;
}

export type TextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id" | "required"> &
  OptionalField & { inputClassName?: string };

export function Textarea(props: TextareaProps) {
  const { field, rest } = splitFieldProps(props as TextareaProps & FieldBaseProps);
  const { inputClassName, rows = 4, ...textarea } = rest;
  return withField(field, (control) => (
    <textarea rows={rows} {...control} {...textarea} className={cx(controlClass, "leading-[1.55]", inputClassName)} />
  ));
}

// ── Select ──────────────────────────────────────────────────────────────────

export type SelectOption = { value: string; label: string; disabled?: boolean };
export type SelectOptionGroup = { label: string; options: SelectOption[] };

export type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "id" | "required"> &
  OptionalField & {
    options?: Array<SelectOption | SelectOptionGroup>;
    /** Adds an empty first option ("Choose…" by default; pass a string to change it). */
    placeholder?: boolean | string;
    inputClassName?: string;
  };

export function Select(props: SelectProps) {
  const { field, rest } = splitFieldProps(props as SelectProps & FieldBaseProps);
  const { options, placeholder, inputClassName, children, ...select } = rest;
  return withField(field, (control) => (
    <span className="relative block">
      <select {...control} {...select} className={cx(controlClass, "cursor-pointer appearance-none pr-8", inputClassName)}>
        {placeholder && <option value="">{typeof placeholder === "string" ? placeholder : t.select.placeholder}</option>}
        {options?.map((o) =>
          "options" in o ? (
            <optgroup key={o.label} label={o.label}>
              {o.options.map((opt) => (
                <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                  {opt.label}
                </option>
              ))}
            </optgroup>
          ) : (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ),
        )}
        {children}
      </select>
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-[10px] text-muted">
        ▼
      </span>
    </span>
  ));
}

// ── Checkbox / Switch ───────────────────────────────────────────────────────

type InlineChoiceProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "id"> & {
  label: ReactNode;
  /** Secondary line under the label. */
  description?: ReactNode;
  error?: string | readonly string[] | null;
  id?: string;
  className?: string;
};

function useChoiceIds(id: string | undefined, description: ReactNode, error: string | undefined) {
  const auto = useId();
  const controlId = id ?? `c${auto.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const descId = description ? `${controlId}-desc` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  return { controlId, descId, errorId, describedBy: [errorId, descId].filter(Boolean).join(" ") || undefined };
}

export function Checkbox({ label, description, error, id, className, ...input }: InlineChoiceProps) {
  const message = firstError(error);
  const ids = useChoiceIds(id, description, message);
  return (
    <div className={cx("grid gap-1", className)}>
      <label htmlFor={ids.controlId} className="flex cursor-pointer items-start gap-2 text-[13.5px] has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
        <input
          type="checkbox"
          id={ids.controlId}
          aria-describedby={ids.describedBy}
          aria-invalid={message ? true : undefined}
          {...input}
          className="mt-[3px] size-3.5 shrink-0 cursor-pointer accent-accent disabled:cursor-not-allowed"
        />
        <span className="grid gap-0.5">
          <span>
            {label}
            <RequiredMark required={input.required} />
          </span>
          {description && (
            <span id={ids.descId} className={hintClass}>
              {description}
            </span>
          )}
        </span>
      </label>
      {message && <FieldErrorText id={ids.errorId!}>{message}</FieldErrorText>}
    </div>
  );
}

export type SwitchProps = InlineChoiceProps & {
  /** "row": label + description left, toggle right with a divider (design A settings row). */
  layout?: "inline" | "row";
};

/** On/off toggle (design A `.tog`): a native checkbox with role="switch", submits like a checkbox. */
export function Switch({ label, description, error, id, className, layout = "inline", ...input }: SwitchProps) {
  const message = firstError(error);
  const ids = useChoiceIds(id, description, message);
  const toggle = (
    <span className="relative inline-flex shrink-0">
      <input
        type="checkbox"
        role="switch"
        id={ids.controlId}
        aria-describedby={ids.describedBy}
        aria-invalid={message ? true : undefined}
        {...input}
        className="peer absolute inset-0 m-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
      />
      <span
        aria-hidden="true"
        className={
          "pointer-events-none h-[18px] w-8 rounded-full bg-line-strong transition-colors " +
          "after:absolute after:top-0.5 after:left-0.5 after:size-3.5 after:rounded-full after:bg-panel after:shadow-sm after:transition-transform " +
          "peer-checked:bg-accent peer-checked:after:translate-x-3.5 " +
          "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus " +
          "peer-disabled:opacity-60"
        }
      />
    </span>
  );
  const text = (
    <span className="grid gap-0.5">
      <span className={layout === "row" ? "text-[13.5px] font-medium" : "text-[13.5px]"}>{label}</span>
      {description && (
        <span id={ids.descId} className="text-[12.5px] text-muted">
          {description}
        </span>
      )}
    </span>
  );
  return (
    <div className={cx("grid gap-1", layout === "row" && "border-b border-line py-3 last:border-b-0", className)}>
      <label
        htmlFor={ids.controlId}
        className={cx(
          "flex cursor-pointer items-center gap-3 has-[:disabled]:cursor-not-allowed",
          layout === "row" && "justify-between gap-4",
        )}
      >
        {layout === "row" ? (
          <>
            {text}
            {toggle}
          </>
        ) : (
          <>
            {toggle}
            {text}
          </>
        )}
      </label>
      {message && <FieldErrorText id={ids.errorId!}>{message}</FieldErrorText>}
    </div>
  );
}

// ── Radio group / segmented control ─────────────────────────────────────────

export type ChoiceOption = { value: string; label: ReactNode; description?: ReactNode; disabled?: boolean };

type ChoiceGroupProps = {
  name: string;
  legend: ReactNode;
  options: ChoiceOption[];
  defaultValue?: string;
  /** Controlled value; pair with `onValueChange` (client components only). */
  value?: string;
  onValueChange?: (value: string) => void;
  hint?: ReactNode;
  error?: string | readonly string[] | null;
  required?: boolean;
  disabled?: boolean;
  legendHidden?: boolean;
  className?: string;
};

function useGroupIds(hint: ReactNode, error: string | undefined) {
  const auto = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const hintId = hint ? `g${auto}-hint` : undefined;
  const errorId = error ? `g${auto}-error` : undefined;
  return { hintId, errorId, describedBy: [errorId, hintId].filter(Boolean).join(" ") || undefined };
}

function radioProps(p: ChoiceGroupProps, value: string) {
  return {
    type: "radio" as const,
    name: p.name,
    value,
    required: p.required,
    ...(p.value !== undefined
      ? { checked: p.value === value, onChange: () => p.onValueChange?.(value) }
      : { defaultChecked: p.defaultValue === value, onChange: p.onValueChange ? () => p.onValueChange?.(value) : undefined }),
  };
}

/** Vertical list of radio buttons with optional descriptions. Arrow keys work natively. */
export function RadioGroup(props: ChoiceGroupProps) {
  const { legend, options, hint, error, required, disabled, legendHidden, className } = props;
  const message = firstError(error);
  const ids = useGroupIds(hint, message);
  return (
    <fieldset disabled={disabled} aria-describedby={ids.describedBy} className={cx("grid gap-1.5", className)}>
      <legend className={cx(labelClass, "mb-1", legendHidden && "sr-only")}>
        {legend}
        <RequiredMark required={required} />
      </legend>
      {options.map((o) => (
        <label key={o.value} className="flex cursor-pointer items-start gap-2 text-[13.5px] has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
          <input {...radioProps(props, o.value)} disabled={o.disabled} aria-invalid={message ? true : undefined} className="mt-[3px] size-3.5 shrink-0 accent-accent" />
          <span className="grid gap-0.5">
            <span>{o.label}</span>
            {o.description && <span className={hintClass}>{o.description}</span>}
          </span>
        </label>
      ))}
      {hint && <p id={ids.hintId} className={hintClass}>{hint}</p>}
      {message && <FieldErrorText id={ids.errorId!}>{message}</FieldErrorText>}
    </fieldset>
  );
}

/** Design A `.seg`: joined buttons for 2–5 short options. Native radios, so it submits with forms. */
export function SegmentedControl(props: ChoiceGroupProps & { size?: "sm" | "md" }) {
  const { legend, options, hint, error, required, disabled, legendHidden = false, className, size = "md" } = props;
  const message = firstError(error);
  const ids = useGroupIds(hint, message);
  return (
    <fieldset disabled={disabled} aria-describedby={ids.describedBy} className={cx("grid min-w-0 gap-1", className)}>
      <legend className={cx(labelClass, "mb-1", legendHidden && "sr-only")}>
        {legend}
        <RequiredMark required={required} />
      </legend>
      <div
        className={cx(
          "flex overflow-hidden rounded-control border bg-panel",
          message ? "border-crit" : "border-line",
        )}
      >
        {options.map((o) => (
          <label
            key={o.value}
            className={cx(
              "relative flex flex-1 cursor-pointer items-center justify-center border-r border-line text-center last:border-r-0",
              size === "sm" ? "px-2 py-1 text-xs" : "px-2.5 py-1.5 text-[12.5px]",
              "text-ink-2 hover:bg-panel-2 has-[:checked]:bg-accent has-[:checked]:text-on-accent",
              "has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-4 has-[:focus-visible]:outline-on-accent",
              "has-[:focus-visible]:not-has-[:checked]:outline-focus",
              "has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60",
            )}
          >
            <input {...radioProps(props, o.value)} disabled={o.disabled} className="sr-only" />
            {o.label}
          </label>
        ))}
      </div>
      {hint && <p id={ids.hintId} className={hintClass}>{hint}</p>}
      {message && <FieldErrorText id={ids.errorId!}>{message}</FieldErrorText>}
    </fieldset>
  );
}

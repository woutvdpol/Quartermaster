import { useId, type ReactNode } from "react";
import { getDictionary } from "@/lib/i18n";
import { cx } from "./cx";
import { errorClass, hintClass, labelClass } from "./styles";

const t = getDictionary().ui.field;

/** Props a Field hands to its control so label, hint and error are announced together. */
export type FieldControlProps = {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
  required?: boolean;
};

export type FieldBaseProps = {
  label: ReactNode;
  hint?: ReactNode;
  /** Error message (string or the first of a list). Sets `aria-invalid` on the control. */
  error?: string | readonly string[] | null;
  required?: boolean;
  /** Show "optional" after the label instead of marking required fields. */
  showOptional?: boolean;
  /** Visually hide the label (it stays available to screen readers). */
  labelHidden?: boolean;
  /** Control id; generated when omitted. */
  id?: string;
  className?: string;
};

export type FieldProps = FieldBaseProps & {
  /** The control. Use the render form to receive id / aria-* props for a custom control. */
  children: ReactNode | ((control: FieldControlProps) => ReactNode);
};

export function firstError(error: FieldBaseProps["error"]): string | undefined {
  if (!error) return undefined;
  return typeof error === "string" ? error : error[0];
}

/**
 * Label + control + hint + error. Server-component friendly.
 *
 *   <Field label="Title" hint="Shown in the shop" error={fieldError(state, "title")} required>
 *     {(p) => <input {...p} name="title" className={controlClass} />}
 *   </Field>
 *
 * The kit's controls (TextInput, Select, …) accept the same label/hint/error props directly.
 */
export function Field({ label, hint, error, required, showOptional, labelHidden, id, className, children }: FieldProps) {
  const autoId = useId();
  const controlId = id ?? `f${autoId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const message = firstError(error);
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = message ? `${controlId}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;
  const control: FieldControlProps = {
    id: controlId,
    "aria-describedby": describedBy,
    "aria-invalid": message ? true : undefined,
    required: required || undefined,
  };
  return (
    <div className={cx("grid content-start gap-1", className)}>
      <label htmlFor={controlId} className={cx(labelClass, labelHidden && "sr-only")}>
        {label}
        <RequiredMark required={required} showOptional={showOptional} />
      </label>
      {typeof children === "function" ? children(control) : children}
      {hint && (
        <p id={hintId} className={hintClass}>
          {hint}
        </p>
      )}
      {message && <FieldErrorText id={errorId!}>{message}</FieldErrorText>}
    </div>
  );
}

export function RequiredMark({ required, showOptional }: { required?: boolean; showOptional?: boolean }) {
  if (required && !showOptional) {
    return (
      <span className="ml-0.5 text-crit" aria-hidden="true" title={t.required}>
        *
      </span>
    );
  }
  if (!required && showOptional) {
    return <span className="ml-1.5 font-sans text-[11px] font-normal tracking-normal normal-case">({t.optional})</span>;
  }
  return null;
}

export function FieldErrorText({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className={cx(errorClass, "flex items-start gap-1")}>
      <span aria-hidden="true" className="font-semibold">
        !
      </span>
      <span>{children}</span>
    </p>
  );
}

/** Splits FieldBaseProps from the rest of a control's props. */
export function splitFieldProps<P extends FieldBaseProps>(props: P) {
  const { label, hint, error, required, showOptional, labelHidden, id, className, ...rest } = props;
  return { field: { label, hint, error, required, showOptional, labelHidden, id, className }, rest };
}

import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "./cn";

/** Label + control + hint/error, wired with ids for a11y. Pass the control as children. */
export function Field({
  id,
  label,
  hint,
  error,
  required,
  className,
  children,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium text-shop-ink">
        {label}
        {required ? <span aria-hidden="true" className="text-shop-crit"> *</span> : null}
      </label>
      {children}
      {hint && !error ? <p id={`${id}-hint`} className="text-xs text-shop-muted">{hint}</p> : null}
      {error ? <p id={`${id}-error`} className="text-xs font-medium text-shop-crit">{error}</p> : null}
    </div>
  );
}

/** Shared focus/invalid styling for every shop form control. */
const CONTROL_STATE =
  "focus:border-shop-primary focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-shop-primary " +
  "aria-invalid:border-shop-crit disabled:cursor-not-allowed disabled:opacity-60";

/** Single-line control (input, select): pill-shaped in theme gallery (`rounded-shop-control`). */
export const inputClasses =
  "block h-11 w-full rounded-shop-control border border-shop-line-strong bg-shop-surface px-4 text-[0.95rem] text-shop-ink placeholder:text-shop-muted " +
  CONTROL_STATE;

/** Multi-line control (textarea, drop zones): uses the panel radius (`rounded-shop`), not the pill. */
export const textareaClasses =
  "block w-full rounded-shop border border-shop-line-strong bg-shop-surface px-4 py-3 text-[0.95rem] text-shop-ink placeholder:text-shop-muted " +
  CONTROL_STATE;

/** Checkbox / radio: native control tinted with the primary colour. */
export const checkClasses = "size-[1.125rem] shrink-0 accent-shop-primary";

/** Text input styled for the shop. Set aria-describedby to `${id}-hint` / `${id}-error` as needed. */
export function TextInput({ className, invalid, ...rest }: ComponentPropsWithoutRef<"input"> & { invalid?: boolean }) {
  return <input aria-invalid={invalid || undefined} className={cn(inputClasses, className)} {...rest} />;
}

/** Textarea styled for the shop (rounded panel, not a pill). */
export function Textarea({ className, invalid, ...rest }: ComponentPropsWithoutRef<"textarea"> & { invalid?: boolean }) {
  return <textarea aria-invalid={invalid || undefined} className={cn(textareaClasses, className)} {...rest} />;
}

/** Native select with the pill look and a token-coloured chevron (the native arrow is hidden). */
export function Select({
  className,
  wrapperClassName,
  invalid,
  ...rest
}: ComponentPropsWithoutRef<"select"> & { invalid?: boolean; wrapperClassName?: string }) {
  return (
    <div className={cn("relative", wrapperClassName)}>
      <select aria-invalid={invalid || undefined} className={cn(inputClasses, "appearance-none pr-10", className)} {...rest} />
      <svg
        viewBox="0 0 16 16"
        width="14"
        height="14"
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-shop-muted"
      >
        <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

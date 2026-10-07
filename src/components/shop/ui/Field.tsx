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

/** Text input styled for the shop. Set aria-describedby to `${id}-hint` / `${id}-error` as needed. */
export function TextInput({ className, invalid, ...rest }: ComponentPropsWithoutRef<"input"> & { invalid?: boolean }) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(
        "h-11 w-full rounded-shop-sm border border-shop-line-strong bg-shop-surface px-3 text-[0.95rem] text-shop-ink placeholder:text-shop-muted/80",
        "focus:border-shop-primary focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-shop-primary",
        "aria-invalid:border-shop-crit",
        className,
      )}
      {...rest}
    />
  );
}

"use client";

import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/shop/ui/Button";
import { cn } from "@/components/shop/ui/cn";
import { inputClasses } from "@/components/shop/ui/Field";

/*
 * Small form kit for the account/auth pages (no generic shop form primitives exist yet in
 * components/shop/ui — candidates to move there).
 */

/** Pill input from the shared shop form kit (components/shop/ui/Field). */
export const inputClass = inputClasses;

export function Field({
  id,
  label,
  error,
  hint,
  className,
  ...input
}: { id: string; label: ReactNode; error?: string | null; hint?: ReactNode } & ComponentPropsWithoutRef<"input">) {
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("grid gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium text-shop-ink">
        {label}
      </label>
      <input
        id={id}
        name={input.name ?? id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={inputClass}
        {...input}
      />
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-shop-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-shop-crit">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Alert({ tone, children, id }: { tone: "error" | "success" | "info"; children: ReactNode; id?: string }) {
  const tones = {
    error: "border-shop-crit/30 bg-shop-crit-soft text-shop-crit",
    success: "border-shop-ok/30 bg-shop-ok-soft text-shop-ok",
    info: "border-shop-line bg-shop-sunken text-shop-ink-2",
  } as const;
  return (
    <div id={id} role={tone === "error" ? "alert" : "status"} className={cn("rounded-shop border px-4 py-3 text-sm", tones[tone])}>
      {children}
    </div>
  );
}

/** Submit button that shows a busy label while its form's action runs. */
export function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
  size = "md",
  fullWidth,
  className,
}: {
  children: ReactNode;
  pendingLabel?: ReactNode;
  variant?: "primary" | "outline" | "accent" | "secondary";
  size?: "sm" | "md" | "lg";
  fullWidth?: boolean;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size={size} fullWidth={fullWidth} pending={pending} className={className}>
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  );
}

/** Hidden honeypot input: humans never see or fill it; bots that fill every field get rejected. */
export function Honeypot() {
  return (
    <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
      <label htmlFor="hp-website">Website</label>
      <input id="hp-website" name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
    </div>
  );
}

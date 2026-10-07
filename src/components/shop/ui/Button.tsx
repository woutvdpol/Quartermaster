import Link from "next/link";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "./cn";

export type ButtonVariant = "primary" | "accent" | "secondary" | "outline" | "ghost" | "link";
export type ButtonSize = "sm" | "md" | "lg";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-shop-sm font-medium whitespace-nowrap transition-colors " +
  "disabled:cursor-not-allowed disabled:opacity-55 aria-disabled:cursor-not-allowed aria-disabled:opacity-55 select-none";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-shop-primary text-shop-on-primary hover:bg-shop-primary-strong",
  accent: "bg-shop-accent text-shop-on-accent hover:brightness-95",
  secondary: "bg-shop-secondary text-shop-on-secondary hover:brightness-95",
  outline: "border border-shop-line-strong bg-shop-surface text-shop-ink hover:border-shop-ink hover:bg-shop-sunken",
  ghost: "text-shop-ink hover:bg-shop-sunken",
  link: "text-shop-primary underline underline-offset-4 hover:text-shop-primary-strong px-0! h-auto!",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-sm",
  md: "h-11 px-5 text-[0.95rem]",
  lg: "h-13 px-7 text-base",
};

export function buttonClasses(variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string): string {
  return cn(BASE, VARIANTS[variant], SIZES[size], className);
}

type CommonProps = { variant?: ButtonVariant; size?: ButtonSize; fullWidth?: boolean; children?: ReactNode };

/** `<button>`; defaults to type="button". Use `pending` to show a busy state in forms. */
export function Button({
  variant,
  size,
  fullWidth,
  className,
  type = "button",
  pending,
  children,
  ...rest
}: CommonProps & ComponentPropsWithoutRef<"button"> & { pending?: boolean }) {
  return (
    <button
      type={type}
      className={buttonClasses(variant, size, cn(fullWidth && "w-full", className))}
      aria-busy={pending || undefined}
      disabled={rest.disabled || pending}
      {...rest}
    >
      {children}
    </button>
  );
}

/** A link styled as a button (next/link; external URLs get rel="noopener noreferrer"). */
export function ButtonLink({
  variant,
  size,
  fullWidth,
  className,
  href,
  external,
  children,
  ...rest
}: CommonProps & Omit<ComponentPropsWithoutRef<"a">, "href"> & { href: string; external?: boolean }) {
  const classes = buttonClasses(variant, size, cn(fullWidth && "w-full", className));
  if (external) {
    return (
      <a href={href} className={classes} rel="noopener noreferrer" {...rest}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={classes} {...rest}>
      {children}
    </Link>
  );
}

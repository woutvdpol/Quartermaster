import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control border font-medium " +
  "transition-colors disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:cursor-not-allowed aria-disabled:opacity-60";

const variants: Record<ButtonVariant, string> = {
  primary: "border-accent bg-accent text-on-accent hover:border-accent-strong hover:bg-accent-strong",
  secondary: "border-line bg-panel text-ink hover:bg-panel-2",
  ghost: "border-transparent bg-transparent text-ink hover:bg-panel-2",
  danger: "border-crit bg-transparent text-crit hover:bg-crit-soft",
};

const sizes: Record<ButtonSize, string> = {
  sm: "px-2.5 py-1 text-xs",
  md: "px-3 py-1.5 text-[13px]",
  lg: "px-4 py-2.5 text-sm",
};

/** Class names for a button look, for use on links (`<Link className={buttonClasses()} />`). */
export function buttonClasses({
  variant = "secondary",
  size = "md",
  className = "",
}: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}): string {
  return `${base} ${variants[variant]} ${sizes[size]} ${className}`.trim();
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function Button({ variant, size, className, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={buttonClasses({ variant, size, className })} {...props} />;
}

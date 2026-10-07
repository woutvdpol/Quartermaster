"use client";

import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button, type ButtonSize, type ButtonVariant } from "@/components/shop/ui/Button";

/** Submit button that shows a busy state while its form's server action runs. */
export function PendingButton({
  children,
  pendingLabel,
  variant = "primary",
  size = "md",
  fullWidth,
  ...rest
}: {
  children: ReactNode;
  pendingLabel?: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
} & Omit<ComponentPropsWithoutRef<"button">, "type" | "children">) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size={size} fullWidth={fullWidth} pending={pending} {...rest}>
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  );
}

"use client";

import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "../Button";
import { getDictionary } from "@/lib/i18n";
import { Spinner } from "./Spinner";

const t = getDictionary().ui.form;

export type SubmitButtonProps = Omit<ButtonProps, "type"> & {
  /** Label while the form's action runs ("Saving…" by default). */
  pendingLabel?: string;
};

/** Submit button that disables itself and shows a spinner while its parent <form> is pending. */
export function SubmitButton({ children, pendingLabel = t.saving, variant = "primary", disabled, ...props }: SubmitButtonProps) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={disabled || pending} aria-busy={pending || undefined} {...props}>
      {pending && <Spinner />}
      {pending ? pendingLabel : (children ?? t.save)}
    </Button>
  );
}

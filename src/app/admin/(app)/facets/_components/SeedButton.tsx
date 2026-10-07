"use client";

import { ActionMessage, ActionToast, SubmitButton, useActionForm, type ButtonProps } from "@/components/admin/ui";
import { copy } from "../_copy";
import { seedDefaultsAction } from "../actions";

/** "Add standard facets" (idempotent: only missing facets/values are created). */
export function SeedButton({ label = copy.empty.seed, variant = "primary" }: { label?: string; variant?: ButtonProps["variant"] }) {
  const { state, formAction } = useActionForm(seedDefaultsAction);
  return (
    <form action={formAction} className="grid gap-2">
      <ActionMessage state={state} showSuccess={false} />
      <ActionToast state={state} errors={false} />
      <div>
        <SubmitButton variant={variant} pendingLabel={copy.empty.seeding}>
          {label}
        </SubmitButton>
      </div>
    </form>
  );
}

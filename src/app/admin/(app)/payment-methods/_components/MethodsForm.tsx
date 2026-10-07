"use client";

import { useState } from "react";
import { ActionMessage, ActionToast, Checkbox, FormActions, RadioGroup, SubmitButton, useActionForm } from "@/components/admin/ui";
import { saveMethodsAction } from "../actions";

export type MethodRow = { id: string; description: string; enabled: boolean; limits: string | null };

/** Which Mollie methods checkout offers: all active ones (default) or a selection. */
export function MethodsForm({ methods, allEnabled }: { methods: MethodRow[]; allEnabled: boolean }) {
  const { state, formAction, error } = useActionForm(saveMethodsAction);
  const [mode, setMode] = useState(allEnabled ? "all" : "selected");
  return (
    <form action={formAction} noValidate className="grid gap-4">
      <ActionMessage state={state} showSuccess={false} />
      <ActionToast state={state} errors={false} />
      <RadioGroup
        name="mode"
        legend="Offer at checkout"
        value={mode}
        onValueChange={setMode}
        options={[
          { value: "all", label: "All methods active in Mollie", description: "Recommended. Methods you activate in Mollie later appear automatically." },
          { value: "selected", label: "Only the methods selected below" },
        ]}
      />
      <fieldset disabled={mode === "all"} className="grid gap-0 rounded-control border border-line disabled:opacity-70" aria-describedby={error("methods") ? "methods-error" : undefined}>
        <legend className="sr-only">Methods</legend>
        {methods.map((m) => (
          <div key={m.id} className="border-b border-line px-3 py-2.5 last:border-b-0">
            <Checkbox
              name="methods"
              value={m.id}
              defaultChecked={allEnabled || m.enabled}
              label={m.description}
              description={
                <>
                  <span className="font-mono">{m.id}</span>
                  {m.limits && <> · {m.limits}</>}
                </>
              }
            />
          </div>
        ))}
      </fieldset>
      {error("methods") && (
        <p id="methods-error" className="text-xs text-crit">
          {error("methods")}
        </p>
      )}
      <FormActions>
        <SubmitButton>Save methods</SubmitButton>
      </FormActions>
    </form>
  );
}

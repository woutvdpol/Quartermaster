"use client";

import { useState } from "react";
import { ActionMessage, ActionToast, FormActions, SubmitButton, Switch, Textarea, useActionForm } from "@/components/admin/ui";
import { saveProvenanceAction } from "./actions";
import { provenanceCardCopy as copy } from "./_copy";

const t = copy.provenance;

/** Provenance Markdown + guarantee toggle; saved separately from the main product form. */
export function ProvenanceForm({ productId, provenance, authenticityGuaranteed }: { productId: string; provenance: string; authenticityGuaranteed: boolean }) {
  const { state, formAction, error } = useActionForm(saveProvenanceAction);
  // Controlled, so a failed submit keeps what was typed (React resets uncontrolled fields after an action).
  const [text, setText] = useState(provenance);
  const [guaranteed, setGuaranteed] = useState(authenticityGuaranteed);
  return (
    <form action={formAction} className="grid gap-3" noValidate>
      <input type="hidden" name="productId" value={productId} />
      <ActionMessage state={state} showSuccess={false} />
      <ActionToast state={state} errors={false} />
      <Textarea label={t.label} name="provenance" value={text} onChange={(e) => setText(e.target.value)} rows={6} hint={t.hint} error={error("provenance")} maxLength={20_000} />
      <Switch name="authenticityGuaranteed" label={t.guaranteed} description={t.guaranteedHint} checked={guaranteed} onChange={(e) => setGuaranteed(e.target.checked)} />
      <FormActions>
        <SubmitButton size="sm" pendingLabel={t.saving}>
          {t.save}
        </SubmitButton>
      </FormActions>
    </form>
  );
}

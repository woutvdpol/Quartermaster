"use client";

import { useState } from "react";
import { ActionMessage, Button, DateInput, Drawer, Switch, TextInput, Textarea, toast, type ButtonSize, type ButtonVariant } from "@/components/admin/ui";
import { PendingButton, useKeepForm } from "../../_system/client";
import { saveFairAction } from "../actions";
import { fairsCopy as t } from "../_copy";

export type FairFormData = { id: string; name: string; startsOn: string; endsOn: string; hideFromShop: boolean; notes: string };

type Props = { fair?: FairFormData; trigger: string; triggerVariant?: ButtonVariant; triggerSize?: ButtonSize };

/** Create / edit a fair in a side drawer. Creating redirects to the new fair. */
export function FairDrawer({ fair, trigger, triggerVariant = "secondary", triggerSize = "md" }: Props) {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  return (
    <>
      <Button variant={triggerVariant} size={triggerSize} aria-haspopup="dialog" onClick={() => { setSession((s) => s + 1); setOpen(true); }}>
        {trigger}
      </Button>
      <Drawer open={open} onOpenChange={setOpen} title={fair ? t.form.editTitle : t.form.newTitle} description={t.form.description}>
        {open && <FairForm key={session} fair={fair} onDone={() => setOpen(false)} />}
      </Drawer>
    </>
  );
}

function FairForm({ fair, onDone }: { fair?: FairFormData; onDone: () => void }) {
  const { state, pending, error, onSubmit } = useKeepForm(saveFairAction, {
    onSuccess: (s) => {
      if (s.message) toast.ok(s.message);
      onDone();
    },
  });
  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5">
      <ActionMessage state={state} showSuccess={false} />
      {fair ? <input type="hidden" name="id" value={fair.id} /> : null}
      <TextInput label={t.form.name} name="name" defaultValue={fair?.name} required maxLength={120} error={error("name")} />
      <div className="grid gap-3 sm:grid-cols-2">
        <DateInput label={t.form.startsOn} name="startsOn" defaultValue={fair?.startsOn ?? ""} required error={error("startsOn")} />
        <DateInput label={t.form.endsOn} name="endsOn" defaultValue={fair?.endsOn ?? ""} hint={t.form.endsOnHint} error={error("endsOn")} />
      </div>
      <Switch layout="row" name="hideFromShop" label={t.form.hide} description={t.form.hideHint} defaultChecked={fair?.hideFromShop ?? true} />
      <Textarea label={t.form.notes} name="notes" defaultValue={fair?.notes ?? ""} rows={3} maxLength={2000} error={error("notes")} />
      <div className="flex justify-end">
        <PendingButton pending={pending}>{t.form.save}</PendingButton>
      </div>
    </form>
  );
}

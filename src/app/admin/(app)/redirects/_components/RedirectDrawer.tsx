"use client";

import { useState } from "react";
import { ActionMessage, Button, Drawer, SegmentedControl, TextInput, toast, type ButtonSize, type ButtonVariant } from "@/components/admin/ui";
import { PendingButton, useKeepForm } from "../../_system/client";
import { saveRedirectAction } from "../actions";
import { redirectsCopy as t } from "../_copy";

export type RedirectFormData = { id: string; fromPath: string; toPath: string; statusCode: number };

type Props = { redirect?: RedirectFormData; trigger: string; triggerVariant?: ButtonVariant; triggerSize?: ButtonSize };

/** Create / edit a manual redirect in a side drawer. */
export function RedirectDrawer({ redirect, trigger, triggerVariant = "secondary", triggerSize = "md" }: Props) {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  return (
    <>
      <Button
        variant={triggerVariant}
        size={triggerSize}
        aria-haspopup="dialog"
        onClick={() => {
          setSession((s) => s + 1);
          setOpen(true);
        }}
      >
        {trigger}
      </Button>
      <Drawer open={open} onOpenChange={setOpen} size="md" title={redirect ? t.form.editTitle : t.form.newTitle} description={t.form.description}>
        {open && <RedirectForm key={session} redirect={redirect} onDone={() => setOpen(false)} />}
      </Drawer>
    </>
  );
}

function RedirectForm({ redirect, onDone }: { redirect?: RedirectFormData; onDone: () => void }) {
  const [status, setStatus] = useState(String(redirect?.statusCode ?? 301));
  const { state, pending, error, onSubmit } = useKeepForm(saveRedirectAction, {
    onSuccess: (s) => {
      if (s.message) toast.ok(s.message);
      onDone();
    },
  });
  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5">
      <ActionMessage state={state} showSuccess={false} />
      {redirect ? <input type="hidden" name="id" value={redirect.id} /> : null}
      <input type="hidden" name="statusCode" value={status} />
      <TextInput
        label={t.form.from}
        name="fromPath"
        defaultValue={redirect?.fromPath}
        required
        maxLength={1000}
        inputClassName="font-mono"
        autoCapitalize="off"
        spellCheck={false}
        hint={t.form.fromHint}
        error={error("fromPath")}
      />
      <TextInput
        label={t.form.to}
        name="toPath"
        defaultValue={redirect?.toPath}
        required
        maxLength={2000}
        inputClassName="font-mono"
        autoCapitalize="off"
        spellCheck={false}
        hint={t.form.toHint}
        error={error("toPath")}
      />
      <SegmentedControl
        name="statusChoice"
        legend={t.form.type}
        value={status}
        onValueChange={setStatus}
        options={[
          { value: "301", label: t.form.permanent },
          { value: "302", label: t.form.temporary },
        ]}
      />
      <p className="-mt-3 text-xs text-muted">{t.form.typeHint}</p>
      <div className="flex justify-end">
        <PendingButton pending={pending}>{t.form.save}</PendingButton>
      </div>
    </form>
  );
}

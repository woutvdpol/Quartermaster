"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ActionMessage, Button, ConfirmDialog, Drawer, FormActions, Select, SubmitButton, Switch, TextInput, Textarea, toast, useActionForm } from "@/components/admin/ui";
import { ACTION_LABELS, COMPLIANCE_ACTIONS, COMPLIANCE_MATCHES, MATCH_LABELS, type ComplianceActionName, type ComplianceMatchName } from "@/server/compliance/presets";
import { copy } from "../_copy";
import { deleteRuleAction, saveRuleAction } from "../actions";
import { CountrySelect } from "./CountrySelect";

const f = copy.form;

export type RuleFormValues = {
  id?: string;
  name: string;
  match: ComplianceMatchName;
  categoryId: string | null;
  countries: string[];
  action: ComplianceActionName;
  note: string;
  isActive: boolean;
};

/** Create / edit a compliance rule (`?new=1` or `?edit=<id>`). Fields are controlled (kept on errors). */
export function RuleDrawer({ initial, categories, closeHref }: { initial: RuleFormValues; categories: { value: string; label: string }[]; closeHref: string }) {
  const router = useRouter();
  const editing = Boolean(initial.id);
  const [v, setV] = useState(initial);
  const { state, formAction, error } = useActionForm(saveRuleAction);
  const close = () => router.replace(closeHref, { scroll: false });

  useEffect(() => {
    if (state?.ok) {
      if (state.message) toast.ok(state.message);
      router.replace(closeHref, { scroll: false });
    }
  }, [state, router, closeHref]);

  return (
    <Drawer
      open
      size="lg"
      onOpenChange={(open) => !open && close()}
      title={editing ? f.editTitle : f.createTitle}
      footer={
        editing && initial.id ? (
          <div className="mr-auto">
            <ConfirmDialog
              trigger={f.delete}
              triggerSize="sm"
              title={f.deleteTitle(initial.name)}
              description={f.deleteBody}
              confirmLabel={f.deleteConfirm}
              fields={{ id: initial.id }}
              action={async (fd: FormData) => {
                const res = await deleteRuleAction(fd);
                if (!res.ok) return res;
                if (res.message) toast.ok(res.message);
                close();
                return undefined;
              }}
            />
          </div>
        ) : undefined
      }
    >
      <form action={formAction} className="grid gap-4" noValidate>
        <ActionMessage state={state} showSuccess={false} />
        {initial.id && <input type="hidden" name="id" value={initial.id} />}
        <TextInput
          label={f.name}
          name="name"
          required
          maxLength={120}
          placeholder={f.namePlaceholder}
          value={v.name}
          onChange={(e) => setV((x) => ({ ...x, name: e.target.value }))}
          error={error("name")}
          autoFocus={!editing}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label={f.match}
            name="match"
            value={v.match}
            onChange={(e) => setV((x) => ({ ...x, match: e.target.value as ComplianceMatchName }))}
            options={COMPLIANCE_MATCHES.map((m) => ({ value: m, label: MATCH_LABELS[m] }))}
            error={error("match")}
          />
          <Select
            label={f.action}
            name="action"
            value={v.action}
            onChange={(e) => setV((x) => ({ ...x, action: e.target.value as ComplianceActionName }))}
            options={COMPLIANCE_ACTIONS.map((a) => ({ value: a, label: ACTION_LABELS[a] }))}
            error={error("action")}
          />
        </div>
        {v.match === "CATEGORY" && (
          <Select
            label={f.category}
            name="categoryId"
            hint={f.categoryHint}
            required
            placeholder
            value={v.categoryId ?? ""}
            onChange={(e) => setV((x) => ({ ...x, categoryId: e.target.value || null }))}
            options={categories}
            error={error("categoryId")}
          />
        )}
        <CountrySelect value={v.countries} onChange={(countries) => setV((x) => ({ ...x, countries }))} error={error("countries")} />
        <Textarea label={f.note} name="note" rows={2} hint={f.noteHint} showOptional value={v.note} onChange={(e) => setV((x) => ({ ...x, note: e.target.value }))} error={error("note")} />
        <Switch label={f.isActive} name="isActive" checked={v.isActive} onChange={(e) => setV((x) => ({ ...x, isActive: e.currentTarget.checked }))} />
        <FormActions>
          <Button onClick={close}>{f.cancel}</Button>
          <SubmitButton variant="primary">{editing ? f.save : f.create}</SubmitButton>
        </FormActions>
      </form>
    </Drawer>
  );
}

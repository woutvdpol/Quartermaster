"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ActionMessage, Button, ConfirmDialog, Drawer, FormActions, Select, SubmitButton, Switch, TextInput, toast, useActionForm, type ActionResult } from "@/components/admin/ui";
import { copy } from "../_copy";
import { deleteValueAction, mergeValueAction, saveValueAction } from "../actions";

const f = copy.valueForm;

type Option = { value: string; label: string };
export type ValueFormValues = { id?: string; facetId: string; name: string; slug: string; parentId: string | null; productCount?: number; childCount?: number };

/** Create / edit a facet value (`?newValue=1[&parent=…]` or `?value=<id>`), with delete and merge. */
export function ValueDrawer({
  initial,
  parentOptions,
  mergeOptions,
  closeHref,
}: {
  initial: ValueFormValues;
  /** Valid parents (edit: excludes the value and its descendants). */
  parentOptions: Option[];
  /** Merge targets (edit only): other values of the facet that are not descendants. */
  mergeOptions: Option[];
  closeHref: string;
}) {
  const router = useRouter();
  const editing = Boolean(initial.id);
  const [values, setValues] = useState(initial);
  const { state, formAction, error } = useActionForm(saveValueAction);
  const close = () => router.replace(closeHref, { scroll: false });

  useEffect(() => {
    if (state?.ok) {
      if (state.message) toast.ok(state.message);
      router.replace(closeHref, { scroll: false });
    }
  }, [state, router, closeHref]);

  const afterDestructive = (res: ActionResult) => {
    if (!res.ok) return res;
    if (res.message) toast.ok(res.message);
    close();
    return undefined;
  };

  return (
    <Drawer
      open
      onOpenChange={(open) => !open && close()}
      title={editing ? f.editTitle : f.createTitle}
      description={editing ? <span className="font-mono">{initial.slug}</span> : undefined}
      footer={
        editing && initial.id ? (
          <div className="mr-auto flex flex-wrap gap-2">
            <ConfirmDialog
              trigger={f.delete}
              triggerSize="sm"
              title={f.deleteTitle(initial.name)}
              description={f.deleteBody(initial.productCount ?? 0, initial.childCount ?? 0)}
              confirmLabel={f.deleteConfirm}
              fields={{ id: initial.id }}
              action={async (fd: FormData) => afterDestructive(await deleteValueAction(fd))}
            />
            {mergeOptions.length > 0 && (
              <ConfirmDialog
                trigger={f.merge}
                triggerSize="sm"
                tone="primary"
                title={f.mergeTitle(initial.name)}
                description={f.mergeBody}
                confirmLabel={f.mergeConfirm}
                fields={{ id: initial.id }}
                action={async (fd: FormData) => afterDestructive(await mergeValueAction(fd))}
              >
                <Select label={f.mergeTarget} name="targetId" required placeholder options={mergeOptions} />
              </ConfirmDialog>
            )}
          </div>
        ) : undefined
      }
    >
      <form action={formAction} className="grid gap-4" noValidate>
        <ActionMessage state={state} showSuccess={false} />
        <input type="hidden" name="facetId" value={initial.facetId} />
        {initial.id && <input type="hidden" name="id" value={initial.id} />}
        {initial.id && <input type="hidden" name="currentSlug" value={initial.slug} />}
        <TextInput
          label={f.name}
          name="name"
          required
          maxLength={100}
          value={values.name}
          onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
          error={error("name")}
          autoFocus={!editing}
        />
        <Select
          label={f.parent}
          name="parentId"
          value={values.parentId ?? ""}
          onChange={(e) => setValues((v) => ({ ...v, parentId: e.target.value || null }))}
          options={[{ value: "", label: f.root }, ...parentOptions]}
          error={error("parentId")}
        />
        <TextInput
          label={f.slug}
          name="slug"
          hint={f.slugHint}
          value={values.slug}
          onChange={(e) => setValues((v) => ({ ...v, slug: e.target.value }))}
          inputClassName="font-mono"
          error={error("slug")}
          showOptional={!editing}
        />
        {editing && <Switch label={f.regenerateSlug} name="regenerateSlug" />}
        <FormActions>
          <Button onClick={close}>{f.cancel}</Button>
          <SubmitButton variant="primary">{editing ? f.save : f.create}</SubmitButton>
        </FormActions>
      </form>
    </Drawer>
  );
}

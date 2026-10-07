"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ActionMessage, Button, ConfirmDialog, Drawer, FormActions, Select, SubmitButton, Switch, TextInput, toast, useActionForm } from "@/components/admin/ui";
import { FACET_KINDS, FACET_KIND_LABELS, type FacetKindName } from "@/server/facets/tree";
import { copy } from "../_copy";
import { deleteFacetAction, saveFacetAction } from "../actions";

const f = copy.facetForm;

export type FacetFormValues = { id?: string; name: string; kind: FacetKindName; slug: string; isFilterable: boolean; valueCount?: number; productCount?: number };

/** Create / edit a facet (`?newFacet=1` or `?editFacet=<id>`). Closing navigates to `closeHref`. */
export function FacetDrawer({ initial, closeHref, deletedHref }: { initial: FacetFormValues; closeHref: string; deletedHref: string }) {
  const router = useRouter();
  const editing = Boolean(initial.id);
  const [values, setValues] = useState(initial);
  const { state, formAction, error } = useActionForm(saveFacetAction);
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
      onOpenChange={(open) => !open && close()}
      title={editing ? f.editTitle : f.createTitle}
      description={editing ? <span className="font-mono">{initial.slug}</span> : undefined}
      footer={
        editing && initial.id ? (
          <div className="mr-auto">
            <ConfirmDialog
              trigger={f.delete}
              triggerSize="sm"
              title={f.deleteTitle(initial.name)}
              description={f.deleteBody(initial.valueCount ?? 0, initial.productCount ?? 0)}
              confirmLabel={f.deleteConfirm}
              fields={{ id: initial.id }}
              action={async (fd: FormData) => {
                const res = await deleteFacetAction(fd);
                if (!res.ok) return res;
                toast.ok(res.message ?? copy.result.facetDeleted);
                router.replace(deletedHref, { scroll: false });
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
          label={f.kind}
          name="kind"
          hint={f.kindHint}
          value={values.kind}
          onChange={(e) => setValues((v) => ({ ...v, kind: e.target.value as FacetKindName }))}
          options={FACET_KINDS.map((k) => ({ value: k, label: FACET_KIND_LABELS[k] }))}
          error={error("kind")}
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
        <Switch label={f.isFilterable} name="isFilterable" checked={values.isFilterable} onChange={(e) => setValues((v) => ({ ...v, isFilterable: e.currentTarget.checked }))} />
        <FormActions>
          <Button onClick={close}>{f.cancel}</Button>
          <SubmitButton variant="primary">{editing ? f.save : f.create}</SubmitButton>
        </FormActions>
      </form>
    </Drawer>
  );
}

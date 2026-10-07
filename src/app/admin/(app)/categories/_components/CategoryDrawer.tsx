"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ActionMessage,
  ConfirmDialog,
  Drawer,
  FormActions,
  Select,
  SubmitButton,
  Switch,
  TextInput,
  Textarea,
  Button,
  toast,
  useActionForm,
} from "@/components/admin/ui";
import { copy } from "../_copy";
import { deleteCategoryAction, saveCategoryAction } from "../actions";

const f = copy.form;
const d = copy.delete;

export type CategoryFormValues = {
  id?: string;
  title: string;
  parentId: string | null;
  slug: string;
  isActive: boolean;
  description: string;
  seoTitle: string;
  seoDescription: string;
};

type Option = { value: string; label: string };

/**
 * Create / edit drawer, opened from the URL (`?new=1[&parent=…]` or `?edit=<id>`). Closing navigates
 * back to `closeHref`. Fields are controlled so a failed save keeps what was typed.
 */
export function CategoryDrawer({
  initial,
  parentOptions,
  reassignOptions,
  contents,
  closeHref,
}: {
  initial: CategoryFormValues;
  /** Valid parents (edit: excludes the category itself and its subcategories). */
  parentOptions: Option[];
  /** Valid targets for the contents when deleting (edit only). */
  reassignOptions: Option[];
  /** Direct products and subcategories (edit only), for the delete dialog. */
  contents?: { products: number; children: number };
  closeHref: string;
}) {
  const router = useRouter();
  const editing = Boolean(initial.id);
  const [values, setValues] = useState(initial);
  const [regenerate, setRegenerate] = useState(false);
  const { state, formAction, error } = useActionForm(saveCategoryAction);

  const close = () => router.replace(closeHref, { scroll: false });

  useEffect(() => {
    if (state?.ok) {
      if (state.message) toast.ok(state.message);
      router.replace(closeHref, { scroll: false });
    }
  }, [state, router, closeHref]);

  const set = <K extends keyof CategoryFormValues>(key: K) => (value: CategoryFormValues[K]) => setValues((v) => ({ ...v, [key]: value }));
  const nonEmpty = contents ? contents.products + contents.children > 0 : false;

  return (
    <Drawer
      open
      onOpenChange={(open) => !open && close()}
      title={editing ? f.editTitle : f.createTitle}
      description={editing ? <span className="font-mono">/{initial.slug}</span> : undefined}
      size="lg"
      footer={
        editing && initial.id ? (
          <div className="mr-auto">
            <ConfirmDialog
              trigger={d.trigger}
              triggerSize="sm"
              title={d.title(initial.title)}
              description={nonEmpty && contents ? d.body(contents.products, contents.children) : d.emptyBody}
              confirmLabel={d.confirm}
              action={async (fd: FormData) => {
                const res = await deleteCategoryAction(fd);
                if (res.ok) {
                  if (res.message) toast.ok(res.message);
                  close();
                  return undefined;
                }
                return res;
              }}
              fields={{ id: initial.id, needsTarget: nonEmpty ? "1" : "0" }}
            >
              {nonEmpty && <Select label={d.reassign} name="reassignTo" required placeholder options={reassignOptions} />}
            </ConfirmDialog>
          </div>
        ) : undefined
      }
    >
      <form action={formAction} className="grid gap-4" noValidate>
        <ActionMessage state={state} showSuccess={false} />
        {initial.id && <input type="hidden" name="id" value={initial.id} />}
        {initial.id && <input type="hidden" name="currentSlug" value={initial.slug} />}
        <TextInput
          label={f.title}
          name="title"
          required
          value={values.title}
          onChange={(e) => set("title")(e.target.value)}
          error={error("title")}
          autoFocus={!editing}
        />
        <Select
          label={f.parent}
          name="parentId"
          value={values.parentId ?? ""}
          onChange={(e) => set("parentId")(e.target.value || null)}
          options={[{ value: "", label: f.root }, ...parentOptions]}
          hint={editing ? f.moveHint : undefined}
          error={error("parentId")}
        />
        <div className="grid gap-2">
          <TextInput
            label={f.slug}
            name="slug"
            value={values.slug}
            onChange={(e) => set("slug")(e.target.value)}
            hint={editing ? f.slugHintEdit : f.slugHintCreate}
            error={error("slug")}
            disabled={regenerate}
            inputClassName="font-mono"
            showOptional={!editing}
          />
          {editing && (
            <Switch label={f.regenerateSlug} name="regenerateSlug" checked={regenerate} onChange={(e) => setRegenerate(e.target.checked)} />
          )}
        </div>
        <Switch
          label={f.active}
          description={f.activeHint}
          name="isActive"
          checked={values.isActive}
          onChange={(e) => set("isActive")(e.target.checked)}
          layout="row"
        />
        <Textarea
          label={f.description}
          name="description"
          rows={4}
          value={values.description}
          onChange={(e) => set("description")(e.target.value)}
          error={error("description")}
          showOptional
        />
        <fieldset className="grid gap-3 rounded-card border border-line p-3">
          <legend className="type-label px-1 text-[11.5px] text-muted">{f.seo}</legend>
          <TextInput
            label={f.seoTitle}
            name="seoTitle"
            value={values.seoTitle}
            onChange={(e) => set("seoTitle")(e.target.value)}
            error={error("seoTitle")}
            maxLength={200}
            showOptional
          />
          <Textarea
            label={f.seoDescription}
            name="seoDescription"
            rows={3}
            value={values.seoDescription}
            onChange={(e) => set("seoDescription")(e.target.value)}
            error={error("seoDescription")}
            maxLength={500}
            showOptional
          />
        </fieldset>
        <FormActions>
          <Button onClick={close}>{f.cancel}</Button>
          <SubmitButton variant="primary">{editing ? f.save : f.create}</SubmitButton>
        </FormActions>
      </form>
    </Drawer>
  );
}

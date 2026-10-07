"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ActionMessage, Button, ConfirmDialog, Drawer, FormActions, SubmitButton, Switch, TextInput, Textarea, toast, useActionForm } from "@/components/admin/ui";
import { copy } from "../_copy";
import { deleteTagsAction, updateTagAction } from "../actions";

const t = copy.tags;

/** Rename / describe a tag (`?tab=tags&tag=<id>`). Closing navigates back to `closeHref`. */
export function TagDrawer({
  tag,
  closeHref,
}: {
  tag: { id: string; name: string; slug: string; description: string | null; productCount: number };
  closeHref: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(tag.name);
  const [description, setDescription] = useState(tag.description ?? "");
  const { state, formAction, error } = useActionForm(updateTagAction);
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
      title={t.editTitle}
      description={<span className="font-mono">{tag.slug}</span>}
      footer={
        <div className="mr-auto">
          <ConfirmDialog
            trigger={t.deleteOne}
            triggerSize="sm"
            title={t.deleteOneTitle(tag.name)}
            description={t.deleteOneBody(tag.productCount)}
            confirmLabel={t.deleteConfirm}
            fields={{ ids: tag.id }}
            action={async (fd: FormData) => {
              const res = await deleteTagsAction(fd);
              if (!res.ok) return res;
              toast.ok(copy.result.tagsDeleted(1));
              close();
              return undefined;
            }}
          />
        </div>
      }
    >
      <form action={formAction} className="grid gap-4" noValidate>
        <ActionMessage state={state} showSuccess={false} />
        <input type="hidden" name="id" value={tag.id} />
        <TextInput label={t.name} name="name" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} error={error("name")} />
        <Switch label={t.regenerateSlug} name="regenerateSlug" />
        <Textarea
          label={t.description}
          name="description"
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          error={error("description")}
          showOptional
        />
        <FormActions>
          <Button onClick={close}>{copy.form.cancel}</Button>
          <SubmitButton variant="primary">{t.save}</SubmitButton>
        </FormActions>
      </form>
    </Drawer>
  );
}

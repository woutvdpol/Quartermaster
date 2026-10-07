"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ActionMessage,
  ActionToast,
  ConfirmDialog,
  Drawer,
  FormActions,
  SubmitButton,
  TextInput,
  Tooltip,
  buttonClasses,
  useActionForm,
} from "@/components/admin/ui";
import { copy } from "../_copy";
import { createPageAction, deletePageAction, duplicatePageAction, ensureSystemPagesAction } from "../actions";

const t = copy.list;

/** "New page" drawer: title + optional slug; on success the action redirects to the editor. */
export function NewPageButton() {
  const [open, setOpen] = useState(false);
  // Controlled so a failed submit keeps what was typed (React resets uncontrolled fields).
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const { state, formAction, error } = useActionForm(createPageAction);
  return (
    <>
      <button type="button" className={buttonClasses({ variant: "primary" })} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        {t.newPage}
      </button>
      <Drawer open={open} onOpenChange={setOpen} title={copy.create.title} description={copy.create.description}>
        <form action={formAction} className="grid gap-4" noValidate>
          <ActionMessage state={state} showSuccess={false} />
          <TextInput
            label={copy.create.fieldTitle}
            name="title"
            required
            maxLength={200}
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            error={error("title")}
          />
          <TextInput
            label={copy.create.fieldSlug}
            name="slug"
            maxLength={80}
            leading="/"
            hint={copy.create.slugHint}
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            error={error("slug")}
            inputClassName="font-mono"
            spellCheck={false}
          />
          <FormActions>
            <button type="button" className={buttonClasses()} onClick={() => setOpen(false)}>
              Cancel
            </button>
            <SubmitButton variant="primary" pendingLabel={copy.create.pending}>
              {copy.create.submit}
            </SubmitButton>
          </FormActions>
        </form>
      </Drawer>
    </>
  );
}

export function EnsureSystemPagesButton({ variant = "secondary" }: { variant?: "primary" | "secondary" }) {
  const { state, formAction } = useActionForm(ensureSystemPagesAction);
  return (
    <form action={formAction}>
      <ActionToast state={state} />
      <SubmitButton variant={variant} pendingLabel="Creating…">
        {t.ensureSystem}
      </SubmitButton>
    </form>
  );
}

export function PageRowActions({ id, title, systemKey }: { id: string; title: string; systemKey: string | null }) {
  const { state, formAction } = useActionForm(duplicatePageAction);
  return (
    <div className="flex items-center justify-end gap-1.5">
      <Link href={`/admin/pages/${id}`} className={buttonClasses({ size: "sm" })}>
        {t.edit}
      </Link>
      <form action={formAction}>
        <ActionToast state={state} />
        <input type="hidden" name="id" value={id} />
        <SubmitButton size="sm" pendingLabel="Duplicating…">
          {t.duplicate}
        </SubmitButton>
      </form>
      {systemKey ? (
        <Tooltip content={t.systemProtected}>
          <button type="button" className={buttonClasses({ variant: "danger", size: "sm" })} aria-disabled="true" aria-label={`${t.delete} (${t.systemProtected})`}>
            {t.delete}
          </button>
        </Tooltip>
      ) : (
        <ConfirmDialog
          trigger={t.delete}
          triggerSize="sm"
          title={t.deleteTitle(title)}
          description={t.deleteBody}
          confirmLabel={t.delete}
          action={deletePageAction}
          fields={{ id }}
        />
      )}
    </div>
  );
}

"use client";

import { useRef, useState, useTransition } from "react";
import {
  ActionMessage,
  ActionToast,
  Checkbox,
  ConfirmDialog,
  DateTime,
  EmptyState,
  Field,
  FormActions,
  Select,
  SubmitButton,
  Switch,
  TextInput,
  controlClass,
  cx,
  toast,
  useActionForm,
} from "@/components/admin/ui";
import { deleteDocumentAction, setDocumentPublicAction, uploadDocumentAction } from "./actions";
import { provenanceCardCopy as copy } from "./_copy";

const t = copy.documents;

export type DocumentRow = {
  id: string;
  kind: keyof typeof t.kinds;
  title: string;
  mimeType: string;
  byteSize: number;
  isPublic: boolean;
  createdAt: Date;
  url: string;
};

const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp";
const ACCEPTED_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function typeLabel(mime: string): string {
  return mime === "application/pdf" ? "PDF" : mime.replace("image/", "").toUpperCase();
}

export function DocumentsPanel({
  productId,
  documents,
  timeZone,
  maxPdfBytes,
  maxImageBytes,
}: {
  productId: string;
  documents: DocumentRow[];
  timeZone: string;
  maxPdfBytes: number;
  maxImageBytes: number;
}) {
  const { state, formAction, error } = useActionForm(uploadDocumentAction);
  const [clientError, setClientError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  function checkFile() {
    const f = fileRef.current?.files?.[0];
    setClientError(null);
    if (!f) return;
    if (f.type && !ACCEPTED_TYPES.has(f.type)) setClientError(t.unsupported);
    else if (f.type === "application/pdf" && f.size > maxPdfBytes) setClientError(t.tooLarge(maxPdfBytes / 1024 / 1024));
    else if (f.size > maxImageBytes) setClientError(t.tooLarge(maxImageBytes / 1024 / 1024));
  }

  function togglePublic(doc: DocumentRow, next: boolean) {
    startTransition(async () => {
      const r = await setDocumentPublicAction(productId, doc.id, next);
      if (r.ok) toast.ok(r.message ?? "");
      else toast.crit(r.message ?? copy.errors.generic);
    });
  }

  return (
    <div className="grid gap-3">
      {documents.length === 0 ? (
        <EmptyState compact title={t.heading} body={t.empty} />
      ) : (
        <ul className="grid divide-y divide-line rounded-control border border-line" aria-label={t.heading}>
          {documents.map((doc) => (
            <li key={doc.id} className="grid gap-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="min-w-0">
                <a href={doc.url} target="_blank" rel="noopener" className="block truncate text-[13.5px] font-medium text-ink underline-offset-2 hover:underline">
                  {doc.title}
                </a>
                <p className="text-xs text-muted">
                  {t.kinds[doc.kind]} · <span className="font-mono">{typeLabel(doc.mimeType)}</span> · <span className="font-mono">{formatBytes(doc.byteSize)}</span> ·{" "}
                  <DateTime value={doc.createdAt} format="date" timeZone={timeZone} />
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Switch
                  label={doc.isPublic ? t.public : t.private}
                  aria-label={`${t.isPublic}: ${doc.title}`}
                  checked={doc.isPublic}
                  disabled={pending}
                  onChange={(e) => togglePublic(doc, e.target.checked)}
                />
                <ConfirmDialog
                  trigger={t.delete}
                  triggerSize="sm"
                  title={t.deleteTitle}
                  description={t.deleteBody(doc.title)}
                  confirmLabel={t.delete}
                  action={deleteDocumentAction}
                  fields={{ id: doc.id, productId }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      <form action={formAction} className="grid gap-3 rounded-control border border-dashed border-line p-3" noValidate>
        <input type="hidden" name="productId" value={productId} />
        <ActionMessage state={state} showSuccess={false} />
        <ActionToast state={state} errors={false} />
        <Field label={t.file} hint={t.fileHint} error={clientError ?? error("file")} required>
          {(control) => (
            <input
              {...control}
              ref={fileRef}
              type="file"
              name="file"
              accept={ACCEPT}
              required
              onChange={checkFile}
              className={cx(controlClass, "cursor-pointer file:mr-3 file:rounded-control file:border-0 file:bg-panel-2 file:px-2 file:py-1 file:text-xs")}
            />
          )}
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput label={t.title} name="title" hint={t.titleHint} maxLength={200} error={error("title")} />
          <Select
            label={t.kind}
            name="kind"
            defaultValue="PROVENANCE"
            error={error("kind")}
            options={Object.entries(t.kinds).map(([value, label]) => ({ value, label }))}
          />
        </div>
        <Checkbox name="isPublic" label={t.isPublic} />
        <FormActions>
          <SubmitButton size="sm" pendingLabel={t.uploading} disabled={!!clientError}>
            {t.upload}
          </SubmitButton>
        </FormActions>
      </form>
    </div>
  );
}

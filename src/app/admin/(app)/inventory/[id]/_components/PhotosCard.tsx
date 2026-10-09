"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type ReactNode } from "react";
import { Card, ConfirmDialog, Dropzone, TextInput, Thumb, toast, type DropzoneItem } from "@/components/admin/ui";
import { deleteImageAction, reorderImagesAction, updateImageAltAction } from "../actions";
import { copy } from "../_copy";
import type { UploadResponse } from "../_lib/limits";
import { checkDuplicatesAction, type DuplicateCandidateView } from "../_ext/duplicates/actions";
import { DuplicatePanel } from "../_ext/duplicates/DuplicatePanel";

export type PhotoDto = { id: string; url: string; name: string; alt: string | null };

const t = copy.photos;

const isNew = (id: string) => id.startsWith("new-");
const isHeic = (f: File) => /^image\/hei[cf]/i.test(f.type) || /\.hei[cf]$/i.test(f.name);

function toItem(p: PhotoDto): DropzoneItem {
  return { id: p.id, url: p.url, name: p.alt || p.name };
}

/**
 * Photos: kit Dropzone (drop / paste / pick, drag or ←→ to reorder; first = cover). Every file is
 * uploaded on its own to ./images (route handler); reorder and alt text are server actions; delete
 * goes through a ConfirmDialog (the Dropzone × opens the same dialog as the row's Delete button).
 */
export function PhotosCard({
  productId,
  photos,
  limit,
  transportMaxBytes,
  serviceMaxBytes,
  lineage,
}: {
  productId: string;
  photos: PhotoDto[];
  limit: number;
  transportMaxBytes: number;
  serviceMaxBytes: number;
  /** Earlier / later listings of the same piece (duplicate check, _ext/duplicates). */
  lineage?: ReactNode;
}) {
  const router = useRouter();
  const [items, setItems] = useState<DropzoneItem[]>(() => photos.map(toItem));
  const [, startTransition] = useTransition();
  const rowsRef = useRef<HTMLUListElement>(null);
  const [duplicates, setDuplicates] = useState<DuplicateCandidateView[]>([]);

  // Re-sync with the server list after a refresh, keeping files that are still in flight / failed.
  const [lastPhotos, setLastPhotos] = useState(photos);
  if (photos !== lastPhotos) {
    setLastPhotos(photos);
    const local = items.filter((i) => isNew(i.id));
    setItems([...photos.map(toItem), ...local]);
  }

  const patchItem = (id: string, patch: Partial<DropzoneItem> | null) =>
    setItems((list) => (patch === null ? list.filter((i) => i.id !== id) : list.map((i) => (i.id === id ? { ...i, ...patch } : i))));

  async function upload(files: File[], added: DropzoneItem[]) {
    const queue: { file: File; item: DropzoneItem }[] = [];
    for (const [i, file] of files.entries()) {
      const item = added[i];
      if (isHeic(file)) patchItem(item.id, { status: "error", error: t.heic });
      else if (file.size > transportMaxBytes) patchItem(item.id, { status: "error", error: t.tooLargeForTransport(Math.floor(transportMaxBytes / 1024 / 1024)) });
      else {
        patchItem(item.id, { status: "uploading" });
        queue.push({ file, item });
      }
    }
    let uploaded = 0;
    const uploadedIds: string[] = [];
    // Sequential: the server processes images one by one anyway, and errors stay per file.
    for (const { file, item } of queue) {
      const body = new FormData();
      body.append("files", file, file.name);
      let result: UploadResponse;
      try {
        const res = await fetch(`/admin/inventory/${encodeURIComponent(productId)}/images`, { method: "POST", body });
        result = (await res.json().catch(() => ({ ok: false, message: t.uploadFailed }))) as UploadResponse;
      } catch {
        result = { ok: false, message: t.uploadFailed };
      }
      if (result.ok && result.images[0]) {
        const img = result.images[0];
        setItems((list) => list.map((i) => (i.id === item.id ? toItem(img) : i)));
        uploaded++;
        uploadedIds.push(img.id);
      } else {
        const message = result.ok ? t.uploadFailed : result.message;
        patchItem(item.id, { status: "error", error: message });
        toast.crit(t.uploadFailed, { description: `${file.name}: ${message}` });
      }
    }
    if (uploaded) {
      toast.ok(t.uploaded(uploaded));
      router.refresh();
      // Duplicate check: after the upload, async and best effort (never delays or blocks saving).
      void checkDuplicatesAction(productId, uploadedIds).then(setDuplicates, () => {});
    }
  }

  function onItemsChange(next: DropzoneItem[]) {
    // A removed, already-stored photo is only deleted after confirmation (see onRemove).
    const ids = new Set(next.map((i) => i.id));
    if (items.some((i) => !isNew(i.id) && !ids.has(i.id))) return;
    setItems(next);
  }

  function onRemove(item: DropzoneItem) {
    if (isNew(item.id)) return; // failed / local file: just dropped from the list
    rowsRef.current?.querySelector<HTMLButtonElement>(`[data-photo-delete="${CSS.escape(item.id)}"] button`)?.click();
  }

  function onReorder(ids: string[]) {
    if (items.some((i) => i.status === "uploading")) {
      toast.warn(t.waitForUploads);
      setItems([...photos.map(toItem), ...items.filter((i) => isNew(i.id))]);
      return;
    }
    const stored = ids.filter((id) => !isNew(id));
    startTransition(async () => {
      const r = await reorderImagesAction(productId, stored);
      if (r.ok) toast.ok(r.message ?? t.reordered);
      else {
        toast.crit(r.message ?? copy.errors.generic);
        router.refresh();
      }
    });
  }

  function saveAlt(photo: PhotoDto, value: string) {
    if (value.trim() === (photo.alt ?? "")) return;
    startTransition(async () => {
      const r = await updateImageAltAction(productId, photo.id, value);
      if (r.ok) toast.ok(r.message ?? t.altSaved);
      else toast.crit(r.message ?? copy.errors.generic);
    });
  }

  const storedCount = items.filter((i) => !isNew(i.id)).length;

  return (
    <Card title={copy.cards.photos} aside={copy.cards.photosAside(storedCount, limit)}>
      <div className="grid gap-4">
        {lineage}
        <Dropzone
          label={t.label}
          hint={t.hint(Math.floor(Math.min(transportMaxBytes, serviceMaxBytes) / 1024 / 1024))}
          items={items}
          onItemsChange={onItemsChange}
          onFilesAdded={(files, added) => void upload(files, added)}
          onRemove={onRemove}
          onReorder={onReorder}
          accept="image/*,.heic,.heif"
          maxFiles={limit}
        />

        {duplicates.length > 0 && <DuplicatePanel productId={productId} candidates={duplicates} onClose={() => setDuplicates([])} />}

        {photos.length > 0 && (
          <section aria-labelledby="photo-alt-title" className="grid gap-2">
            <div>
              <h3 id="photo-alt-title" className="type-label text-xs text-muted">
                {t.altTitle}
              </h3>
              <p className="text-xs text-muted">{t.altHint}</p>
            </div>
            <ul ref={rowsRef} className="grid gap-2">
              {photos.map((p, i) => (
                <li key={p.id} className="flex items-center gap-2.5">
                  <Thumb src={p.url} alt="" size="sm" />
                  <TextInput
                    key={`${p.id}:${p.alt ?? ""}`}
                    label={t.altLabel(i === 0 ? `${t.cover.toLowerCase()} photo` : `photo ${i + 1}`)}
                    labelHidden
                    className="min-w-0 flex-1"
                    defaultValue={p.alt ?? ""}
                    maxLength={250}
                    placeholder={t.altPlaceholder}
                    onBlur={(e) => saveAlt(p, e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        e.currentTarget.blur();
                      }
                    }}
                  />
                  <span data-photo-delete={p.id}>
                    <ConfirmDialog
                      trigger={t.deleteTrigger}
                      triggerLabel={t.deleteLabel(i === 0 ? "the cover photo" : `photo ${i + 1}`)}
                      triggerSize="sm"
                      title={t.deleteTitle}
                      description={
                        <div className="grid gap-2">
                          <Thumb src={p.url} alt="" size="lg" />
                          <p>{t.deleteBody}</p>
                        </div>
                      }
                      confirmLabel={t.deleteConfirm}
                      action={deleteImageAction}
                      fields={{ productId, imageId: p.id }}
                    />
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Card>
  );
}

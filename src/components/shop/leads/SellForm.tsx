"use client";

import Link from "@/components/shop/ui/Link";
import { useActionState, useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { Alert, Field, Honeypot, SubmitButton } from "@/components/shop/account/form";
import { ButtonLink, buttonClasses } from "@/components/shop/ui/Button";
import { cn } from "@/components/shop/ui/cn";
import { checkClasses, textareaClasses } from "@/components/shop/ui/Field";
import { Turnstile } from "@/components/shop/turnstile/Turnstile";
import { submitLeadAction } from "@/app/(shop)/sell/actions";
import { useShopCopy, useShopLocale } from "@/components/shop/i18n/ShopLocale";
import { localizePath } from "@/lib/i18n/shop-locales";
import { leadsCopies } from "./_copy";
import type { LeadUploadResponse } from "./types";

const MAX_PHOTOS = 10;
const MAX_MB = 15;
const ACCEPT = "image/jpeg,image/png,image/webp";
const UPLOAD_URL = "/sell/upload";

/** Client-side key of a photo in the list (event handlers only). */
const newLocalId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

type PhotoItem = {
  localId: string;
  name: string;
  preview: string;
  status: "uploading" | "done" | "error";
  file?: string;
  error?: string;
};

function TextArea({ id, label, hint, error, ...rest }: { id: string; label: string; hint?: string; error?: string } & React.ComponentPropsWithoutRef<"textarea">) {
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-shop-ink">
        {label}
      </label>
      <textarea id={id} name={id} rows={5} aria-invalid={error ? true : undefined} aria-describedby={describedBy} className={textareaClasses} {...rest} />
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-shop-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-shop-crit">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * "Sell your collection" form. Photos upload directly (one request each) to /sell/upload with the
 * signed draft token; the form then submits only their file names. Props:
 *  - draft: signed draft token from createLeadDraft() (page render).
 *  - shopName: for the consent text.
 *  - privacyHref: link to the privacy page, if the shop has one.
 */
export function SellForm({ draft, shopName, privacyHref }: { draft: string; shopName: string; privacyHref?: string | null }) {
  const t = useShopCopy(leadsCopies);
  // Localised so the route handler answers in the visitor's language (the proxy sets the language header).
  const uploadUrl = localizePath(UPLOAD_URL, useShopLocale());
  const [state, action] = useActionState(submitLeadAction, undefined);
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const photosRef = useRef(photos);
  const doneRef = useRef<HTMLDivElement>(null);
  const baseId = useId();

  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);
  useEffect(() => () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.preview)), []);
  useEffect(() => {
    if (state?.ok) doneRef.current?.focus();
  }, [state]);

  const fe = state?.fieldErrors ?? {};
  const uploading = photos.some((p) => p.status === "uploading");

  function update(localId: string, patch: Partial<PhotoItem>) {
    setPhotos((list) => list.map((p) => (p.localId === localId ? { ...p, ...patch } : p)));
  }

  async function upload(item: PhotoItem, file: File) {
    const body = new FormData();
    body.set("draft", draft);
    body.set("file", file);
    try {
      const res = await fetch(uploadUrl, { method: "POST", body });
      const data = (await res.json().catch(() => null)) as LeadUploadResponse | null;
      if (data?.ok) update(item.localId, { status: "done", file: data.photo.file });
      else update(item.localId, { status: "error", error: data?.message ?? t.errors.uploadFailed(item.name) });
    } catch {
      update(item.localId, { status: "error", error: t.errors.uploadFailed(item.name) });
    }
  }

  function onFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    addFiles(files);
  }

  function addFiles(files: File[]) {
    setPhotoError(null);
    const room = MAX_PHOTOS - photos.length;
    if (files.length > room) setPhotoError(t.errors.tooMany(MAX_PHOTOS));
    const accepted: { item: PhotoItem; file: File }[] = [];
    const problems: string[] = [];
    for (const file of files.slice(0, Math.max(room, 0))) {
      if (!ACCEPT.split(",").includes(file.type)) {
        problems.push(t.errors.wrongType(file.name));
        continue;
      }
      if (file.size > MAX_MB * 1024 * 1024) {
        problems.push(t.errors.tooLarge(file.name, MAX_MB));
        continue;
      }
      accepted.push({
        file,
        item: { localId: newLocalId(), name: file.name, preview: URL.createObjectURL(file), status: "uploading" },
      });
    }
    if (problems.length) setPhotoError(problems.join(" "));
    if (!accepted.length) return;
    setPhotos((list) => [...list, ...accepted.map((a) => a.item)]);
    // Two at a time keeps phones responsive on slow connections.
    const queue = [...accepted];
    const worker = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) await upload(next.item, next.file);
    };
    void Promise.all([worker(), worker()]);
  }

  function remove(item: PhotoItem) {
    URL.revokeObjectURL(item.preview);
    setPhotos((list) => list.filter((p) => p.localId !== item.localId));
    if (item.file) {
      void fetch(uploadUrl, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft, file: item.file }),
      }).catch(() => {});
    }
  }

  if (state?.ok) {
    return (
      <div ref={doneRef} tabIndex={-1} className="rounded-shop bg-shop-sunken p-6 outline-none sm:p-8" role="status">
        <h2 className="text-2xl text-shop-ink sm:text-3xl">{t.done.title}</h2>
        <p className="mt-3 text-shop-ink-2">{t.done.body}</p>
        <ButtonLink href="/" variant="outline" className="mt-6">
          {t.done.again}
        </ButtonLink>
      </div>
    );
  }

  const v = state?.values;
  const photosId = `${baseId}-photos`;

  return (
    <form action={action} className="relative grid gap-5" noValidate>
      <input type="hidden" name="draft" value={draft} />
      <Honeypot />
      {state?.error ? <Alert tone="error">{state.error}</Alert> : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="name" label={t.fields.name} autoComplete="name" required maxLength={200} defaultValue={v?.name} error={fe.name} />
        <Field
          id="email"
          label={t.fields.email}
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          maxLength={254}
          defaultValue={v?.email}
          error={fe.email}
        />
      </div>
      <Field id="phone" label={t.fields.phone} type="tel" autoComplete="tel" maxLength={40} hint={t.fields.phoneHint} defaultValue={v?.phone} error={fe.phone} />
      <TextArea
        id="itemsDescription"
        label={t.fields.itemsDescription}
        hint={t.fields.itemsDescriptionHint}
        required
        maxLength={5000}
        defaultValue={v?.itemsDescription}
        error={fe.itemsDescription}
      />

      <fieldset className="grid gap-2" aria-describedby={`${photosId}-hint`}>
        <legend className="mb-1.5 text-sm font-medium text-shop-ink">{t.fields.photos}</legend>
        <p id={`${photosId}-hint`} className="text-xs text-shop-muted">
          {t.fields.photosHint(MAX_PHOTOS, MAX_MB)} <span aria-live="polite">{t.fields.photoCount(photos.length, MAX_PHOTOS)}</span>
        </p>
        {photos.length ? (
          <ul role="list" className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {photos.map((p, i) => (
              <li key={p.localId} className="relative overflow-hidden rounded-shop bg-shop-sunken">
                {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
                <img src={p.preview} alt="" className={cn("aspect-square w-full object-cover", p.status !== "done" && "opacity-60")} />
                {p.status === "uploading" ? (
                  <span className="absolute inset-x-0 bottom-0 bg-shop-surface/90 px-1 py-0.5 text-center text-[0.7rem] text-shop-ink-2">{t.fields.uploading}</span>
                ) : null}
                {p.status === "error" ? (
                  <span className="absolute inset-x-0 bottom-0 bg-shop-crit-soft px-1 py-0.5 text-center text-[0.7rem] text-shop-crit" title={p.error}>
                    !
                  </span>
                ) : null}
                {p.status === "done" && p.file ? <input type="hidden" name="photos" value={p.file} /> : null}
                <button
                  type="button"
                  onClick={() => remove(p)}
                  aria-label={t.fields.removePhoto(i + 1)}
                  className="absolute top-0 right-0 grid size-11 place-items-center text-shop-ink"
                >
                  <span aria-hidden="true" className="grid size-7 place-items-center rounded-shop-control bg-shop-surface shadow-shop">
                    <svg viewBox="0 0 16 16" width="12" height="12">
                      <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {photos.some((p) => p.status === "error") ? (
          <ul className="grid gap-1 text-sm text-shop-crit" role="alert">
            {photos.filter((p) => p.status === "error").map((p) => (
              <li key={p.localId}>{p.error}</li>
            ))}
          </ul>
        ) : null}
        {photoError ? (
          <p className="text-sm text-shop-crit" role="alert">
            {photoError}
          </p>
        ) : null}
        {fe.photos ? <p className="text-sm text-shop-crit">{fe.photos}</p> : null}
        <div
          className="relative"
          onDragOver={(e) => {
            if (photos.length >= MAX_PHOTOS || !e.dataTransfer.types.includes("Files")) return;
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (photos.length < MAX_PHOTOS) addFiles(Array.from(e.dataTransfer.files));
          }}
        >
          <input ref={inputRef} id={photosId} type="file" accept={ACCEPT} multiple className="peer sr-only" onChange={onFiles} disabled={photos.length >= MAX_PHOTOS} />
          <label
            htmlFor={photosId}
            className={cn(
              "flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-shop border border-dashed border-shop-line-strong bg-shop-sunken/50 px-4 py-6 text-center text-sm transition-colors hover:border-shop-ink hover:bg-shop-sunken",
              "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-shop-primary",
              dragging && "border-shop-primary bg-shop-primary-soft",
              photos.length >= MAX_PHOTOS && "pointer-events-none opacity-55",
            )}
          >
            <span aria-hidden="true" className="grid size-11 place-items-center rounded-shop-control bg-shop-surface text-shop-ink shadow-shop">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 16V5M7.5 9.5L12 5l4.5 4.5M5 19h14" />
              </svg>
            </span>
            <span className="font-semibold text-shop-ink">{t.fields.addPhotos}</span>
          </label>
        </div>
      </fieldset>

      <TextArea id="message" label={t.fields.message} hint={t.fields.messageHint} rows={3} maxLength={5000} defaultValue={v?.message} error={fe.message} />

      <div className="grid gap-1.5">
        <label className="flex cursor-pointer items-start gap-3 py-1 text-sm text-shop-ink-2">
          <input
            type="checkbox"
            name="consent"
            required
            defaultChecked={v?.consent}
            aria-invalid={fe.consent ? true : undefined}
            aria-describedby={fe.consent ? "consent-error" : undefined}
            className={cn(checkClasses, "mt-0.5")}
          />
          <span>
            {t.fields.consent(shopName)}
            {privacyHref ? (
              <>
                {" "}
                <Link href={privacyHref} className="text-shop-primary underline underline-offset-4" target="_blank">
                  {t.fields.privacy}
                </Link>
              </>
            ) : null}
          </span>
        </label>
        {fe.consent ? (
          <p id="consent-error" className="text-sm text-shop-crit">
            {fe.consent}
          </p>
        ) : null}
      </div>

      <Turnstile action="sell" resetKey={state?.attempt} />

      {uploading ? <p className="text-sm text-shop-muted">{t.waitForUploads}</p> : null}
      <div>
        {uploading ? (
          <button type="button" disabled className={buttonClasses("primary", "lg", "w-full sm:w-auto")}>
            {t.fields.uploading}
          </button>
        ) : (
          <SubmitButton pendingLabel={t.submitting} size="lg" className="w-full sm:w-auto">
            {t.submit}
          </SubmitButton>
        )}
      </div>
    </form>
  );
}

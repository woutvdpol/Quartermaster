"use client";

import Form from "next/form";
import { useCallback, useEffect, useId, useRef, useState, type DragEvent } from "react";
import { cn } from "@/components/shop/ui/cn";
import { IntentLink } from "@/components/shop/ui/IntentLink";
import { formatMoney } from "@/components/shop/ui/money";
import { useLocalizedHref, useShopCopy, useShopLocale } from "@/components/shop/i18n/ShopLocale";
import { LockedImg, ShopImg } from "@/components/shop/ui/ShopImg";
import type { ImageSearchItem, ImageSearchResponse, SearchErrorResponse } from "@/server/search/api-types";
import { PHOTO_MAX_BYTES, downscalePhoto, isImageFile } from "./photo-image";
import { searchCopies } from "./_copy";

/** "€1,450.00" → "€1,450", "1.450,00 €" → "1.450 €" (whole amounts without cents). */
const dropZeroCents = (s: string) => s.replace(/[.,]00(?=\D*$)/, "");

type Phase =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "results"; res: ImageSearchResponse }
  | { kind: "unavailable" }
  | { kind: "error"; message: string };

/** The common category of the top matches ("Looks like: Steel helmets"), when they agree. */
function looksLike(items: ImageSearchItem[]): string | null {
  const top = items.slice(0, 3).map((i) => i.eyebrow).filter(Boolean);
  return top.length >= 2 && top.every((e) => e === top[0]) ? (top[0] as string) : null;
}

/**
 * Photo search (lazy chunk of SearchField): a modal dialog on desktop, a full-screen sheet on phones
 * (docs/design/search/Photo.dc.html). Choose or take a photo (`capture="environment"`), drop or paste
 * one on desktop; it is downscaled to ≤ 768 px JPEG in the browser and POSTed to /api/search/image.
 * Results show a match label per item; "Add words…" refines with text. When the embedder is down
 * (503) the dialog offers a text search instead. The photo is never stored (server: in memory only).
 */
export function PhotoSearchDialog({ onClose }: { onClose: () => void }) {
  const locale = useShopLocale();
  const copy = useShopCopy(searchCopies);
  const t = copy.photo;
  const localizedHref = useLocalizedHref();
  const dialog = useRef<HTMLDialogElement>(null);
  const chooseInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const wordsInput = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [words, setWords] = useState("");
  const [showWords, setShowWords] = useState(false);
  const [dragging, setDragging] = useState(false);
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }, []);
  // Revoke the preview URL when the photo changes / the dialog closes.
  useEffect(() => () => void (photo && URL.revokeObjectURL(photo.url)), [photo]);
  useEffect(() => () => ctrl.current?.abort(), []);

  const search = useCallback(async (blob: Blob, q: string) => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setPhase({ kind: "busy" });
    const form = new FormData();
    form.append("file", blob, "photo.jpg");
    if (q.trim()) form.append("q", q.trim());
    try {
      const res = await fetch(locale === "en" ? "/api/search/image" : `/api/search/image?locale=${locale}`, { method: "POST", body: form, signal: c.signal });
      const body = (await res.json().catch(() => null)) as ImageSearchResponse | SearchErrorResponse | null;
      if (c.signal.aborted) return;
      if (res.ok && body && "items" in body) setPhase({ kind: "results", res: body });
      else if (res.status === 503) setPhase({ kind: "unavailable" });
      else setPhase({ kind: "error", message: body && "message" in body ? body.message : t.failed });
    } catch {
      if (!c.signal.aborted) setPhase({ kind: "error", message: t.failed });
    }
  }, [t, locale]);

  const accept = useCallback(
    async (file: File | null | undefined) => {
      if (!file) return;
      if (!isImageFile(file)) {
        setPhase({ kind: "error", message: t.notImage });
        return;
      }
      setPhase({ kind: "busy" });
      const blob = await downscalePhoto(file);
      if (blob.size > PHOTO_MAX_BYTES) {
        setPhase({ kind: "error", message: t.tooLarge });
        return;
      }
      setPhoto({ blob, url: URL.createObjectURL(blob) });
      void search(blob, words);
    },
    [search, words, t],
  );

  // Paste a photo anywhere while the dialog is open (desktop).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = [...(e.clipboardData?.files ?? [])].find(isImageFile);
      if (file) {
        e.preventDefault();
        void accept(file);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [accept]);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void accept([...e.dataTransfer.files].find(isImageFile) ?? e.dataTransfer.files[0]);
  };

  const pick = (camera: boolean) => (camera ? cameraInput : chooseInput).current?.click();
  const results = phase.kind === "results" ? phase.res : null;
  const like = results ? looksLike(results.items) : null;

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) e.currentTarget.close(); // backdrop click
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={onDrop}
      className={cn(
        "m-0 h-dvh max-h-none w-full max-w-none bg-shop-bg p-0 text-shop-ink backdrop:bg-shop-scrim open:flex open:flex-col",
        "sm:m-auto sm:h-fit sm:max-h-[min(88dvh,52rem)] sm:w-[min(52rem,calc(100vw-3rem))] sm:rounded-shop sm:shadow-shop-pop",
      )}
    >
      <input ref={chooseInput} type="file" accept="image/*" hidden onChange={(e) => void accept(e.currentTarget.files?.[0])} />
      <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void accept(e.currentTarget.files?.[0])} />

      <header className="flex shrink-0 items-center justify-between border-b border-shop-line px-2 py-1.5 sm:px-3">
        <span className="size-11" aria-hidden="true" />
        <h2 id={titleId} className="font-shop-body text-base font-semibold tracking-normal">
          {t.title}
        </h2>
        <button type="button" aria-label={t.close} onClick={() => dialog.current?.close()} className="grid size-11 place-items-center rounded-shop-control hover:bg-shop-sunken">
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto sm:flex-initial">
        {photo && phase.kind !== "idle" ? (
          <div className="flex gap-3 border-b border-shop-line p-4 sm:items-center">
            {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
            <img src={photo.url} alt={t.preview} className="h-[6.5rem] w-[5.25rem] shrink-0 rounded-shop-sm bg-shop-sunken object-cover" />
            <div className="flex min-w-0 flex-col gap-1.5">
              <p className="font-semibold">{phase.kind === "busy" ? t.busy : results ? (like ? t.looksLike(like) : t.mostSimilar) : t.preview}</p>
              <p className="text-[0.8rem] text-shop-muted">
                {t.matched} {t.privacy}
              </p>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" onClick={() => pick(false)} className="h-[2.1rem] rounded-shop-control border border-shop-line-strong bg-shop-surface px-3 text-[0.8rem] hover:bg-shop-sunken">
                  {t.retake}
                </button>
                <button
                  type="button"
                  aria-expanded={showWords}
                  onClick={() => {
                    setShowWords(true);
                    requestAnimationFrame(() => wordsInput.current?.focus());
                  }}
                  className="h-[2.1rem] rounded-shop-control border border-shop-line-strong bg-shop-surface px-3 text-[0.8rem] hover:bg-shop-sunken"
                >
                  {t.addWords}
                </button>
              </div>
              {showWords ? (
                <form
                  className="mt-1 flex max-w-md items-center gap-1.5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (photo) void search(photo.blob, words);
                  }}
                >
                  <label className="sr-only" htmlFor={`${titleId}-words`}>
                    {t.wordsLabel}
                  </label>
                  <input
                    ref={wordsInput}
                    id={`${titleId}-words`}
                    type="search"
                    value={words}
                    maxLength={100}
                    onChange={(e) => setWords(e.currentTarget.value)}
                    placeholder={t.wordsPlaceholder}
                    className="h-[2.1rem] min-w-0 flex-1 rounded-shop-control border border-shop-line-strong bg-shop-surface px-3 text-[0.85rem] focus:border-shop-ink focus:outline-none"
                  />
                  <button type="submit" className="h-[2.1rem] shrink-0 rounded-shop-control bg-shop-primary px-3 text-[0.8rem] font-semibold text-shop-on-primary hover:bg-shop-primary-strong">
                    {t.refine}
                  </button>
                </form>
              ) : null}
            </div>
          </div>
        ) : null}

        {phase.kind === "idle" || (phase.kind === "error" && !photo) ? (
          <div className="p-4 sm:p-6">
            <div
              className={cn(
                "flex flex-col items-center gap-3 rounded-shop border-2 border-dashed border-shop-line-strong px-6 py-10 text-center transition-colors sm:py-14",
                dragging && "border-shop-primary bg-shop-primary-soft",
              )}
            >
              <svg viewBox="0 0 24 24" className="size-9 text-shop-muted" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
                <circle cx="12" cy="13" r="3.5" />
              </svg>
              <p className="font-semibold">{t.intro}</p>
              <p className="hidden text-sm text-shop-muted sm:block">
                {t.drop} {t.paste}
              </p>
              <p className="text-[0.8rem] text-shop-muted">{t.privacy}</p>
            </div>
          </div>
        ) : null}

        {phase.kind === "error" ? (
          <p role="alert" className="mx-4 my-4 rounded-shop bg-shop-crit-soft px-4 py-3 text-sm text-shop-crit sm:mx-6">
            {phase.message}
          </p>
        ) : null}

        {phase.kind === "unavailable" ? (
          <div role="alert" className="flex flex-col gap-3 p-4 sm:p-6">
            <p className="font-semibold">{t.unavailableTitle}</p>
            <p className="text-sm text-shop-muted">{t.unavailableBody}</p>
            <Form action={localizedHref("/shop")} className="flex max-w-md gap-2" onSubmit={() => dialog.current?.close()}>
              <label htmlFor={`${titleId}-fallback`} className="sr-only">
                {copy.field.label}
              </label>
              <input
                id={`${titleId}-fallback`}
                name="q"
                type="search"
                defaultValue={words}
                maxLength={100}
                required
                className="h-11 min-w-0 flex-1 rounded-shop-control border border-shop-line-strong bg-shop-surface px-4 focus:border-shop-ink focus:outline-none"
              />
              <button type="submit" className="h-11 rounded-shop-control bg-shop-primary px-5 text-sm font-semibold text-shop-on-primary hover:bg-shop-primary-strong">
                {t.textSearch}
              </button>
            </Form>
          </div>
        ) : null}

        {phase.kind === "busy" ? (
          <div className="grid grid-cols-2 gap-x-3 gap-y-5 p-4 sm:grid-cols-4 sm:p-6" aria-hidden="true">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="aspect-[4/5] animate-pulse rounded-shop bg-shop-sunken" />
            ))}
          </div>
        ) : null}

        {results ? (
          <section aria-label={t.mostSimilar} className="px-4 pt-3.5 pb-6 sm:px-6">
            <div className="mb-2 flex items-baseline justify-between" role="status">
              <span className="font-semibold">{t.mostSimilar}</span>
              <span className="text-[0.8rem] text-shop-muted">{t.count(results.total)}</span>
            </div>
            {results.items.length ? (
              <ul className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-4">
                {results.items.map((p) => (
                  <li key={p.id}>
                    <IntentLink href={p.href} onClick={() => dialog.current?.close()} className="group flex flex-col gap-1.5">
                      <span className="relative block aspect-[4/5] overflow-hidden rounded-shop bg-shop-sunken">
                        {p.locked ? <LockedImg blurDataUrl={p.image?.blurDataUrl ?? null} /> : p.image ? <ShopImg image={p.image} fill sizes="(min-width: 640px) 12rem, 45vw" /> : null}
                        {p.match ? (
                          <span className="absolute bottom-2 left-2 rounded-shop-control bg-shop-surface px-2 py-0.5 text-[0.7rem] font-semibold text-shop-ink shadow-shop">{t.match[p.match]}</span>
                        ) : null}
                      </span>
                      <span className="font-shop-mono text-[0.7rem] text-shop-accent">{copy.panel.stockCode(p.stockCode)}</span>
                      <span className="flex justify-between gap-2 text-[0.85rem]">
                        <span className="line-clamp-2 font-medium group-hover:underline">{p.title}</span>
                        <strong className="shrink-0 tabular-nums">{p.showPrice ? dropZeroCents(formatMoney(p.priceCents, p.currency, locale)) : copy.panel.sold}</strong>
                      </span>
                    </IntentLink>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-6 text-sm text-shop-muted">{t.none}</p>
            )}
          </section>
        ) : null}
      </div>

      <footer className="flex shrink-0 gap-2 border-t border-shop-line px-4 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:justify-end sm:pb-4">
        <button type="button" onClick={() => pick(false)} className="h-12 flex-1 rounded-shop-control border border-shop-line-strong bg-shop-surface px-6 font-semibold hover:bg-shop-sunken sm:flex-none">
          {t.choose}
        </button>
        <button
          type="button"
          onClick={() => pick(true)}
          className="h-12 flex-1 rounded-shop-control bg-shop-primary px-6 font-semibold text-shop-on-primary hover:bg-shop-primary-strong sm:hidden"
        >
          {t.take}
        </button>
      </footer>
    </dialog>
  );
}

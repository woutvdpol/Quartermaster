"use client";

import { useEffect, useId, useRef, useState } from "react";
import { downscalePhoto, isImageFile, PHOTO_MAX_BYTES } from "@/components/shop/search/photo-image";
import type { NetworkCard as NetworkCardData } from "@/server/network/service";
import { networkCopy } from "../_copy";
import { NetworkCard } from "./NetworkCard";

const t = networkCopy.photo;

type State = { kind: "idle" } | { kind: "busy"; preview: string } | { kind: "done"; preview: string; items: NetworkCardData[] } | { kind: "error"; preview: string | null; message: string };

/**
 * Camera button in the network search field: pick or shoot a photo, search all dealers by look
 * (POST /api/network/image), show the matches in a dialog. The photo is downscaled in the browser and
 * never stored. Without JavaScript the button is not rendered (text search still works).
 */
export function NetworkPhotoSearch() {
  const [state, setState] = useState<State>({ kind: "idle" });
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const titleId = useId();

  const previewUrl = useRef<string | null>(null);
  const dropPreview = () => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = null;
  };

  useEffect(
    () => () => {
      abort.current?.abort();
      dropPreview();
    },
    [],
  );

  async function search(file: File) {
    abort.current?.abort();
    const c = new AbortController();
    abort.current = c;
    dropPreview();
    const preview = URL.createObjectURL(file);
    previewUrl.current = preview;
    dialog.current?.showModal();
    if (!isImageFile(file) || file.size > PHOTO_MAX_BYTES) {
      setState({ kind: "error", preview, message: "Use a JPEG, PNG or WebP photo up to 10 MB." });
      return;
    }
    setState({ kind: "busy", preview });
    try {
      const form = new FormData();
      form.set("file", await downscalePhoto(file), "photo.jpg");
      const res = await fetch("/api/network/image", { method: "POST", body: form, signal: c.signal });
      const body = (await res.json().catch(() => null)) as { items?: NetworkCardData[]; message?: string } | null;
      if (!res.ok || !body?.items) {
        setState({ kind: "error", preview, message: body?.message ?? t.error });
        return;
      }
      setState({ kind: "done", preview, items: body.items });
    } catch (err) {
      if ((err as Error).name !== "AbortError") setState({ kind: "error", preview, message: t.error });
    }
  }

  return (
    <>
      <button
        type="button"
        aria-label={t.button}
        title={t.button}
        onClick={() => input.current?.click()}
        className="grid size-10 shrink-0 place-items-center rounded-full bg-[#ECECE5] text-[#1E2119] hover:bg-[#DEDCCF]"
      >
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <path d="M4 8h3l2-3h6l2 3h3v11H4z" strokeLinejoin="round" />
          <circle cx="12" cy="13" r="3.5" />
        </svg>
      </button>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void search(file);
        }}
      />
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        onClose={() => {
          abort.current?.abort();
          dropPreview();
          setState({ kind: "idle" });
        }}
        className="m-auto max-h-[88dvh] w-[min(60rem,calc(100vw-2rem))] rounded-xl bg-[#F4F3EC] p-0 text-[#1E2119] shadow-xl backdrop:bg-black/50"
      >
        <div className="flex items-center justify-between border-b border-[#DEDCCF] px-4 py-3">
          <h2 id={titleId} className="font-semibold">
            {t.title}
          </h2>
          <button type="button" onClick={() => dialog.current?.close()} className="rounded-full px-3 py-1.5 text-sm hover:bg-[#E4E2D6]">
            {t.close}
          </button>
        </div>
        <div className="grid gap-4 p-4">
          <div className="flex items-center gap-3">
            {state.kind !== "idle" && state.preview ? (
              // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
              <img src={state.preview} alt="" className="size-20 rounded-lg bg-[#ECECE5] object-cover" />
            ) : null}
            <div className="grid gap-1 text-sm">
              <p aria-live="polite">
                {state.kind === "busy" && t.searching}
                {state.kind === "done" && (state.items.length ? t.results(state.items.length) : t.none)}
                {state.kind === "error" && <span className="text-[#7A2420]">{state.message}</span>}
              </p>
              <p className="text-[13px] text-[#6B6E60]">{t.hint}</p>
              <button type="button" onClick={() => input.current?.click()} className="w-fit text-[13px] text-[#7E5416] underline-offset-2 hover:underline">
                {t.choose}
              </button>
            </div>
          </div>
          {state.kind === "done" && state.items.length ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-4">
              {state.items.map((card) => (
                <NetworkCard key={card.id} card={card} />
              ))}
            </div>
          ) : null}
        </div>
      </dialog>
    </>
  );
}

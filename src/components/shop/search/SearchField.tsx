"use client";

import Form from "next/form";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/components/shop/ui/cn";
import type { PanelHandlers, PanelUi } from "./SuggestPanel";
import { fieldCopy } from "./_copy-field";

const t = fieldCopy;

// Code-split (performance budget, docs/search.md § UI): the suggestion dropdown loads on the first
// focus/pointer over the field, the photo dialog on the first pointer over / click of the camera.
const loadPanel = () => import("./SuggestPanel");
const SuggestPanel = dynamic(() => loadPanel().then((m) => m.SuggestPanel), { ssr: false });
const loadPhoto = () => import("./PhotoSearchDialog");
const PhotoSearchDialog = dynamic(() => loadPhoto().then((m) => m.PhotoSearchDialog), { ssr: false });

export type SearchFieldVariant = "header" | "catalog" | "sheet";

const CameraIcon = () => (
  <svg viewBox="0 0 24 24" className="size-[1.15rem]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
    <circle cx="12" cy="13" r="3.5" />
  </svg>
);
const SearchGlyph = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

/**
 * The shop search field: a GET form to `action` (default /shop?q=…; without JS a plain form submit,
 * with JS next/form navigates client-side) whose input is a WAI-ARIA 1.2 combobox. This shell is all
 * that ships with the page; the suggestion dropdown (./SuggestPanel) and the photo dialog
 * (./PhotoSearchDialog) are separate chunks loaded on first use. `children` are hidden inputs that
 * carry the current catalog filters (the catalog's own search box).
 *
 * Variants: "header" (dropdown wider than the field, right-aligned), "catalog" (dropdown as wide as
 * the field, with a Search button), "sheet" (phones: the dropdown flows below the field, full width).
 */
export function SearchField({
  id,
  action = "/shop",
  variant = "header",
  defaultValue,
  placeholder = t.placeholder,
  autoFocus,
  className,
  children,
}: {
  id: string;
  action?: string;
  variant?: SearchFieldVariant;
  defaultValue?: string;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const handlers = useRef<PanelHandlers | null>(null);
  const [enhanced, setEnhanced] = useState(false);
  const [ui, setUi] = useState<PanelUi>({ expanded: false, active: undefined });
  const [photo, setPhoto] = useState(false);
  const enhance = useCallback(() => setEnhanced(true), []);
  const register = useCallback((h: PanelHandlers | null) => void (handlers.current = h), []);

  // Focused (and maybe typed into) before hydration: the focus/change events were missed, enhance now.
  useEffect(() => {
    if (document.activeElement === input.current) setEnhanced(true);
  }, []);

  const header = variant === "header";
  return (
    <>
      <Form action={action} role="search" className={cn("relative", className)}>
        {children}
        <label htmlFor={id} className="sr-only">
          {t.label}
        </label>
        <div
          className={cn(
            "flex items-center gap-1 rounded-shop-control border border-transparent bg-shop-sunken pr-1 transition-colors focus-within:border-shop-ink focus-within:bg-shop-surface",
            header ? "h-11" : "h-12",
          )}
        >
          <SearchGlyph className="ml-4 size-4 shrink-0 text-shop-muted" />
          <input
            ref={input}
            id={id}
            name="q"
            type="search"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={ui.expanded}
            aria-controls={enhanced ? listId : undefined}
            aria-activedescendant={ui.active}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            maxLength={100}
            defaultValue={defaultValue}
            placeholder={placeholder}
            autoFocus={autoFocus}
            onPointerEnter={() => void loadPanel()}
            onFocus={() => {
              enhance();
              handlers.current?.focus();
            }}
            onBlur={(e) => handlers.current?.blur(e.relatedTarget)}
            onChange={(e) => {
              enhance();
              handlers.current?.input(e.currentTarget.value);
            }}
            onKeyDown={(e) => handlers.current?.keyDown(e)}
            className="h-full min-w-0 flex-1 appearance-none bg-transparent pl-2.5 text-[0.95rem] text-shop-ink placeholder:text-shop-muted focus:outline-none! [&::-webkit-search-cancel-button]:hidden"
          />
          <button
            type="button"
            aria-label={t.photo}
            title={t.photo}
            aria-haspopup="dialog"
            onPointerEnter={() => void loadPhoto()}
            onFocus={() => void loadPhoto()}
            onClick={() => setPhoto(true)}
            className={cn(
              "grid shrink-0 place-items-center rounded-shop-control text-shop-ink-2 transition-colors hover:bg-shop-line hover:text-shop-ink",
              header ? "size-9" : "size-10",
            )}
          >
            <CameraIcon />
          </button>
          {variant === "catalog" ? (
            <button type="submit" className="h-10 shrink-0 rounded-shop-control bg-shop-primary px-4 text-sm font-semibold text-shop-on-primary transition-colors hover:bg-shop-primary-strong">
              {t.submit}
            </button>
          ) : null}
        </div>
        {enhanced ? <SuggestPanel listId={listId} inputRef={input} variant={variant} onUi={setUi} register={register} /> : null}
      </Form>
      {photo ? <PhotoSearchDialog onClose={() => setPhoto(false)} /> : null}
    </>
  );
}

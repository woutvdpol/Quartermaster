"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { cn } from "@/components/shop/ui/cn";
import { IntentLink } from "@/components/shop/ui/IntentLink";
import { formatMoney } from "@/components/shop/ui/money";
import { LockedImg, ShopImg } from "@/components/shop/ui/ShopImg";
import type { SuggestResponse } from "@/server/search/api-types";
import { CLOSED, clampActive, comboKey, type ComboState } from "./combobox";
import { SUGGEST_DEBOUNCE_MS, SUGGEST_MIN_CHARS, createSuggestClient, normalizeQuery } from "./suggest-client";
import type { SearchFieldVariant } from "./SearchField";
import { searchCopy } from "./_copy";

const t = searchCopy.panel;

/** What the field shell renders on its input (aria-expanded / aria-activedescendant). */
export type PanelUi = { expanded: boolean; active: string | undefined };
/** Input events the shell forwards to the panel. */
export type PanelHandlers = {
  focus(): void;
  blur(next: EventTarget | null): void;
  input(value: string): void;
  keyDown(e: KeyboardEvent<HTMLInputElement>): void;
};

/** One client (request cache + abort) per tab, shared by every search field on the page. */
const client = createSuggestClient();

type Option = { id: string; href: string };

/**
 * Search-as-you-type dropdown (lazy chunk of SearchField). Debounced (120 ms) suggestions from
 * /api/search/suggest with abort + cache; "Understood as" chips, matching categories/filters, up to
 * five items with a "why" line, and "See all N results". Keyboard per ./combobox.ts; DOM focus never
 * leaves the input (aria-activedescendant), so the popup swallows mousedown to keep it there.
 */
export function SuggestPanel({
  listId,
  inputRef,
  variant,
  onUi,
  register,
}: {
  listId: string;
  inputRef: RefObject<HTMLInputElement | null>;
  variant: SearchFieldVariant;
  onUi: (ui: PanelUi) => void;
  register: (h: PanelHandlers | null) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const idBase = useId();
  const [data, setData] = useState<SuggestResponse | null>(null);
  const [combo, setCombo] = useState<ComboState>(CLOSED);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focused = () => typeof document !== "undefined" && document.activeElement === inputRef.current;

  const groups = useMemo(() => {
    if (!data) return { filters: [] as (Option & { label: string; count: string | null })[], items: [] as (Option & { p: SuggestResponse["products"][number] })[], all: null as Option | null };
    const filters = [
      ...data.categories.map((c) => ({ id: `${idBase}-c-${c.id}`, href: c.href, label: c.label, count: t.itemsCount(c.count) })),
      // Filters already understood from the words are shown as chips above; offer the others.
      ...data.facets.filter((f) => !data.interpretation.facets.includes(f.token)).map((f) => ({ id: `${idBase}-f-${f.token}`, href: f.href, label: f.label, count: null })),
    ].slice(0, 5);
    const items = data.products.map((p) => ({ id: `${idBase}-p-${p.id}`, href: p.href, p }));
    return { filters, items, all: { id: `${idBase}-all`, href: data.searchHref } };
  }, [data, idBase]);
  const options: Option[] = useMemo(() => [...groups.filters, ...groups.items, ...(groups.all ? [groups.all] : [])], [groups]);
  const open = combo.open && data !== null;
  const active = open && combo.active >= 0 ? options[combo.active] : undefined;

  useEffect(() => onUi({ expanded: open, active: active?.id }), [open, active, onUi]);
  useEffect(() => () => onUi({ expanded: false, active: undefined }), [onUi]);
  // Keep the active option visible inside the scrollable popup.
  useEffect(() => {
    if (active) document.getElementById(active.id)?.scrollIntoView({ block: "nearest" });
  }, [active]);
  // Navigation (option picked, form submitted) closes the popup (state adjusted during render).
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    setCombo(CLOSED);
  }

  const request = (value: string) => {
    if (timer.current) clearTimeout(timer.current);
    const q = normalizeQuery(value);
    if (q.length < SUGGEST_MIN_CHARS) {
      client.abort();
      setLoading(false);
      setData(null);
      setCombo(CLOSED);
      setStatus("");
      return;
    }
    const show = (res: SuggestResponse) => {
      const shown = Math.min(5, res.categories.length + res.facets.length) + res.products.length;
      setData(res);
      // New results: nothing is active any more (the visitor is still typing).
      setCombo(clampActive({ open: focused(), active: -1 }, shown + 1));
      setStatus(t.status(shown));
    };
    const cached = client.peek(q);
    if (cached) {
      setLoading(false);
      show(cached);
      return;
    }
    setLoading(true);
    timer.current = setTimeout(async () => {
      const res = await client.get(q);
      // A newer keystroke owns the popup now.
      if (normalizeQuery(inputRef.current?.value ?? "") !== q) return;
      setLoading(false);
      if (res) show(res);
    }, SUGGEST_DEBOUNCE_MS);
  };

  const requestRef = useRef(request);
  useEffect(() => {
    requestRef.current = request;
  });

  const close = () => setCombo(CLOSED);
  const handlers: PanelHandlers = {
    focus() {
      const value = inputRef.current?.value ?? "";
      if (data && normalizeQuery(value).toLowerCase() === data.query.toLowerCase()) setCombo({ open: true, active: -1 });
      else if (normalizeQuery(value).length >= SUGGEST_MIN_CHARS) requestRef.current(value);
    },
    blur(next) {
      if (next instanceof Node && document.getElementById(`${idBase}-popup`)?.contains(next)) return;
      close();
    },
    input(value) {
      requestRef.current(value);
    },
    keyDown(e) {
      const r = comboKey(open ? combo : { open: false, active: -1 }, e.key, data ? options.length : 0, { alt: e.altKey });
      if (r.preventDefault) e.preventDefault();
      if (r.effect === "select" && active) {
        router.push(active.href);
        inputRef.current?.blur();
      }
      if (r.effect === "submit" && timer.current) clearTimeout(timer.current);
      setCombo(r.state);
    },
  };
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });
  useEffect(() => {
    register({
      focus: () => handlersRef.current.focus(),
      blur: (n) => handlersRef.current.blur(n),
      input: (v) => handlersRef.current.input(v),
      keyDown: (e) => handlersRef.current.keyDown(e),
    });
    // The field may already hold text (typed before this chunk arrived).
    if (focused() && normalizeQuery(inputRef.current?.value ?? "").length >= SUGGEST_MIN_CHARS) requestRef.current(inputRef.current!.value);
    return () => {
      register(null);
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount/unmount only
  }, [register]);

  const optionClass = (o: Option) =>
    cn("flex items-center rounded-shop-sm px-2.5 text-shop-ink outline-none hover:bg-shop-sunken", active?.id === o.id && "bg-shop-sunken");
  const chips = data?.interpretation.chips ?? [];
  const rest = data?.interpretation.text.trim() ?? "";

  return (
    <>
      <div role="status" className="sr-only">
        {open ? status : ""}
      </div>
      <div
        id={`${idBase}-popup`}
        hidden={!open}
        onMouseDown={(e) => e.preventDefault()}
        className={cn(
          "overflow-y-auto overscroll-contain bg-shop-surface text-left text-shop-ink",
          variant === "sheet"
            ? "mt-3 max-h-none rounded-shop border border-shop-line"
            : "absolute top-[calc(100%+0.5rem)] z-50 max-h-[min(72vh,42rem)] rounded-shop border border-shop-line shadow-shop-pop",
          variant === "header" && "right-0 w-[min(34rem,calc(100vw-2rem))]",
          variant === "catalog" && "right-0 left-0 sm:min-w-[30rem]",
        )}
      >
        {chips.length ? (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-shop-line px-4 py-3">
            <span className="mr-1 text-xs text-shop-muted">{t.understood}</span>
            {chips.map((c) => (
              <span key={`${c.kind}:${c.label}`} className="inline-flex items-center rounded-shop-control bg-shop-primary-soft px-2.5 py-1 text-[0.8rem] font-semibold text-shop-ink ring-1 ring-shop-line ring-inset">
                {c.label}
              </span>
            ))}
            {rest ? <span className="text-[0.8rem] text-shop-ink-2">+ “{rest}”</span> : null}
          </div>
        ) : null}
        <div role="listbox" id={listId} aria-label={t.label} aria-busy={loading || undefined}>
          {groups.filters.length ? (
            <div role="group" aria-labelledby={`${idBase}-gf`} className="px-2 pt-2.5 pb-1">
              <div id={`${idBase}-gf`} role="presentation" className="px-2.5 pb-1.5 text-xs text-shop-muted">
                {t.filters}
              </div>
              {groups.filters.map((o) => (
                <IntentLink key={o.id} id={o.id} href={o.href} role="option" aria-selected={active?.id === o.id} tabIndex={-1} onClick={close} className={cn(optionClass(o), "justify-between gap-3 py-2 text-[0.95rem]")}>
                  <span className="truncate">{o.label}</span>
                  {o.count ? <span className="shrink-0 text-[0.8rem] text-shop-muted">{o.count}</span> : null}
                </IntentLink>
              ))}
            </div>
          ) : null}
          {groups.items.length ? (
            <div role="group" aria-labelledby={`${idBase}-gi`} className="px-2 pt-1 pb-2">
              <div id={`${idBase}-gi`} role="presentation" className="px-2.5 py-1.5 text-xs text-shop-muted">
                {t.items}
              </div>
              {groups.items.map((o) => {
                const p = o.p;
                return (
                  <IntentLink key={o.id} id={o.id} href={o.href} role="option" aria-selected={active?.id === o.id} tabIndex={-1} onClick={close} className={cn(optionClass(o), "gap-3 py-2")}>
                    <span className="relative h-[3.4rem] w-11 shrink-0 overflow-hidden rounded-shop-sm bg-shop-sunken">
                      {p.locked ? <LockedImg blurDataUrl={p.image?.blurDataUrl ?? null} /> : p.image ? <ShopImg image={{ ...p.image, alt: "" }} fill sizes="44px" /> : null}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="font-shop-mono text-xs text-shop-accent">{t.stockCode(p.stockCode)}</span>
                      <span className="truncate text-[0.95rem] font-medium">{p.title}</span>
                      <span className="truncate text-xs text-shop-muted">{p.why}</span>
                    </span>
                    <span className="shrink-0 text-[0.95rem] font-bold tabular-nums">{p.showPrice ? formatMoney(p.priceCents, p.currency).replace(/\.00$/, "") : t.sold}</span>
                  </IntentLink>
                );
              })}
            </div>
          ) : null}
          {!groups.filters.length && !groups.items.length ? <p className="px-4 py-4 text-sm text-shop-muted">{loading ? t.loading : t.none}</p> : null}
          {groups.all ? (
            <IntentLink
              id={groups.all.id}
              href={groups.all.href}
              role="option"
              aria-selected={active?.id === groups.all.id}
              tabIndex={-1}
              onClick={close}
              className={cn("flex items-center justify-between bg-shop-sunken px-4 py-3.5 font-semibold text-shop-ink outline-none hover:bg-shop-line", active?.id === groups.all.id && "bg-shop-line")}
            >
              <span>{t.seeAll(data?.total ?? 0, data?.totalCapped ?? false)}</span>
              <span aria-hidden="true">↵</span>
            </IntentLink>
          ) : null}
        </div>
      </div>
    </>
  );
}

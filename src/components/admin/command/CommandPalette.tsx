"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { selectTenantAction } from "@/app/admin/(app)/actions";
import { dialogBase } from "@/components/admin/ui/dialog-styles";
import { searchCommandsAction } from "./actions";
import { matchesQuery, navigationItems, quickActions } from "./static-items";
import type { CommandGroup, CommandItem } from "./types";

/*
 * ⌘K command palette (design C). Opens with ⌘K / Ctrl+K anywhere in the admin, or the sidebar button.
 * Combobox pattern: focus stays in the input, ↑/↓ move the active option (aria-activedescendant),
 * Enter opens it, Esc closes (native <dialog>, focus returns to the trigger).
 * Server search (products, orders, customers, pages, settings) is debounced and tenant-scoped.
 * Recent picks are kept in localStorage (per browser; failures are ignored).
 */

type TenantOption = { id: string; name: string; status: string };

const RECENTS_KEY = "qm:command:recent";
const MAX_RECENTS = 6;
const DEBOUNCE_MS = 160;

function readRecents(): CommandItem[] {
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is CommandItem => !!x && typeof x === "object" && typeof x.id === "string" && typeof x.label === "string" && typeof x.href === "string" && x.href.startsWith("/admin"))
      .slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

function writeRecent(item: CommandItem) {
  if (!item.href) return;
  try {
    const next = [{ id: item.id, label: item.label, href: item.href, meta: item.meta }, ...readRecents().filter((r) => r.id !== item.id)].slice(0, MAX_RECENTS);
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable (private mode) — recents are a convenience only */
  }
}

const TONE: Record<NonNullable<CommandItem["tone"]>, string> = {
  ok: "text-ok",
  warn: "text-warn",
  crit: "text-crit",
  info: "text-info",
  mute: "text-muted",
};

export function CommandPalette({
  superadmin,
  tenants,
  activeTenantId,
  label = "Search…",
}: {
  superadmin: boolean;
  tenants: TenantOption[];
  activeTenantId: string | null;
  label?: string;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"default" | "switch-shop">("default");
  const [remote, setRemote] = useState<{ query: string; groups: CommandGroup[]; error?: string }>({ query: "", groups: [] });
  const [recents, setRecents] = useState<CommandItem[]>([]);
  const [active, setActive] = useState(0);
  const [pending, startTransition] = useTransition();
  const [isMac, setIsMac] = useState(true);
  const searchSeq = useRef(0);

  const openPalette = useCallback(() => {
    setRecents(readRecents());
    setQuery("");
    setMode("default");
    setActive(0);
    setRemote({ query: "", groups: [] });
    setOpen(true);
  }, []);

  // Platform hint (⌘ vs Ctrl) after mount.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- navigator is only available on the client
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
  }, []);

  // Global shortcut.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (dialogRef.current?.open) dialogRef.current.close();
        else openPalette();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openPalette]);

  // Sync the native dialog with state.
  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      inputRef.current?.focus();
    } else if (!open && d.open) d.close();
  }, [open]);

  // Debounced server search.
  useEffect(() => {
    const q = query.trim();
    if (mode !== "default" || !q || (q.replace(/^#/, "").length < 2 && !/^#?\d+$/.test(q))) return;
    const seq = ++searchSeq.current;
    const timer = setTimeout(() => {
      startTransition(async () => {
        const res = await searchCommandsAction(q);
        if (seq !== searchSeq.current) return; // a newer query is in flight
        setRemote(res.ok ? { query: q, groups: res.groups } : { query: q, groups: [], error: res.message });
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, mode]);

  const groups = useMemo<CommandGroup[]>(() => {
    const q = query.trim();
    if (mode === "switch-shop") {
      const items = tenants
        .filter((t) => !q || t.name.toLowerCase().includes(q.toLowerCase()))
        .map((t) => ({
          id: `tenant:${t.id}`,
          label: t.name,
          action: `switch-tenant:${t.id}`,
          meta: t.id === activeTenantId ? "Current shop" : t.status !== "ACTIVE" ? t.status.toLowerCase() : undefined,
        }));
      return [{ id: "shops", label: "Shops", items }];
    }
    const actions = quickActions({ superadmin, canSwitch: tenants.length > 1 });
    const nav = navigationItems(superadmin);
    if (!q) {
      const out: CommandGroup[] = [];
      if (recents.length) out.push({ id: "recent", label: "Recent", items: recents });
      out.push({ id: "actions", label: "Actions", items: actions });
      out.push({ id: "nav", label: "Go to", items: nav });
      return out;
    }
    const out: CommandGroup[] = remote.query === q ? [...remote.groups] : [];
    const a = actions.filter((i) => matchesQuery(i, q));
    const n = nav.filter((i) => matchesQuery(i, q)).slice(0, 5);
    if (a.length) out.push({ id: "actions", label: "Actions", items: a });
    if (n.length) out.push({ id: "nav", label: "Go to", items: n });
    return out;
  }, [query, mode, tenants, activeTenantId, superadmin, recents, remote]);

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const activeIndex = flat.length ? Math.min(active, flat.length - 1) : -1;
  const optionId = (i: number) => `${baseId}-opt-${i}`;

  // Keep the active option visible.
  useEffect(() => {
    if (activeIndex < 0) return;
    document.getElementById(optionId(activeIndex))?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex]);

  const choose = (item: CommandItem) => {
    if (item.action === "switch-shop") {
      setMode("switch-shop");
      setQuery("");
      setActive(0);
      inputRef.current?.focus();
      return;
    }
    if (item.action?.startsWith("switch-tenant:")) {
      const id = item.action.slice("switch-tenant:".length);
      const fd = new FormData();
      fd.set("tenantId", id);
      setOpen(false);
      startTransition(async () => {
        await selectTenantAction(fd);
        router.refresh();
      });
      return;
    }
    if (item.href) {
      writeRecent(item);
      setOpen(false);
      router.push(item.href);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (flat.length ? (Math.min(i, flat.length - 1) + 1) % flat.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (flat.length ? (Math.min(i, flat.length - 1) - 1 + flat.length) % flat.length : 0));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(Math.max(0, flat.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0) choose(flat[activeIndex]);
    } else if (e.key === "Backspace" && !query && mode !== "default") {
      setMode("default");
    }
  };

  const q = query.trim();
  const searching = pending && mode === "default" && q.length > 0;
  let index = -1;

  return (
    <>
      <button
        type="button"
        onClick={openPalette}
        aria-haspopup="dialog"
        aria-keyshortcuts="Meta+K Control+K"
        className="mx-1 mt-3 mb-1 flex items-center justify-between rounded-control border border-rail-line px-2 py-1.5 text-[12.5px] text-rail-muted hover:bg-rail-raised hover:text-rail-ink"
      >
        <span>{label}</span>
        <kbd className="rounded-[3px] border border-rail-line px-1 font-mono text-[11px]">{isMac ? "⌘K" : "Ctrl K"}</kbd>
      </button>

      <dialog
        ref={dialogRef}
        aria-label="Command palette"
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setOpen(false); // backdrop click
        }}
        className={`${dialogBase} fixed top-[10vh] mx-auto mt-0 max-h-[75vh] w-[min(640px,calc(100vw-24px))] overflow-hidden rounded-card border border-line`}
      >
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          {mode === "switch-shop" && <span className="rounded-control bg-panel-2 px-2 py-0.5 text-xs text-muted">Switch shop</span>}
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={`${baseId}-list`}
            aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
            aria-autocomplete="list"
            aria-label={mode === "switch-shop" ? "Search shops" : "Search products, orders, customers or commands"}
            placeholder={mode === "switch-shop" ? "Shop name…" : "Stock code, order #, name, e-mail or command…"}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[16px] text-ink outline-none placeholder:text-muted"
          />
          {searching && <span className="text-xs text-muted" role="status">Searching…</span>}
        </div>

        <div ref={listRef} id={`${baseId}-list`} role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {remote.error && remote.query === q && <p className="px-3 py-2 text-[13px] text-crit">{remote.error}</p>}
          {flat.length === 0 && !searching && (
            <p className="px-3 py-6 text-center text-[13px] text-muted">{q ? `Nothing found for “${q}”.` : "Type to search."}</p>
          )}
          {groups.map((g) =>
            g.items.length === 0 ? null : (
              <div key={g.id} role="group" aria-labelledby={`${baseId}-g-${g.id}`} className="pb-1.5">
                <div id={`${baseId}-g-${g.id}`} className="type-label px-2.5 pt-1.5 pb-1 text-[11px] text-muted">
                  {g.label}
                </div>
                {g.items.map((item) => {
                  index += 1;
                  const i = index;
                  const isActive = i === activeIndex;
                  return (
                    <div
                      key={`${g.id}-${item.id}`}
                      id={optionId(i)}
                      role="option"
                      aria-selected={isActive}
                      onMouseMove={() => active !== i && setActive(i)}
                      onClick={() => choose(item)}
                      className={`flex cursor-pointer items-center gap-3 rounded-control px-2.5 py-2 text-[14px] ${isActive ? "bg-panel-2 text-ink" : "text-ink-2"}`}
                    >
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      <span className="flex shrink-0 items-center gap-2 text-[12.5px] text-muted">
                        {item.meta && <span className="max-w-[220px] truncate font-mono">{item.meta}</span>}
                        {item.badge && <span className={TONE[item.tone ?? "mute"]}>{item.badge}</span>}
                        {isActive && <kbd className="rounded-[3px] border border-line px-1 font-mono text-[11px]">↵</kbd>}
                      </span>
                    </div>
                  );
                })}
              </div>
            ),
          )}
        </div>

        <div className="flex flex-wrap gap-4 border-t border-line bg-panel-2 px-4 py-2 text-[12px] text-muted">
          <span>
            <kbd className="font-mono">↑</kbd> <kbd className="font-mono">↓</kbd> choose
          </span>
          <span>
            <kbd className="font-mono">↵</kbd> open
          </span>
          {mode !== "default" && (
            <span>
              <kbd className="font-mono">⌫</kbd> back
            </span>
          )}
          <span className="ml-auto">
            <kbd className="font-mono">Esc</kbd> close
          </span>
        </div>
      </dialog>
    </>
  );
}

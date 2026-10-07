"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Button, Drawer, Money, ProductStatusPill, Spinner, TextInput, cx, toast } from "@/components/admin/ui";
import type { ProductStatus } from "@/generated/prisma/enums";
import { copy } from "../../_copy";
import { linkProductsAction, searchProductsAction, type PickerProduct } from "./actions";

type Props = { recordId: string; linkedIds: string[]; currency: string; triggerVariant?: "primary" | "secondary" };

/** Drawer with a debounced product search; tick products and link them to the record in one go. */
export function ProductPicker({ recordId, linkedIds, currency, triggerVariant = "secondary" }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickerProduct[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<Map<string, PickerProduct>>(new Map());
  const [linking, startLink] = useTransition();
  const seq = useRef(0);
  const listId = useId();
  const linked = new Set(linkedIds);
  const shown = query.trim().length >= 2 ? results : null;

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await searchProductsAction(q);
        if (mine !== seq.current) return;
        setFailed(!res.ok);
        setResults(res.ok ? (res.data ?? []) : []);
      } catch {
        if (mine === seq.current) setFailed(true);
      } finally {
        if (mine === seq.current) setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  function toggle(p: PickerProduct) {
    setSelected((s) => {
      const next = new Map(s);
      if (next.has(p.id)) next.delete(p.id);
      else next.set(p.id, p);
      return next;
    });
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setSelected(new Map());
      setQuery("");
      setResults(null);
    }
  }

  function linkSelected() {
    const ids = [...selected.keys()];
    if (!ids.length) return;
    startLink(async () => {
      const res = await linkProductsAction(recordId, ids);
      if (res.ok) {
        toast.ok(res.message ?? "");
        onOpenChange(false);
      } else toast.crit(res.message ?? "");
    });
  }

  return (
    <>
      <Button variant={triggerVariant} onClick={() => setOpen(true)} aria-haspopup="dialog">
        {copy.detail.link}
      </Button>
      <Drawer
        open={open}
        onOpenChange={onOpenChange}
        size="lg"
        title={copy.picker.title}
        description={copy.picker.description}
        footer={
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted" role="status">
              {selected.size > 0 ? copy.picker.selected(selected.size) : ""}
            </span>
            <div className="flex gap-2">
              <Button onClick={() => onOpenChange(false)}>{copy.form.cancel}</Button>
              <Button variant="primary" onClick={linkSelected} disabled={selected.size === 0 || linking}>
                {linking && <Spinner />}
                {copy.picker.linkSelected(selected.size)}
              </Button>
            </div>
          </div>
        }
      >
        <div className="grid gap-3">
          <TextInput
            label={copy.picker.search}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={copy.picker.placeholder}
            hint={copy.picker.linkedElsewhereNote}
            autoComplete="off"
            aria-controls={listId}
            trailing={searching ? <Spinner /> : undefined}
          />
          <div id={listId} aria-live="polite" aria-busy={searching}>
            {shown === null ? (
              <p className="text-[13px] text-muted">{copy.picker.hint}</p>
            ) : failed ? (
              <p className="text-[13px] text-crit">{copy.picker.searchFailed}</p>
            ) : shown.length === 0 ? (
              <p className="text-[13px] text-muted">{copy.picker.none}</p>
            ) : (
              <fieldset className="grid gap-0 overflow-hidden rounded-control border border-line">
                <legend className="sr-only">{copy.picker.results}</legend>
                {shown.map((p) => {
                  const isLinked = linked.has(p.id);
                  const checked = selected.has(p.id);
                  return (
                    <label
                      key={p.id}
                      className={cx(
                        "flex items-center gap-3 border-b border-line px-3 py-2 text-[13px] last:border-b-0",
                        isLinked ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-panel-2",
                        checked && "bg-accent-soft",
                      )}
                    >
                      <input
                        type="checkbox"
                        className="size-4 accent-[var(--qm-accent)]"
                        checked={isLinked || checked}
                        disabled={isLinked}
                        onChange={() => toggle(p)}
                      />
                      <span className="font-mono text-xs text-muted">#{p.stockCode}</span>
                      <span className="min-w-0 flex-1 truncate">{p.title}</span>
                      {isLinked ? (
                        <span className="text-xs text-muted">{copy.picker.alreadyLinked}</span>
                      ) : (
                        <ProductStatusPill status={p.status as ProductStatus} />
                      )}
                      <Money amount={p.price} currency={currency} mono className="text-xs" />
                    </label>
                  );
                })}
              </fieldset>
            )}
          </div>
        </div>
      </Drawer>
    </>
  );
}

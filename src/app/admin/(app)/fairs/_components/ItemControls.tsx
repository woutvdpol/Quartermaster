"use client";

import { useState, useTransition } from "react";
import { Button, Drawer, EmptyState, Money, Spinner, TextInput, Thumb, controlClass, cx, formatMoneyInput, parseMoney, currencyDigits, toast } from "@/components/admin/ui";
import type { FairCandidate } from "@/server/fairs/index";
import { addFairItemsAction, removeFairItemAction, searchFairCandidatesAction, setFloorAction } from "../actions";
import { fairsCopy as t } from "../_copy";

/** Inline floor price: saves on blur / Enter. Empty = no floor (the list price is the minimum). */
export function FloorInput({ fairId, productId, floor, currency, label, disabled }: { fairId: string; productId: string; floor: number | null; currency: string; label: string; disabled?: boolean }) {
  const initial = floor === null ? "" : formatMoneyInput(floor, currency);
  const [text, setText] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [pending, start] = useTransition();
  const [invalid, setInvalid] = useState(false);

  function save() {
    if (text === saved) return;
    const minor = text.trim() === "" ? null : parseMoney(text, currencyDigits(currency));
    if (text.trim() !== "" && (minor === null || minor < 0)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    start(async () => {
      const res = await setFloorAction(fairId, productId, minor);
      if (res.ok) {
        const next = minor === null ? "" : formatMoneyInput(minor, currency);
        setText(next);
        setSaved(next);
      } else {
        setInvalid(true);
        toast.crit(res.message ?? "Could not save the floor.");
      }
    });
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={label}
      aria-invalid={invalid || undefined}
      aria-busy={pending || undefined}
      disabled={disabled}
      value={text}
      placeholder="—"
      onChange={(e) => setText(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          save();
        }
      }}
      className={cx(controlClass, "w-24 py-1 text-right font-mono tabular-nums", invalid && "border-crit")}
    />
  );
}

export function RemoveItemButton({ fairId, productId, label }: { fairId: string; productId: string; label: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={label}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const fd = new FormData();
          fd.set("fairId", fairId);
          fd.set("productId", productId);
          const res = await removeFairItemAction(fd);
          if (res.ok) toast.ok(res.message ?? t.items.removed);
          else toast.crit(res.message ?? "Could not remove the item.");
        })
      }
    >
      {pending ? <Spinner /> : "×"}
    </Button>
  );
}

/** "Add items" drawer: search the for-sale inventory, tick items, add them with the default floor. */
export function ItemPicker({ fairId, currency }: { fairId: string; currency: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<FairCandidate[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [searching, startSearch] = useTransition();
  const [adding, startAdd] = useTransition();

  function search(query: string) {
    startSearch(async () => setRows(await searchFairCandidatesAction(fairId, query)));
  }

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <>
      <Button
        variant="primary"
        size="sm"
        aria-haspopup="dialog"
        onClick={() => {
          setOpen(true);
          setPicked(new Set());
          search(q);
        }}
      >
        {t.items.add}
      </Button>
      <Drawer
        open={open}
        onOpenChange={setOpen}
        size="lg"
        title={t.items.addTitle}
        description={t.items.addDescription}
        footer={
          <div className="flex justify-end">
            <Button
              variant="primary"
              disabled={!picked.size || adding}
              aria-busy={adding || undefined}
              onClick={() =>
                startAdd(async () => {
                  const res = await addFairItemsAction(fairId, [...picked]);
                  if (res.ok) {
                    toast.ok(res.message ?? "");
                    setOpen(false);
                  } else toast.crit(res.message ?? "Could not add the items.");
                })
              }
            >
              {adding ? <Spinner /> : null}
              {t.items.addSelected(picked.size)}
            </Button>
          </div>
        }
      >
        <form
          className="mb-3"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            search(q);
          }}
        >
          <TextInput
            label={t.items.search}
            labelHidden
            type="search"
            placeholder={t.items.search}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              search(e.target.value);
            }}
          />
        </form>
        {searching && !rows ? <Spinner label="Searching…" /> : null}
        {rows && rows.length === 0 ? <EmptyState title={t.items.noResults} compact /> : null}
        <ul className="grid gap-1" aria-busy={searching || undefined}>
          {rows?.map((r) => (
            <li key={r.id}>
              <label className="flex cursor-pointer items-center gap-3 rounded-control px-2 py-1.5 hover:bg-panel-2">
                <input type="checkbox" className="size-4 accent-accent" checked={picked.has(r.id)} onChange={() => toggle(r.id)} />
                <Thumb src={r.thumb ?? undefined} alt="" size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-xs text-muted">No. {r.stockCode}</span>
                  <span className="block truncate text-sm">{r.title}</span>
                </span>
                <Money amount={r.price} currency={currency} mono />
              </label>
            </li>
          ))}
        </ul>
      </Drawer>
    </>
  );
}

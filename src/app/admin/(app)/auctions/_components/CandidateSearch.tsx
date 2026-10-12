"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { EmptyState, Money, Spinner, StatusPill, TextInput, Thumb, cx } from "@/components/admin/ui";
import type { LotCandidate } from "../_data";
import { searchLotCandidatesAction } from "../actions";
import { auctionsCopy as t } from "../_copy";

function blockerLabel(b: NonNullable<LotCandidate["blocker"]>): string {
  switch (b.kind) {
    case "notActive":
      return t.lots.reasons.notActive(b.status);
    case "noStock":
      return t.lots.reasons.noStock;
    case "onFair":
      return t.lots.reasons.onFair;
    case "inCart":
      return t.lots.reasons.inCart;
    case "inThis":
      return t.lots.reasons.inThis;
    case "inAuction":
      return t.lots.reasons.inAuction(b.title);
  }
}

type Props = {
  auctionId: string | null;
  currency: string;
  /** "multi" = checkboxes (add lots); "single" = radios named `inputName` (single-lot drawer). */
  mode: "multi" | "single";
  picked: Set<string>;
  onToggle: (c: LotCandidate) => void;
  inputName?: string;
};

/** Inventory search for lots: addable items first, blocked items greyed out with the reason. */
export function CandidateSearch({ auctionId, currency, mode, picked, onToggle, inputName }: Props) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<LotCandidate[] | null>(null);
  const [searching, start] = useTransition();
  const seq = useRef(0);

  function search(query: string) {
    const n = ++seq.current;
    start(async () => {
      const result = await searchLotCandidatesAction(auctionId, query);
      if (n === seq.current) setRows(result);
    });
  }

  useEffect(() => {
    search("");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial load only
  }, []);

  return (
    <div className="grid gap-3">
      <TextInput
        label={t.lots.search}
        labelHidden
        type="search"
        placeholder={t.lots.search}
        value={q}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.preventDefault();
        }}
        onChange={(e) => {
          setQ(e.target.value);
          search(e.target.value);
        }}
      />
      {searching && !rows ? <Spinner label="Searching…" /> : null}
      {rows && rows.length === 0 ? <EmptyState title={t.lots.noResults} compact /> : null}
      <ul className="grid max-h-[60vh] gap-1 overflow-y-auto" aria-busy={searching || undefined}>
        {rows?.map((r) => {
          const blocked = r.blocker !== null;
          return (
            <li key={r.id}>
              <label
                className={cx(
                  "flex items-center gap-3 rounded-control px-2 py-1.5",
                  blocked ? "cursor-not-allowed opacity-70" : "cursor-pointer hover:bg-panel-2",
                )}
              >
                <input
                  type={mode === "multi" ? "checkbox" : "radio"}
                  name={mode === "single" ? inputName : undefined}
                  value={r.id}
                  className="size-4 accent-accent"
                  checked={picked.has(r.id)}
                  disabled={blocked}
                  onChange={() => onToggle(r)}
                />
                <Thumb src={r.thumb ?? undefined} alt="" size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-xs text-muted">No. {r.stockCode}</span>
                  <span className="block truncate text-sm">{r.title}</span>
                  {r.blocker ? <StatusPill tone={r.blocker.kind === "inThis" ? "info" : "warn"}>{blockerLabel(r.blocker)}</StatusPill> : null}
                </span>
                <Money amount={r.price} currency={currency} mono />
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

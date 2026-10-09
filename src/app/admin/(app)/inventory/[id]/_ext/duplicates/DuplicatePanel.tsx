"use client";

import Link from "next/link";
import { useId, useState, useSyncExternalStore, useTransition } from "react";
import { Button, Thumb, toast } from "@/components/admin/ui";
import { productEditPath } from "../../_copy";
import { setEarlierListingAction, type DuplicateCandidateView } from "./actions";
import { dupCopy as t } from "./_copy";

/*
 * Duplicate check panel (docs/design/insights-duplicates-i18n/Duplicate.dc.html): shown in the
 * photos card after uploads finished and the check found look-alikes. Non-blocking: the photos are
 * already saved; staff may ignore it. "A different piece" hides the candidates for this product in
 * this browser session only (sessionStorage).
 */

const storageKey = (productId: string) => `qm.duplicates.dismissed.${productId}`;
const listeners = new Set<() => void>();

function readDismissed(productId: string): string {
  try {
    return sessionStorage.getItem(storageKey(productId)) ?? "";
  } catch {
    return "";
  }
}

function dismiss(productId: string, ids: string[]) {
  try {
    const set = new Set(readDismissed(productId).split(",").filter(Boolean));
    for (const id of ids) set.add(id);
    sessionStorage.setItem(storageKey(productId), [...set].join(","));
  } catch {
    // Storage blocked: the panel closes for now, nothing is remembered.
  }
  for (const l of listeners) l();
}

function useDismissed(productId: string): Set<string> {
  const raw = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => readDismissed(productId),
    () => "",
  );
  return new Set(raw.split(",").filter(Boolean));
}

type Choice = "came_back" | "listed" | "different";

export function DuplicatePanel({ productId, candidates, onClose }: { productId: string; candidates: DuplicateCandidateView[]; onClose: () => void }) {
  const dismissed = useDismissed(productId);
  const visible = candidates.filter((c) => !dismissed.has(c.productId));
  const [choice, setChoice] = useState<Choice | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const name = useId();

  if (!visible.length) return null;
  const target = visible.find((c) => c.productId === targetId) ?? visible[0];
  const veryClose = visible.some((c) => c.band === "very_close");

  function link() {
    startTransition(async () => {
      const r = await setEarlierListingAction(productId, target.productId);
      if (r.ok) {
        toast.ok(r.message ?? t.linkedToast(target.stockCode));
        onClose();
      } else toast.crit(r.message ?? t.failed);
    });
  }

  function different() {
    setChoice("different");
    dismiss(productId, visible.map((c) => c.productId));
    onClose();
  }

  return (
    <div role="status" className="grid gap-3 rounded-card border border-warn/50 bg-warn-soft px-4 py-3.5 text-[13px] text-ink">
      <strong className="text-warn">{veryClose ? t.titleVeryClose : t.titleClose}</strong>

      <ul className="grid gap-3 sm:grid-cols-2">
        {visible.map((c) => (
          <li key={c.productId} className="flex items-center gap-2.5 rounded-card border border-warn/40 bg-panel p-2.5">
            {c.thumbUrl ? <Thumb src={c.thumbUrl} alt="" size="md" /> : <span aria-hidden="true" className="size-14 shrink-0 rounded bg-line" />}
            <span className="grid min-w-0 gap-0.5">
              <span className="font-mono text-[11px] text-accent">
                No. {c.stockCode} · {c.statusLabel}
              </span>
              <b className="truncate">{c.title}</b>
              <span className="text-muted">
                {t.band[c.band]}
                {c.isPrevious && ` · ${t.linked}`}
              </span>
              <Link href={productEditPath(c.productId)} className="justify-self-start text-info hover:underline">
                {t.open(c.stockCode)}
              </Link>
            </span>
          </li>
        ))}
      </ul>

      <fieldset className="grid gap-2">
        <legend className="mb-1.5 text-warn">{t.legend}</legend>
        <label className="flex items-start gap-2">
          <input type="radio" name={name} className="mt-[3px]" checked={choice === "came_back"} onChange={() => setChoice("came_back")} />
          <span>
            <b>{t.cameBack}</b> {t.cameBackHint(target.stockCode)}
          </span>
        </label>
        {choice === "came_back" && (
          <div className="ml-6 flex flex-wrap items-center gap-2">
            {visible.length > 1 && (
              <label className="flex items-center gap-1.5 text-xs text-muted">
                {t.whichOne}
                <select className="rounded border border-line bg-panel px-1.5 py-1 text-[13px] text-ink" value={target.productId} onChange={(e) => setTargetId(e.target.value)}>
                  {visible.map((c) => (
                    <option key={c.productId} value={c.productId}>
                      No. {c.stockCode} · {c.statusLabel}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <Button size="sm" variant="primary" onClick={link} disabled={pending || target.isPrevious}>
              {pending ? t.linking : target.isPrevious ? t.linked : t.link(target.stockCode)}
            </Button>
          </div>
        )}
        <label className="flex items-start gap-2">
          <input type="radio" name={name} className="mt-[3px]" checked={choice === "listed"} onChange={() => setChoice("listed")} />
          <span>
            <b>{t.alreadyListed}</b> {t.alreadyListedHint(target.stockCode)}
          </span>
        </label>
        {choice === "listed" && (
          <div className="ml-6 grid gap-1">
            <Link href={productEditPath(target.productId)} className="justify-self-start font-semibold text-info hover:underline">
              {t.open(target.stockCode)}
            </Link>
            <span className="text-xs text-muted">{t.alreadyListedNote}</span>
          </div>
        )}
        <label className="flex items-start gap-2">
          <input type="radio" name={name} className="mt-[3px]" checked={choice === "different"} onChange={different} />
          <span>
            <b>{t.different}</b> {t.differentHint}
          </span>
        </label>
      </fieldset>

      <span className="text-xs text-warn">{t.footer}</span>
    </div>
  );
}

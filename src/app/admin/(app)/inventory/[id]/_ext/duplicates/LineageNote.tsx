"use client";

import Link from "next/link";
import { useTransition } from "react";
import { Button, toast } from "@/components/admin/ui";
import { productEditPath } from "../../_copy";
import { copyProvenanceAction, setEarlierListingAction } from "./actions";
import { dupCopy as t } from "./_copy";

export type LineageRefView = { id: string; stockCode: number; title: string; statusLabel: string; hasProvenance: boolean };

/**
 * "Earlier listing: No. X (sold Jul 2026)" in the photos card (admin only): the same physical piece
 * listed before. Offers to copy its provenance text (on request, never silently) and to remove the
 * link. Later listings of this piece are shown as links too.
 */
export function LineageNote({ productId, previous, later }: { productId: string; previous: LineageRefView | null; later: LineageRefView[] }) {
  const [pending, startTransition] = useTransition();
  if (!previous && !later.length) return null;

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>) =>
    startTransition(async () => {
      const r = await fn();
      if (r.ok) toast.ok(r.message ?? "");
      else toast.crit(r.message ?? t.failed);
    });

  return (
    <div className="grid gap-1.5 text-xs text-muted">
      {previous && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>
            {t.earlier}{" "}
            <Link href={productEditPath(previous.id)} className="text-info hover:underline" title={previous.title}>
              No. {previous.stockCode} ({previous.statusLabel})
            </Link>
          </span>
          {previous.hasProvenance && (
            <Button size="sm" onClick={() => run(() => copyProvenanceAction(productId))} disabled={pending}>
              {pending ? t.copying : t.copyProvenance(previous.stockCode)}
            </Button>
          )}
          <button type="button" className="text-muted underline hover:text-ink disabled:opacity-50" onClick={() => run(() => setEarlierListingAction(productId, null))} disabled={pending}>
            {t.unlink}
          </button>
        </div>
      )}
      {later.length > 0 && (
        <span>
          {t.later}{" "}
          {later.map((l, i) => (
            <span key={l.id}>
              {i > 0 && ", "}
              <Link href={productEditPath(l.id)} className="text-info hover:underline" title={l.title}>
                No. {l.stockCode} ({l.statusLabel})
              </Link>
            </span>
          ))}
        </span>
      )}
    </div>
  );
}

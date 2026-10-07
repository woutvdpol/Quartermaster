"use client";

import { useState } from "react";
import {
  ConfirmDialog,
  InlineAlert,
  NumberInput,
  Select,
  formatMoney,
  productStatusLabel,
} from "@/components/admin/ui";
import { adjustPriceByPercent } from "@/server/catalog/pricing";
import type { ProductStatus } from "@/generated/prisma/enums";
import { copy } from "../_copy";
import { IdFields, SelectionBar } from "./SelectionBar";
import { bulkArchiveAction, bulkBumpAction, bulkCategoryAction, bulkPriceAction, bulkStatusAction } from "../actions";

const t = copy.bulk;

export type BulkRowMeta = {
  stockCode: number;
  title: string;
  price: number;
  status: ProductStatus;
  /** Why the product cannot become ACTIVE (statusBlocker), or null. */
  activeBlocker: string | null;
};

const STATUS_OPTIONS: ProductStatus[] = ["ACTIVE", "DRAFT", "RESERVED", "SOLD", "ARCHIVED", "STOLEN"];

/** Bulk actions for the inventory table (rendered in the DataTable toolbar, inside its SelectionProvider). */
export function BulkActions({
  rows,
  categories,
  currency,
  locale,
}: {
  rows: Record<string, BulkRowMeta>;
  categories: Array<{ value: string; label: string }>;
  currency: string;
  locale?: string;
}) {
  return (
    <SelectionBar label={t.label} selectedLabel={t.selected} clearLabel={t.clear} escHint={t.escHint}>
      {(ids) => (
        <>
          <StatusDialog ids={ids} rows={rows} />
          <CategoryDialog ids={ids} categories={categories} />
          <PriceDialog ids={ids} rows={rows} currency={currency} locale={locale} />
          <ConfirmDialog
            trigger={t.bump}
            triggerSize="sm"
            tone="primary"
            title={t.bumpTitle(ids.length)}
            description={t.bumpBody}
            confirmLabel={t.bumpApply}
            action={bulkBumpAction}
          >
            <IdFields ids={ids} />
          </ConfirmDialog>
          <ConfirmDialog
            trigger={t.archive}
            triggerSize="sm"
            tone="danger"
            title={t.archiveTitle(ids.length)}
            description={t.archiveBody}
            confirmLabel={t.archiveApply}
            action={bulkArchiveAction}
          >
            <IdFields ids={ids} />
          </ConfirmDialog>
        </>
      )}
    </SelectionBar>
  );
}

function StatusDialog({ ids, rows }: { ids: string[]; rows: Record<string, BulkRowMeta> }) {
  const [status, setStatus] = useState<ProductStatus>("ACTIVE");
  const blocked =
    status === "ACTIVE"
      ? ids.flatMap((id) => {
          const r = rows[id];
          return r && r.status !== "ACTIVE" && r.activeBlocker ? [{ id, ...r }] : [];
        })
      : [];
  return (
    <ConfirmDialog
      trigger={t.status}
      triggerSize="sm"
      tone="primary"
      title={t.statusTitle(ids.length)}
      description={t.statusHelp}
      confirmLabel={t.statusApply}
      action={bulkStatusAction}
    >
      <IdFields ids={ids} />
      <Select
        label={t.statusField}
        name="status"
        value={status}
        onChange={(e) => setStatus(e.target.value as ProductStatus)}
        options={STATUS_OPTIONS.map((s) => ({ value: s, label: productStatusLabel(s) }))}
      />
      {blocked.length > 0 && (
        <InlineAlert tone="warn" title={t.statusBlocked(blocked.length)}>
          <ul className="mt-1 grid gap-0.5 text-[12.5px]">
            {blocked.slice(0, 10).map((b) => (
              <li key={b.id}>
                <span className="font-mono">#{b.stockCode}</span> {b.title} — {b.activeBlocker}
              </li>
            ))}
            {blocked.length > 10 && <li>…and {blocked.length - 10} more</li>}
          </ul>
        </InlineAlert>
      )}
    </ConfirmDialog>
  );
}

function CategoryDialog({ ids, categories }: { ids: string[]; categories: Array<{ value: string; label: string }> }) {
  return (
    <ConfirmDialog
      trigger={t.category}
      triggerSize="sm"
      tone="primary"
      title={t.categoryTitle(ids.length)}
      confirmLabel={t.categoryApply}
      action={bulkCategoryAction}
    >
      <IdFields ids={ids} />
      <Select label={t.categoryField} name="categoryId" defaultValue="none" options={[{ value: "none", label: t.categoryNone }, ...categories]} />
    </ConfirmDialog>
  );
}

function PriceDialog({
  ids,
  rows,
  currency,
  locale,
}: {
  ids: string[];
  rows: Record<string, BulkRowMeta>;
  currency: string;
  locale?: string;
}) {
  const [raw, setRaw] = useState("10");
  const pct = Number(raw.replace(",", "."));
  const valid = raw.trim() !== "" && Number.isFinite(pct) && pct > -100 && pct <= 1000 && pct !== 0;
  const sample = ids.map((id) => rows[id]).find((r) => r && r.price > 0) ?? null;

  return (
    <ConfirmDialog
      trigger={t.price}
      triggerSize="sm"
      tone="primary"
      title={t.priceTitle(ids.length)}
      confirmLabel={t.priceApply}
      action={bulkPriceAction}
    >
      <IdFields ids={ids} />
      <NumberInput
        label={t.priceField}
        name="percent"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        trailing="%"
        hint={t.priceHint}
        required
        error={raw.trim() !== "" && !valid ? copy.result.badPercent : undefined}
      />
      {sample && valid && (
        <p className="text-[13px] text-ink-2">
          {t.priceExample}: <span className="font-mono">#{sample.stockCode}</span>{" "}
          <span className="font-mono tabular-nums">{formatMoney(sample.price, currency, locale)}</span> →{" "}
          <strong className="font-mono tabular-nums">{formatMoney(adjustPriceByPercent(sample.price, Math.round(pct * 100) / 100), currency, locale)}</strong>
        </p>
      )}
    </ConfirmDialog>
  );
}

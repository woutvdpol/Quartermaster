"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import {
  Button,
  EmptyState,
  Money,
  MoneyInput,
  ProductStatusPill,
  Spinner,
  cx,
  formatMoney,
  toast,
} from "@/components/admin/ui";
import type { ProductStatus } from "@/generated/prisma/enums";
import { copy } from "../../_copy";
import { savePurchasePricesAction, unlinkProductAction } from "./actions";

export type LinkedProduct = {
  id: string;
  stockCode: number;
  title: string;
  status: ProductStatus;
  price: number;
  purchasePrice: number | null;
};

type Props = {
  recordId: string;
  products: LinkedProduct[];
  currency: string;
  totalCost: number | null;
  /** Rendered next to the save button (link picker, allocate dialog). */
  actions?: React.ReactNode;
};

const th = "type-label whitespace-nowrap border-b border-line bg-panel-2 px-3 py-2 text-left text-[11px] text-muted";
const td = "border-b border-line px-3 py-1.5 align-middle";

/** Linked products with inline purchase prices (saved together) and per-row unlink. */
export function LinkedProducts({ recordId, products, currency, totalCost, actions }: Props) {
  const original = useMemo(() => new Map(products.map((p) => [p.id, p.purchasePrice])), [products]);
  const [prices, setPrices] = useState<Record<string, number | null>>(() => Object.fromEntries(original));
  const [saving, startSave] = useTransition();
  const [unlinking, setUnlinking] = useState<string | null>(null);

  const dirty = products.filter((p) => (prices[p.id] ?? null) !== (original.get(p.id) ?? null));
  const sumPrice = products.reduce((s, p) => s + p.price, 0);
  const sumCost = products.reduce((s, p) => s + (prices[p.id] ?? 0), 0);
  const rest = totalCost == null ? null : totalCost - sumCost;

  function save() {
    const changes = dirty.map((p) => ({ productId: p.id, purchasePrice: prices[p.id] ?? null }));
    if (!changes.length) return;
    startSave(async () => {
      const res = await savePurchasePricesAction(recordId, changes);
      if (res.ok) toast.ok(res.message ?? "");
      else toast.crit(res.message ?? "");
    });
  }

  async function unlink(p: LinkedProduct) {
    setUnlinking(p.id);
    const res = await unlinkProductAction(recordId, p.id);
    setUnlinking(null);
    if (res.ok) toast.ok(res.message ?? "", { description: p.title });
    else toast.crit(res.message ?? "");
  }

  if (products.length === 0) {
    return <EmptyState compact title={copy.detail.empty} body={copy.detail.emptyBody} action={actions} />;
  }

  return (
    <div className="grid">
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <caption className="sr-only">{copy.detail.products}</caption>
          <thead>
            <tr>
              <th scope="col" className={th}>{copy.detail.stockCode}</th>
              <th scope="col" className={th}>{copy.detail.product}</th>
              <th scope="col" className={cx(th, "hidden md:table-cell")}>{copy.detail.status}</th>
              <th scope="col" className={cx(th, "text-right")}>{copy.detail.price}</th>
              <th scope="col" className={cx(th, "w-40")}>{copy.detail.purchasePrice}</th>
              <th scope="col" className={cx(th, "hidden text-right sm:table-cell")}>{copy.detail.margin}</th>
              <th scope="col" className={th}>
                <span className="sr-only">{copy.detail.unlink}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => {
              const cost = prices[p.id] ?? null;
              const margin = cost == null ? null : p.price - cost;
              const changed = (original.get(p.id) ?? null) !== cost;
              return (
                <tr key={p.id} className={changed ? "bg-accent-soft" : "hover:bg-panel-2"}>
                  <td className={cx(td, "font-mono text-xs text-muted")}>#{p.stockCode}</td>
                  <td className={cx(td, "max-w-[22rem]")}>
                    <Link href={`/admin/inventory/${p.id}`} className="line-clamp-2 hover:underline">
                      {p.title}
                    </Link>
                  </td>
                  <td className={cx(td, "hidden md:table-cell")}>
                    <ProductStatusPill status={p.status} />
                  </td>
                  <td className={cx(td, "text-right")}>
                    <Money amount={p.price} currency={currency} mono />
                  </td>
                  <td className={td}>
                    <MoneyInput
                      name={`price-${p.id}`}
                      label={copy.detail.priceLabel(p.title)}
                      labelHidden
                      currency={currency}
                      value={cost}
                      onValueChange={(v) => setPrices((s) => ({ ...s, [p.id]: v }))}
                      disabled={saving}
                    />
                  </td>
                  <td className={cx(td, "hidden text-right sm:table-cell")}>
                    {margin == null ? (
                      <span className="text-muted">—</span>
                    ) : (
                      <span className={margin < 0 ? "text-crit" : undefined}>
                        <Money amount={margin} currency={currency} mono signed={margin < 0} />
                      </span>
                    )}
                  </td>
                  <td className={cx(td, "text-right")}>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => unlink(p)}
                      disabled={unlinking !== null || saving}
                      aria-label={copy.detail.unlinkLabel(p.title)}
                    >
                      {unlinking === p.id ? <Spinner /> : copy.detail.unlink}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="font-medium">
              <th scope="row" colSpan={2} className="px-3 py-2 text-left">
                {copy.detail.totals}
              </th>
              <td className="hidden md:table-cell" />
              <td className="px-3 py-2 text-right">
                <Money amount={sumPrice} currency={currency} mono />
              </td>
              <td className="px-3 py-2">
                <Money amount={sumCost} currency={currency} mono />
                {rest != null && rest !== 0 && (
                  <div className={cx("text-xs font-normal", rest < 0 ? "text-crit" : "text-warn")}>
                    {rest < 0 ? copy.detail.overAllocated : copy.detail.remaining}: {formatMoney(Math.abs(rest), currency)}
                  </div>
                )}
              </td>
              <td className="hidden sm:table-cell" />
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3.5 py-2.5">
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
        <div className="flex items-center gap-3">
          {dirty.length > 0 && (
            <span role="status" className="text-xs text-muted">
              {copy.detail.unsaved(dirty.length)}
            </span>
          )}
          <Button variant="primary" onClick={save} disabled={saving || dirty.length === 0}>
            {saving && <Spinner />}
            {saving ? copy.detail.savingPrices : copy.detail.savePrices}
          </Button>
        </div>
      </div>
    </div>
  );
}

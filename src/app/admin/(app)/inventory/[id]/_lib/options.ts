/* Pure helpers that turn service data into Select options (server side, passed to client forms). */

import type { SelectOption } from "@/components/admin/ui";

type TreeNode = { id: string; title: string; isActive: boolean; children: TreeNode[] };

/** Flattens the category tree depth-first; children are indented with non-breaking spaces. */
export function categoryOptions(tree: TreeNode[]): SelectOption[] {
  const out: SelectOption[] = [];
  const walk = (nodes: TreeNode[], depth: number, seen: Set<string>) => {
    for (const n of nodes) {
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      const indent = depth ? `${"   ".repeat(depth)}› ` : "";
      out.push({ value: n.id, label: `${indent}${n.title}${n.isActive ? "" : " (hidden)"}` });
      walk(n.children, depth + 1, seen);
    }
  };
  walk(tree, 0, new Set());
  return out;
}

export type PurchaseRecordOption = {
  id: string;
  label: string;
  supplier: string | null;
  purchasedAt: string;
  invoiceNumber: string | null;
  totalCost: number | null;
  currency: string;
};

type RecordLike = {
  id: string;
  purchasedAt: Date;
  invoiceNumber: string | null;
  totalCost: number | null;
  currency: string;
  supplier: { name: string } | null;
};

export function purchaseRecordOption(r: RecordLike): PurchaseRecordOption {
  const date = r.purchasedAt.toISOString().slice(0, 10);
  const parts = [date, r.supplier?.name, r.invoiceNumber].filter(Boolean);
  return {
    id: r.id,
    label: parts.join(" · "),
    supplier: r.supplier?.name ?? null,
    purchasedAt: date,
    invoiceNumber: r.invoiceNumber,
    totalCost: r.totalCost,
    currency: r.currency,
  };
}

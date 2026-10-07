import type { Metadata } from "next";
import Link from "next/link";
import {
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  FilterBar,
  PageHeader,
  SearchInput,
  Tooltip,
  getParam,
  type Column,
} from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import { listSuppliers } from "@/server/purchasing";
import { copy } from "../_copy";
import { SourcingTabs } from "../_components/SourcingTabs";
import { deleteSupplierAction } from "./actions";
import { SupplierDrawer } from "./SupplierDrawer";

export const metadata: Metadata = { title: `${copy.tabs.suppliers} · ${copy.title}` };

export default async function SuppliersPage({ searchParams }: PageProps<"/admin/sourcing/suppliers">) {
  const sp = await searchParams;
  const q = getParam(sp, "q")?.slice(0, 200);
  const ctx = await requireStaffContext();
  const suppliers = await listSuppliers(ctx, { search: q || undefined });
  type Row = (typeof suppliers)[number];

  const columns: Column<Row>[] = [
    { key: "name", header: copy.suppliers.name, cell: (s) => <span className="font-medium">{s.name}</span> },
    {
      key: "contact",
      header: copy.suppliers.contact,
      hideBelow: "md",
      cell: (s) => (s.contact ? <span className="line-clamp-2 whitespace-pre-line text-ink-2">{s.contact}</span> : <span className="text-muted">—</span>),
    },
    {
      key: "records",
      header: copy.suppliers.records,
      numeric: true,
      cell: (s) =>
        s.purchaseRecordCount > 0 ? (
          <Link href={`/admin/sourcing?supplier=${s.id}`} className="hover:underline" aria-label={`${copy.suppliers.viewRecords}: ${s.name}`}>
            {s.purchaseRecordCount}
          </Link>
        ) : (
          <span className="text-muted">0</span>
        ),
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      cell: (s) => (
        <div className="flex justify-end gap-1.5">
          <SupplierDrawer
            supplier={{ id: s.id, name: s.name, contact: s.contact, notes: s.notes }}
            triggerLabel={copy.suppliers.edit}
            triggerAriaLabel={copy.suppliers.editLabel(s.name)}
            triggerVariant="ghost"
            triggerSize="sm"
          />
          {s.purchaseRecordCount > 0 ? (
            <Tooltip content={copy.suppliers.deleteBlocked}>
              <Button size="sm" variant="ghost" aria-disabled="true" aria-label={`${copy.suppliers.delete} ${s.name}`}>
                {copy.suppliers.delete}
              </Button>
            </Tooltip>
          ) : (
            <ConfirmDialog
              trigger={copy.suppliers.delete}
              triggerLabel={`${copy.suppliers.delete} ${s.name}`}
              triggerVariant="ghost"
              triggerSize="sm"
              title={copy.suppliers.deleteTitle(s.name)}
              description={copy.suppliers.deleteBody}
              confirmLabel={copy.suppliers.delete}
              tone="danger"
              action={deleteSupplierAction}
              fields={{ id: s.id }}
            />
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader crumb={copy.crumb} title={copy.title} actions={<SupplierDrawer triggerLabel={copy.suppliers.new} />} />
      <SourcingTabs active="suppliers" />
      <div className="grid content-start gap-4 p-4 md:px-[22px] md:py-5">
        <DataTable
          caption={copy.suppliers.caption}
          columns={columns}
          rows={suppliers}
          rowKey={(s) => s.id}
          toolbar={
            <FilterBar>
              <SearchInput placeholder={copy.suppliers.search} label={copy.suppliers.search} />
            </FilterBar>
          }
          empty={
            q ? (
              <EmptyState compact title={copy.suppliers.emptyFiltered} />
            ) : (
              <EmptyState title={copy.suppliers.empty} body={copy.suppliers.emptyBody} />
            )
          }
        />
      </div>
    </>
  );
}

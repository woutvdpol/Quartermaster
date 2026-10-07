import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Card,
  ConfirmDialog,
  KeyValue,
  Money,
  PageHeader,
  RadioGroup,
  StatusPill,
  formatDate,
} from "@/components/admin/ui";
import { ServiceError, requireStaffContext } from "@/server/context";
import { getPurchaseRecord, listSuppliers } from "@/server/purchasing";
import { copy } from "../../_copy";
import { getTenantFormat } from "../../_lib/tenant";
import { todayIn } from "../../_lib/time";
import { RecordFormDrawer } from "../../_components/RecordFormDrawer";
import { allocateCostAction, deleteRecordAction } from "./actions";
import { LinkedProducts } from "./LinkedProducts";
import { ProductPicker } from "./ProductPicker";

async function load(id: string) {
  const ctx = await requireStaffContext();
  try {
    const [record, suppliers, fmt] = await Promise.all([getPurchaseRecord(ctx, id), listSuppliers(ctx), getTenantFormat(ctx)]);
    return { record, suppliers, fmt };
  } catch (e) {
    if (e instanceof ServiceError && e.code === "NOT_FOUND") notFound();
    if (e instanceof Error && e.name === "ZodError") notFound();
    throw e;
  }
}

function recordTitle(r: { purchasedAt: Date; invoiceNumber: string | null; supplier: { name: string } | null }) {
  const date = formatDate(r.purchasedAt, "date", "UTC");
  return [r.supplier?.name, r.invoiceNumber, date].filter(Boolean).join(" · ") || copy.detail.titleFallback;
}

export async function generateMetadata({ params }: PageProps<"/admin/sourcing/records/[id]">): Promise<Metadata> {
  const { id } = await params;
  const { record } = await load(id);
  return { title: `${recordTitle(record)} · ${copy.tabs.records}` };
}

export default async function PurchaseRecordPage({ params }: PageProps<"/admin/sourcing/records/[id]">) {
  const { id } = await params;
  const { record: r, suppliers, fmt } = await load(id);
  const currency = r.currency;
  const canAllocate = r.totalCost != null && r.products.length > 0;
  const productsKey = r.products.map((p) => `${p.id}:${p.purchasePrice ?? ""}`).join("|");

  const allocate = (
    <ConfirmDialog
      trigger={copy.detail.allocate}
      triggerVariant="secondary"
      title={copy.detail.allocateTitle}
      description={copy.detail.allocateBody}
      confirmLabel={copy.detail.allocateConfirm}
      tone="primary"
      action={allocateCostAction}
      fields={{ id: r.id }}
      disabled={!canAllocate}
    >
      <RadioGroup
        name="method"
        legend={copy.detail.allocateMethod}
        defaultValue="equal"
        options={[
          { value: "equal", label: copy.detail.equal, description: copy.detail.equalHint },
          { value: "byPrice", label: copy.detail.byPrice, description: copy.detail.byPriceHint },
        ]}
      />
    </ConfirmDialog>
  );

  const unallocated = r.unallocatedCost;

  return (
    <>
      <PageHeader
        crumb={
          <>
            <Link href="/admin/sourcing" className="hover:text-ink hover:underline">
              {copy.detail.crumb}
            </Link>{" "}
            / {copy.tabs.records}
          </>
        }
        title={recordTitle(r)}
        actions={
          <>
            <ConfirmDialog
              trigger={copy.detail.delete}
              triggerVariant="danger"
              title={copy.detail.deleteTitle}
              description={copy.detail.deleteBody}
              confirmLabel={copy.detail.delete}
              tone="danger"
              action={deleteRecordAction}
              fields={{ id: r.id }}
            />
            <RecordFormDrawer
              record={{
                id: r.id,
                purchasedAt: r.purchasedAt.toISOString().slice(0, 10),
                supplierId: r.supplierId,
                invoiceNumber: r.invoiceNumber,
                totalCost: r.totalCost,
                notes: r.notes,
              }}
              suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))}
              currency={currency}
              today={todayIn(fmt.timeZone)}
              triggerLabel={copy.detail.edit}
              triggerVariant="secondary"
            />
          </>
        }
      />
      <div className="grid content-start gap-4 p-4 md:px-[22px] md:py-5 lg:grid-cols-[1fr_320px] lg:items-start">
        <Card
          title={copy.detail.products}
          aside={copy.detail.productsCount(r.products.length)}
          padded={false}
          className="min-w-0 lg:order-1"
        >
          <LinkedProducts
            key={productsKey}
            recordId={r.id}
            currency={currency}
            totalCost={r.totalCost}
            products={r.products.map((p) => ({
              id: p.id,
              stockCode: p.stockCode,
              title: p.title,
              status: p.status,
              price: p.price,
              purchasePrice: p.purchasePrice,
            }))}
            actions={
              <>
                <ProductPicker
                  recordId={r.id}
                  linkedIds={r.products.map((p) => p.id)}
                  currency={currency}
                  triggerVariant={r.products.length ? "secondary" : "primary"}
                />
                {r.products.length > 0 && allocate}
                {r.products.length > 0 && !canAllocate && <span className="text-xs text-muted">{copy.detail.needTotal}</span>}
              </>
            }
          />
        </Card>

        <div className="grid gap-4 lg:order-2">
          <Card title={copy.detail.summary}>
            <KeyValue
              items={[
                { label: copy.records.date, value: formatDate(r.purchasedAt, "date", "UTC") },
                {
                  label: copy.records.supplier,
                  value: r.supplier ? (
                    <Link href={`/admin/sourcing?supplier=${r.supplier.id}`} className="hover:underline">
                      {r.supplier.name}
                    </Link>
                  ) : (
                    <span className="text-muted">{copy.records.noSupplier}</span>
                  ),
                },
                { label: copy.records.invoice, value: r.invoiceNumber ?? "—", mono: Boolean(r.invoiceNumber) },
                {
                  label: copy.records.totalCost,
                  value: r.totalCost == null ? <span className="text-muted">{copy.records.noTotal}</span> : <Money amount={r.totalCost} currency={currency} />,
                  mono: true,
                },
                { label: copy.records.allocated, value: <Money amount={r.allocatedCost} currency={currency} />, mono: true },
                {
                  label: copy.records.unallocated,
                  value:
                    unallocated == null ? (
                      "—"
                    ) : unallocated === 0 ? (
                      <StatusPill tone="ok">{copy.records.balanced}</StatusPill>
                    ) : (
                      <StatusPill tone={unallocated < 0 ? "crit" : "warn"}>
                        <Money amount={unallocated} currency={currency} signed={unallocated < 0} />
                      </StatusPill>
                    ),
                  mono: true,
                },
              ]}
            />
          </Card>
          {r.notes && (
            <Card title={copy.detail.notes}>
              <p className="text-[13px] whitespace-pre-line">{r.notes}</p>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

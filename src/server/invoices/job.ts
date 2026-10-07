import { z } from "zod";
import { defineJob } from "@/server/jobs/registry";

/*
 * Invoice jobs. Light definitions (zod only); the handlers lazy-load the service and react-pdf.
 *   invoices.issue  – issue the invoice of a finalized order (queued by onOrderFinalized, in the
 *                     finalization transaction). Idempotent: an order has at most one invoice.
 *   invoices.render – render + store the PDF snapshot of an issued invoice. Idempotent.
 */
const id = z.string().min(1).max(64);

export const invoiceIssueJob = defineJob(
  "invoices.issue",
  z.object({ tenantId: id, orderId: id }),
  async ({ tenantId, orderId }) => {
    const { issueInvoiceForOrder } = await import("./index");
    const res = await issueInvoiceForOrder(tenantId, orderId, { actorId: null, source: "finalized" });
    return { invoiceId: res.invoice?.id ?? null, created: res.created, skipped: res.skipped ?? null };
  },
  { queue: { retryLimit: 5, retryDelay: 30, retryBackoff: true, deleteAfterSeconds: 7 * 24 * 60 * 60 } },
);

export const invoiceRenderJob = defineJob(
  "invoices.render",
  z.object({ tenantId: id, invoiceId: id }),
  async ({ tenantId, invoiceId }) => {
    const { ensureInvoicePdf } = await import("./pdf-store");
    const res = await ensureInvoicePdf(tenantId, invoiceId);
    return { storageKey: res.storageKey, rendered: res.rendered };
  },
  { queue: { retryLimit: 3, retryDelay: 60, retryBackoff: true, deleteAfterSeconds: 7 * 24 * 60 * 60 } },
);

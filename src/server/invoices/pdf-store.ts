import "server-only";
import { db } from "@/server/db";
import { ServiceError } from "@/server/context";
import { getStorage } from "@/server/media/storage";
import { loadInvoiceDocument } from "./index";

/*
 * Stored invoice PDFs: `{tenantId}/invoices/{invoiceId}.pdf` (never served by /uploads — that
 * route only serves images). Rendered once and kept, so an issued invoice never changes.
 * Node.js only (react-pdf): the worker job and the admin route handler call this.
 */

export function invoiceStorageKey(tenantId: string, invoiceId: string): string {
  return `${tenantId}/invoices/${invoiceId}.pdf`;
}

/** Makes sure the invoice's PDF exists in storage. Returns its key; `rendered` = created now. */
export async function ensureInvoicePdf(tenantId: string, invoiceId: string): Promise<{ storageKey: string; rendered: boolean }> {
  const invoice = await db.invoice.findFirst({ where: { id: invoiceId, tenantId }, select: { id: true, storageKey: true } });
  if (!invoice) throw new ServiceError("NOT_FOUND", "Invoice not found");
  const storage = getStorage();
  if (invoice.storageKey && (await storage.exists(invoice.storageKey))) return { storageKey: invoice.storageKey, rendered: false };

  const doc = await loadInvoiceDocument(tenantId, invoiceId);
  const { renderInvoicePdf } = await import("./pdf");
  const pdf = await renderInvoicePdf(doc);
  const key = invoiceStorageKey(tenantId, invoiceId);
  await storage.put(key, new Uint8Array(pdf), "application/pdf");
  await db.invoice.updateMany({ where: { id: invoiceId, tenantId }, data: { storageKey: key } });
  return { storageKey: key, rendered: true };
}

/** The stored PDF (rendering it first when missing) plus its download file name. */
export async function getInvoicePdf(tenantId: string, invoiceId: string) {
  const { storageKey } = await ensureInvoicePdf(tenantId, invoiceId);
  const object = await getStorage().get(storageKey);
  if (!object) throw new ServiceError("UNAVAILABLE", "Invoice file is missing");
  return object;
}

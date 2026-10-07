import { AuthError } from "@/server/auth/guards";
import { requireStaffContext, ServiceError } from "@/server/context";
import { getInvoiceForOrder } from "@/server/invoices";
import { invoiceFileName } from "@/server/invoices/format";
import { getInvoicePdf } from "@/server/invoices/pdf-store";
import { requireTenantDisplay } from "@/server/tenant-display";

// react-pdf needs Node.js (never the edge runtime, never an RSC render).
export const runtime = "nodejs";

/*
 * GET /admin/orders/[id]/invoice — the order's invoice as PDF (staff only, tenant-scoped).
 * Serves the stored snapshot; renders and stores it first when the worker hasn't yet.
 * 404 when the order has no invoice (issue one on the order page).
 */
export async function GET(request: Request, { params }: RouteContext<"/admin/orders/[id]/invoice">) {
  const { id } = await params;
  const notFound = (msg: string) => new Response(msg, { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  try {
    const ctx = await requireStaffContext();
    const invoice = await getInvoiceForOrder(ctx, id);
    if (!invoice) return notFound("This order has no invoice yet.");
    const [pdf, display] = await Promise.all([getInvoicePdf(ctx.tenantId, invoice.id), requireTenantDisplay(ctx.tenantId)]);
    const fileName = invoiceFileName(invoice.number, invoice.issuedAt, display.timeZone);
    const download = new URL(request.url).searchParams.get("download") === "1";
    return new Response(pdf.body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(pdf.size),
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${fileName}"`,
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return error.code === "UNAUTHENTICATED"
        ? Response.redirect(new URL("/admin/login", request.url), 303)
        : new Response("Forbidden", { status: 403 });
    }
    if (error instanceof ServiceError && error.code === "NOT_FOUND") return notFound("Order not found");
    if (error instanceof Error && error.name === "ZodError") return notFound("Order not found");
    throw error;
  }
}

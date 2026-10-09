import { AuthError } from "@/server/auth/guards";
import { requireStaffContext, ServiceError } from "@/server/context";
import { getFairLabels } from "@/server/fairs";
import { LABEL_LAYOUTS, renderFairLabelsPdf, type LabelLayout } from "@/server/fairs/labels-pdf";

// react-pdf needs Node.js (never the edge runtime, never an RSC render).
export const runtime = "nodejs";

/*
 * GET /admin/fairs/[id]/labels?layout=a4|roll62|tag&price=1 — QR labels for the fair's unsold items
 * as PDF (staff only, tenant-scoped). `ids` (comma separated product ids) limits the selection.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const layoutParam = url.searchParams.get("layout") ?? "a4";
  const layout: LabelLayout = (LABEL_LAYOUTS as readonly string[]).includes(layoutParam) ? (layoutParam as LabelLayout) : "a4";
  const withPrice = url.searchParams.get("price") === "1";
  const ids = (url.searchParams.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 500);
  try {
    const ctx = await requireStaffContext();
    const data = await getFairLabels(ctx, id, ids);
    const pdf = await renderFairLabelsPdf({ labels: data.labels, layout, withPrice, currency: data.currency, title: `${data.fairName} — labels` });
    const fileName = `fair-labels-${layout}.pdf`;
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(pdf.length),
        "Content-Disposition": `inline; filename="${fileName}"`,
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return error.code === "UNAUTHENTICATED" ? Response.redirect(new URL("/admin/login", request.url), 303) : new Response("Forbidden", { status: 403 });
    }
    if ((error instanceof ServiceError && error.code === "NOT_FOUND") || (error instanceof Error && error.name === "ZodError")) {
      return new Response("Fair not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
    }
    throw error;
  }
}

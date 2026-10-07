import { AuthError } from "@/server/auth/guards";
import { requireStaffContext, ServiceError } from "@/server/context";
import { packingSlipData } from "@/server/orders/commands";
import { requireTenantDisplay } from "@/server/tenant-display";
import { renderPackingSlips } from "./render";

/* Printable packing slip of one order (HTML, see ./render.ts). */

export async function GET(request: Request, { params }: RouteContext<"/admin/orders/[id]/packing-slip">) {
  const { id } = await params;
  try {
    const ctx = await requireStaffContext();
    const [data, display] = await Promise.all([packingSlipData(ctx, id), requireTenantDisplay(ctx.tenantId)]);
    return new Response(renderPackingSlips([data], display.timeZone), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex",
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return error.code === "UNAUTHENTICATED"
        ? Response.redirect(new URL("/admin/login", request.url), 303)
        : new Response("Forbidden", { status: 403 });
    }
    if (error instanceof ServiceError && (error.code === "NOT_FOUND" || error.code === "INVALID")) {
      return new Response("Order not found", {
        status: 404,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    if (error instanceof Error && error.name === "ZodError") {
      return new Response("Order not found", {
        status: 404,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    throw error;
  }
}

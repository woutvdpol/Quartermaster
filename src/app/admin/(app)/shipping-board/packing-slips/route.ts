import { AuthError } from "@/server/auth/guards";
import { requireStaffContext } from "@/server/context";
import { MAX_PACKING_SLIPS, packingSlipsData } from "@/server/fulfillment";
import { requireTenantDisplay } from "@/server/tenant-display";
import { renderPackingSlips } from "../../orders/[id]/packing-slip/render";

/*
 * Bulk "Print packing slips": GET /admin/shipping-board/packing-slips?ids=a,b,c (or repeated ids=).
 * One printable HTML document, one slip per page. Read-only, so GET is fine; ids of other shops are
 * skipped by the (tenant-scoped) service.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const ids = url.searchParams
    .getAll("ids")
    .flatMap((v) => v.split(","))
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, MAX_PACKING_SLIPS);
  try {
    const ctx = await requireStaffContext();
    const [slips, display] = await Promise.all([packingSlipsData(ctx, ids), requireTenantDisplay(ctx.tenantId)]);
    return new Response(renderPackingSlips(slips, display.timeZone), {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return error.code === "UNAUTHENTICATED"
        ? Response.redirect(new URL("/admin/login", request.url), 303)
        : new Response("Forbidden", { status: 403 });
    }
    throw error;
  }
}

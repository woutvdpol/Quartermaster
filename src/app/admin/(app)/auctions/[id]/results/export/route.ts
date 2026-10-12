import { audit } from "@/server/audit";
import { AuthError } from "@/server/auth/guards";
import { requireStaffContext, ServiceError } from "@/server/context";
import { requireTenantDisplay } from "@/server/tenant-display";
import { currencyDigits } from "@/components/admin/ui";
import { buildCsv, csvAmount, resultKind } from "../../../_lib";
import { getAuctionResults } from "../../../_service";

/*
 * GET /admin/auctions/[id]/results/export — the results table as CSV (staff only, tenant-scoped).
 * Contains winners' names and e-mail addresses, so the export is audited.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const ctx = await requireStaffContext();
    const [{ auction, rows }, tenant] = await Promise.all([getAuctionResults(ctx, id), requireTenantDisplay(ctx.tenantId)]);
    const digits = currencyDigits(tenant.currency);
    const iso = (d: Date | null) => (d ? d.toISOString() : "");
    const csv = buildCsv(
      ["lot", "stock_no", "title", "result", "list_price", "hammer", "currency", "winner", "email", "bidder_no", "payment", "order_id", "closed_at"],
      rows.map((r) => {
        const kind = resultKind(r, auction.payDays);
        return [
          r.lotNumber,
          r.stockCode,
          r.title,
          r.lotStatus,
          csvAmount(r.listPrice, digits),
          csvAmount(r.hammer, digits),
          tenant.currency,
          r.lotStatus === "SOLD" ? (r.winner?.name ?? "") : "",
          r.lotStatus === "SOLD" ? (r.winner?.email ?? "") : "",
          r.lotStatus === "SOLD" ? (r.winner?.bidderNumber ?? null) : null,
          kind,
          r.orderId,
          iso(r.closedAt),
        ];
      }),
    );
    await audit({ action: "auction.results.exported", tenantId: ctx.tenantId, actorId: ctx.actor.id, entity: "Auction", entityId: auction.id, data: { rows: rows.length } });
    const slug = auction.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "auction";
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${slug}-results.csv"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return error.code === "UNAUTHENTICATED" ? Response.redirect(new URL("/admin/login", request.url), 303) : new Response("Forbidden", { status: 403 });
    }
    // UNAVAILABLE: the shop lacks the auctions module (route handlers are not wrapped by the ModuleGate layout).
    if ((error instanceof ServiceError && (error.code === "NOT_FOUND" || error.code === "INVALID" || error.code === "UNAVAILABLE")) || (error instanceof Error && error.name === "ZodError")) {
      return new Response("Auction not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
    }
    throw error;
  }
}

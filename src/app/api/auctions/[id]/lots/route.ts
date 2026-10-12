import { connection } from "next/server";
import { getRequestTenant } from "@/server/tenant";
import { getPublicAuctionById } from "@/server/auctions";
import { hasModule } from "@/server/modules";

/*
 * Polling fallback for the live auction pages: GET /api/auctions/<id>/lots → { lots: PublicLot[], serverTime }.
 * Same data as the SSE snapshot (src/app/api/auctions/[id]/stream/route.ts). Never cached.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  const headers = { "Cache-Control": "no-store" };
  const tenant = await getRequestTenant();
  // 404 without the auctions module (docs/modules.md); getPublicAuctionById would throw UNAVAILABLE.
  if (!tenant || !(await hasModule(tenant.id, "auctions"))) return Response.json({ error: "not_found" }, { status: 404, headers });
  const { id } = await ctx.params;
  const auction = await getPublicAuctionById(tenant.id, id);
  if (!auction) return Response.json({ error: "not_found" }, { status: 404, headers });
  return Response.json({ lots: auction.lots, serverTime: auction.serverTime, status: auction.status }, { headers });
}

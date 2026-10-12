import "server-only";
import Link from "next/link";
import { InlineAlert } from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import { auctionsCopy } from "../_copy";
import { getProductAuctionLot } from "../_data";

const t = auctionsCopy.product;

/** Product editor notice when the item is a lot in an upcoming or live auction (self-loading server component). */
export async function ProductAuctionNotice({ productId }: { productId: string }) {
  const ctx = await requireStaffContext();
  const lot = await getProductAuctionLot(ctx, productId);
  if (!lot) return null;
  return (
    <InlineAlert tone="warn" title={t.notice(lot.auction.title, auctionsCopy.statusShort[lot.auction.status].toLowerCase())}>
      {t.noticeBody}{" "}
      <Link href={`/admin/auctions/${lot.auction.id}`} className="font-medium underline">
        {t.open}
      </Link>
    </InlineAlert>
  );
}

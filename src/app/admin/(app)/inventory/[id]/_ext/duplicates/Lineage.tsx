import "server-only";
import { requireStaffContext } from "@/server/context";
import { getLineage, type LineageRef } from "@/server/duplicates";
import { dupCopy } from "./_copy";
import { monthLabel } from "./format";
import { LineageNote, type LineageRefView } from "./LineageNote";

/** Server part of the lineage note (photos card): earlier / later listings of the same piece. */
export async function Lineage({ productId, timeZone }: { productId: string; timeZone: string }) {
  const ctx = await requireStaffContext();
  const lineage = await getLineage(ctx, productId);
  const view = (r: LineageRef): LineageRefView => ({
    id: r.id,
    stockCode: r.stockCode,
    title: r.title,
    statusLabel: dupCopy.status(r.status, r.soldAt ? monthLabel(r.soldAt, timeZone) : null),
    hasProvenance: r.hasProvenance,
  });
  return <LineageNote productId={productId} previous={lineage.previous ? view(lineage.previous) : null} later={lineage.later.map(view)} />;
}

import { getHeaderCounts } from "@/server/storefront/header-counts";
import { SyncHeaderCounts } from "./HeaderCounts";

/** Loads the counts on the server and syncs them into the client header. Wrap in <Suspense>. */
export async function ServerHeaderCounts({ tenantId }: { tenantId: string }) {
  const counts = await getHeaderCounts(tenantId);
  return <SyncHeaderCounts cart={counts.cart} wishlist={counts.wishlist} />;
}

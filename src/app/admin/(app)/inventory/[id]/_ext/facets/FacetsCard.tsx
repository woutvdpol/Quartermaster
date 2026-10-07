import Link from "next/link";
import { Card } from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import { getProductFacetValueIds, getTaxonomy } from "@/server/facets";
import { FacetsCardClient } from "./FacetsCardClient";

/**
 * Product editor card: per facet a hierarchical multi-select of values. Saves each change
 * immediately (separate from the editor's Save). Mount: `<FacetsCard productId={product.id} />`.
 */
export async function FacetsCard({ productId }: { productId: string }) {
  const ctx = await requireStaffContext();
  const [taxonomy, selected] = await Promise.all([getTaxonomy(ctx), getProductFacetValueIds(ctx, productId)]);
  const facets = taxonomy.filter((f) => f.values.length > 0);
  return (
    <Card
      title="Facets"
      aside={
        <Link href="/admin/facets" className="hover:text-ink hover:underline">
          Manage
        </Link>
      }
    >
      {facets.length === 0 ? (
        <p className="text-sm text-muted">
          No facets with values yet.{" "}
          <Link href="/admin/facets" className="text-ink underline underline-offset-4">
            Set up facets
          </Link>{" "}
          to classify items by period, country, branch and more.
        </p>
      ) : (
        <FacetsCardClient productId={productId} facets={facets} initialSelected={selected} />
      )}
    </Card>
  );
}

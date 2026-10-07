"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionFail, actionOk, type ActionResult } from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import { setProductFacetValues } from "@/server/facets";
import { errorResult } from "../../../_data";

const schema = z.object({ productId: z.string().min(1).max(64), facetId: z.string().min(1).max(64), valueIds: z.array(z.string().min(1).max(64)).max(200) });

/** Replaces the product's values of one facet (the other facets are untouched). */
export async function setProductFacetAction(productId: string, facetId: string, valueIds: string[]): Promise<ActionResult> {
  const parsed = schema.safeParse({ productId, facetId, valueIds });
  if (!parsed.success) return actionFail("Could not save the facet values.");
  try {
    const ctx = await requireStaffContext();
    await setProductFacetValues(ctx, parsed.data.productId, parsed.data.valueIds, { facetId: parsed.data.facetId });
    revalidatePath(`/admin/inventory/${parsed.data.productId}`);
    revalidatePath("/admin/facets");
    return actionOk();
  } catch (err) {
    return errorResult(err, "Could not save the facet values.");
  }
}

import "server-only";
import { db } from "@/server/db";
import { shopCache } from "@/server/storefront/cache";
import { PUBLIC_PRODUCT_STATUSES, documentUrl, type PublicDocument } from "./documents";

/*
 * Shop-facing provenance data for one product (ProvenanceBlock). Identical for every visitor, so it
 * goes through the shop data cache ("catalog" area): every provenance mutation audits a "product.*"
 * action, which invalidates that area immediately.
 */

export type PublicProvenance = {
  provenance: string | null;
  authenticityGuaranteed: boolean;
  /** A non-revoked certificate exists ("Certificate of authenticity included"). */
  certificateIncluded: boolean;
  documents: PublicDocument[];
  /** Sensitive item (Product.blurred): the caller decides whether the viewer may see it. */
  blurred: boolean;
};

export async function queryPublicProvenance(tenantId: string, productId: string): Promise<PublicProvenance | null> {
  if (typeof productId !== "string" || !productId || productId.length > 64) return null;
  const p = await db.product.findFirst({
    where: { id: productId, tenantId, status: { in: [...PUBLIC_PRODUCT_STATUSES] } },
    select: {
      provenance: true,
      authenticityGuaranteed: true,
      blurred: true,
      productDocuments: {
        where: { isPublic: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, kind: true, title: true, mimeType: true, byteSize: true },
      },
      _count: { select: { certificates: { where: { revokedAt: null } } } },
    },
  });
  if (!p) return null;
  return {
    provenance: p.provenance?.trim() || null,
    authenticityGuaranteed: p.authenticityGuaranteed,
    certificateIncluded: p._count.certificates > 0,
    documents: p.productDocuments.map((d) => ({ ...d, url: documentUrl(d.id) })),
    blurred: p.blurred,
  };
}

export const getPublicProvenance = shopCache("provenance", "catalog", queryPublicProvenance);

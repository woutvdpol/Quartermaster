import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { ServiceError, type ServiceContext } from "@/server/context";
import { MAX_MARKDOWN_LENGTH } from "@/server/content/markdown";
import type { ProductStatus } from "@/generated/prisma/enums";

/*
 * Product.provenance (public Markdown: collection history, where it was found, earlier owners)
 * and Product.authenticityGuaranteed. This service writes ONLY these two fields, so it never races
 * with the main product editor's save. Audit action "product.provenance" ("product." prefix →
 * the shop catalog cache is invalidated by audit()).
 */

export type ProvenanceDto = { productId: string; status: ProductStatus; provenance: string; authenticityGuaranteed: boolean; updatedAt: Date };

const idSchema = z.string().min(1).max(64);

export const provenanceInputSchema = z.object({
  provenance: z
    .string()
    .max(MAX_MARKDOWN_LENGTH, `Provenance is too long (max ${MAX_MARKDOWN_LENGTH.toLocaleString("en")} characters)`)
    .transform((v) => v.replace(/\r\n?/g, "\n").trim()),
  authenticityGuaranteed: z.boolean(),
});
export type ProvenanceInput = z.input<typeof provenanceInputSchema>;

export async function getProvenance(ctx: ServiceContext, productId: string): Promise<ProvenanceDto> {
  productId = idSchema.parse(productId);
  const p = await db.product.findFirst({
    where: { id: productId, tenantId: ctx.tenantId },
    select: { id: true, status: true, provenance: true, authenticityGuaranteed: true, updatedAt: true },
  });
  if (!p) throw new ServiceError("NOT_FOUND", "Product not found");
  return { productId: p.id, status: p.status, provenance: p.provenance ?? "", authenticityGuaranteed: p.authenticityGuaranteed, updatedAt: p.updatedAt };
}

export async function updateProvenance(ctx: ServiceContext, productId: string, input: ProvenanceInput): Promise<ProvenanceDto> {
  productId = idSchema.parse(productId);
  const parsed = provenanceInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ServiceError("INVALID", parsed.error.issues[0]?.message ?? "Invalid provenance", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  const { provenance, authenticityGuaranteed } = parsed.data;
  const found = await db.product.findFirst({ where: { id: productId, tenantId: ctx.tenantId }, select: { id: true, provenance: true, authenticityGuaranteed: true } });
  if (!found) throw new ServiceError("NOT_FOUND", "Product not found");

  const p = await db.product.update({
    where: { id: found.id },
    data: { provenance: provenance || null, authenticityGuaranteed },
    select: { id: true, status: true, provenance: true, authenticityGuaranteed: true, updatedAt: true },
  });
  await audit({
    action: "product.provenance",
    tenantId: ctx.tenantId,
    actorId: ctx.actor.id,
    entity: "Product",
    entityId: p.id,
    data: {
      provenanceChanged: (found.provenance ?? "") !== (p.provenance ?? ""),
      provenanceLength: p.provenance?.length ?? 0,
      authenticityGuaranteed: { from: found.authenticityGuaranteed, to: p.authenticityGuaranteed },
    },
  });
  return { productId: p.id, status: p.status, provenance: p.provenance ?? "", authenticityGuaranteed: p.authenticityGuaranteed, updatedAt: p.updatedAt };
}

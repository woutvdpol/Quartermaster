"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionFail, actionOk, formString, type ActionResult, type ActionState } from "@/components/admin/ui";
import { requireStaffContext } from "@/server/context";
import { updateProvenance } from "@/server/provenance/provenance";
import { DOCUMENT_KINDS, addProductDocument, deleteProductDocument, updateProductDocument } from "@/server/provenance/documents";
import { issueCertificate, revokeCertificate } from "@/server/provenance/certificates";
import { MAX_DOCUMENT_IMAGE_BYTES } from "@/server/provenance/files";
import { provenanceCardCopy as copy } from "./_copy";
import { failFrom } from "./_errors";

const idSchema = z.string().min(1).max(64);

function revalidateProduct(productId: string) {
  revalidatePath(`/admin/inventory/${productId}`);
}

function productIdFrom(formData: FormData): string | null {
  const parsed = idSchema.safeParse(formString(formData, "productId"));
  return parsed.success ? parsed.data : null;
}

export async function saveProvenanceAction(_prev: ActionState, formData: FormData): Promise<ActionResult> {
  const productId = productIdFrom(formData);
  if (!productId) return actionFail(copy.errors.generic);
  const provenance = formData.get("provenance");
  try {
    const ctx = await requireStaffContext();
    await updateProvenance(ctx, productId, {
      provenance: typeof provenance === "string" ? provenance : "",
      authenticityGuaranteed: formData.get("authenticityGuaranteed") === "on",
    });
    revalidateProduct(productId);
    return actionOk(copy.provenance.saved);
  } catch (err) {
    return failFrom(err);
  }
}

export async function uploadDocumentAction(_prev: ActionState, formData: FormData): Promise<ActionResult> {
  const productId = productIdFrom(formData);
  if (!productId) return actionFail(copy.errors.generic);
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return actionFail(copy.errors.checkFields, { file: [copy.documents.chooseFile] });
  if (file.size > MAX_DOCUMENT_IMAGE_BYTES) {
    return actionFail(copy.errors.checkFields, { file: [copy.documents.tooLarge(MAX_DOCUMENT_IMAGE_BYTES / 1024 / 1024)] });
  }
  const kind = formString(formData, "kind");
  try {
    const ctx = await requireStaffContext();
    await addProductDocument(ctx, productId, {
      kind: kind as (typeof DOCUMENT_KINDS)[number], // validated by the service (INVALID → field error "kind")
      title: formString(formData, "title") || null,
      isPublic: formData.get("isPublic") === "on",
      file: { name: file.name.slice(0, 255), bytes: new Uint8Array(await file.arrayBuffer()) },
    });
    revalidateProduct(productId);
    return actionOk(copy.documents.uploaded);
  } catch (err) {
    return failFrom(err);
  }
}

export async function setDocumentPublicAction(productId: string, documentId: string, isPublic: boolean): Promise<ActionResult> {
  try {
    const ctx = await requireStaffContext();
    await updateProductDocument(ctx, idSchema.parse(documentId), { isPublic: Boolean(isPublic) });
    revalidateProduct(idSchema.parse(productId));
    return actionOk(isPublic ? copy.documents.madePublic : copy.documents.madePrivate);
  } catch (err) {
    return failFrom(err);
  }
}

export async function deleteDocumentAction(formData: FormData): Promise<ActionResult> {
  const productId = productIdFrom(formData);
  const id = idSchema.safeParse(formString(formData, "id"));
  if (!productId || !id.success) return actionFail(copy.errors.generic);
  try {
    const ctx = await requireStaffContext();
    await deleteProductDocument(ctx, id.data);
    revalidateProduct(productId);
    return actionOk(copy.documents.deleted);
  } catch (err) {
    return failFrom(err);
  }
}

export async function issueCertificateAction(formData: FormData): Promise<ActionResult> {
  const productId = productIdFrom(formData);
  if (!productId) return actionFail(copy.errors.generic);
  try {
    const ctx = await requireStaffContext();
    const cert = await issueCertificate(ctx, productId);
    revalidateProduct(productId);
    return actionOk(copy.certificates.issued(cert.code));
  } catch (err) {
    return failFrom(err);
  }
}

export async function revokeCertificateAction(formData: FormData): Promise<ActionResult> {
  const productId = productIdFrom(formData);
  const id = idSchema.safeParse(formString(formData, "id"));
  if (!productId || !id.success) return actionFail(copy.errors.generic);
  try {
    const ctx = await requireStaffContext();
    const cert = await revokeCertificate(ctx, id.data, formString(formData, "reason"));
    revalidateProduct(productId);
    return actionOk(copy.certificates.revokedOk(cert.code));
  } catch (err) {
    return failFrom(err);
  }
}
